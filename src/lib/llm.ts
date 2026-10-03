import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import * as z from "zod/v4";
import type { Encounter } from "./types";
import { db, MEDIA_BUCKET } from "./supabase";

/**
 * Provider-agnostic structured-output calls.
 *
 *  - LLM_BASE_URL (+ LLM_API_KEY, LLM_MODEL): any OpenAI-compatible endpoint,
 *    e.g. Groq (free tier), OpenRouter, Together, or a local Ollama.
 *  - ANTHROPIC_API_KEY: Claude (used only when LLM_BASE_URL is not set).
 */

const CLAUDE_MODEL = "claude-opus-5-5";

export type Provider = "openai_compatible" | "anthropic" | null;

export function llmProvider(): Provider {
  const base = process.env.LLM_BASE_URL;
  // Hosted endpoints need a key; a local server (Ollama, vLLM) doesn't
  if (base && (process.env.LLM_API_KEY || /localhost|127\.0\.0\.1/.test(base))) return "openai_compatible";
  if (process.env.ANTHROPIC_API_KEY) return "anthropic";
  return null;
}

export function llmModelName() {
  const p = llmProvider();
  if (p === "openai_compatible") return process.env.LLM_MODEL ?? "openai/gpt-oss-120b";
  if (p === "anthropic") return CLAUDE_MODEL;
  return null;
}

export interface Attachment {
  name: string;
  mime: string;
  data: Buffer;
}

export interface StructuredRequest<S extends z.ZodType> {
  system: string;
  user: string;
  schema: S;
  attachments?: Attachment[];
  /** "fast" for live extraction during the visit, "deep" for the final ranking */
  speed: "fast" | "deep";
}

export async function structured<S extends z.ZodType>(req: StructuredRequest<S>): Promise<{ data: z.infer<S>; model: string; usage: unknown }> {
  const p = llmProvider();
  if (p === "openai_compatible") return openaiCompatible(req);
  if (p === "anthropic") return claude(req);
  throw new Error("No LLM configured. Set LLM_BASE_URL/LLM_API_KEY/LLM_MODEL (e.g. Groq) or ANTHROPIC_API_KEY in .env.local");
}

// ---------------------------------------------------------------------------
// OpenAI-compatible (Groq, OpenRouter, Together, Ollama, vLLM…)
// ---------------------------------------------------------------------------
async function attachmentsAsText(atts: Attachment[]) {
  const parts: string[] = [];
  for (const a of atts) {
    if (a.mime === "application/pdf") {
      try {
        const { extractText, getDocumentProxy } = await import("unpdf");
        const pdf = await getDocumentProxy(new Uint8Array(a.data));
        const { text } = await extractText(pdf, { mergePages: true });
        parts.push(`<document name="${a.name}">\n${text}\n</document>`);
      } catch {
        parts.push(`<document name="${a.name}">(could not read PDF)</document>`);
      }
    } else if (a.mime.startsWith("text/") || /\.(txt|md|csv|json)$/i.test(a.name)) {
      parts.push(`<document name="${a.name}">\n${a.data.toString("utf8")}\n</document>`);
    }
    // Images are skipped: most open models served this way are text-only.
  }
  return parts.join("\n\n");
}

function extractJson(text: string): unknown {
  const t = text.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "").trim();
  try {
    return JSON.parse(t);
  } catch {
    const start = t.indexOf("{");
    const end = t.lastIndexOf("}");
    if (start >= 0 && end > start) return JSON.parse(t.slice(start, end + 1));
    throw new Error("Model did not return JSON");
  }
}

function modelFor(speed: "fast" | "deep") {
  // Separate models = separate rate-limit buckets on hosted free tiers
  return speed === "fast" ? process.env.LLM_FAST_MODEL || llmModelName()! : llmModelName()!;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function openaiCompatible<S extends z.ZodType>(req: StructuredRequest<S>) {
  const base = process.env.LLM_BASE_URL!.replace(/\/$/, "");
  const model = modelFor(req.speed);
  const jsonSchema = z.toJSONSchema(req.schema, { target: "draft-7" });
  const docs = req.attachments?.length ? await attachmentsAsText(req.attachments) : "";
  const user = (docs ? docs + "\n\n" : "") + req.user;
  const reasoning = /gpt-oss/.test(model) ? { reasoning_effort: req.speed === "fast" ? "low" : "medium" } : {};

  // 1) native JSON-schema mode (schema not repeated in the prompt — saves tokens)
  // 2) JSON mode with the schema in the prompt, for servers without schema support
  const modes = [
    { fmt: { type: "json_schema", json_schema: { name: "result", schema: jsonSchema, strict: false } }, system: req.system + "\n\nRespond with JSON only." },
    { fmt: { type: "json_object" }, system: req.system + "\n\nRespond with one JSON object that validates against this JSON Schema:\n" + JSON.stringify(jsonSchema) },
  ];

  let lastError = "";
  for (const mode of modes) {
    const messages: { role: string; content: string }[] = [
      { role: "system", content: mode.system },
      { role: "user", content: user },
    ];
    for (let attempt = 0; attempt < 3; attempt++) {
      const res = await fetch(`${base}/chat/completions`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(process.env.LLM_API_KEY ? { authorization: `Bearer ${process.env.LLM_API_KEY}` } : {}),
        },
        body: JSON.stringify({
          model,
          messages,
          temperature: req.speed === "fast" ? 0 : 0.2,
          max_tokens: req.speed === "fast" ? 1800 : 4000,
          response_format: mode.fmt,
          ...reasoning,
        }),
      });
      if (res.status === 429) {
        // Free-tier tokens-per-minute limit: wait as instructed, then retry
        const txt = await res.text();
        const secs = Number(res.headers.get("retry-after")) || Number(/try again in ([\d.]+)s/.exec(txt)?.[1]) || 5;
        if (secs > 40) throw new Error(`LLM rate limit: retry in ${Math.ceil(secs)}s`);
        await sleep(secs * 1000 + 250);
        continue;
      }
      if (res.status === 400) {
        lastError = await res.text();
        // a validation failure of the model's own output comes back as 400 json_validate_failed: retry; otherwise try next mode
        if (/json_validate_failed/.test(lastError) && attempt < 2) continue;
        break;
      }
      if (!res.ok) throw new Error(`LLM ${res.status}: ${(await res.text()).slice(0, 300)}`);
      const j = (await res.json()) as { choices: { message: { content: string } }[]; usage?: unknown };
      const content = j.choices?.[0]?.message?.content ?? "";
      try {
        const parsed = req.schema.safeParse(extractJson(content));
        if (parsed.success) return { data: parsed.data, model, usage: j.usage ?? null };
        lastError = parsed.error.message;
      } catch (e) {
        lastError = String(e);
      }
      messages.push({ role: "assistant", content }, { role: "user", content: `That JSON was invalid: ${lastError.slice(0, 600)}. Return the corrected JSON object only.` });
    }
  }
  throw new Error(`LLM returned invalid output: ${lastError.slice(0, 300)}`);
}

// ---------------------------------------------------------------------------
// Claude
// ---------------------------------------------------------------------------
let _anthropic: Anthropic | null = null;

async function claude<S extends z.ZodType>(req: StructuredRequest<S>) {
  _anthropic ??= new Anthropic();
  const content: Anthropic.Beta.BetaContentBlockParam[] = [];
  for (const a of req.attachments ?? []) {
    if (a.mime === "application/pdf") {
      content.push({ type: "document", title: a.name, source: { type: "base64", media_type: "application/pdf", data: a.data.toString("base64") } });
    } else if (/^image\/(png|jpeg|gif|webp)$/.test(a.mime)) {
      content.push({ type: "image", source: { type: "base64", media_type: a.mime as "image/png", data: a.data.toString("base64") } });
    } else if (a.mime.startsWith("text/")) {
      content.push({ type: "document", title: a.name, source: { type: "text", media_type: "text/plain", data: a.data.toString("utf8") } });
    }
  }
  content.push({ type: "text", text: req.user });
  const response = await _anthropic.beta.messages.parse({
    model: CLAUDE_MODEL,
    max_tokens: 16000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    system: req.system,
    output_config: { effort: req.speed === "fast" ? "low" : "high", format: betaZodOutputFormat(req.schema) },
    messages: [{ role: "user", content }],
  });
  if (response.stop_reason === "refusal" || !response.parsed_output) {
    throw new Error(`Claude returned no result (stop_reason=${response.stop_reason})`);
  }
  return { data: response.parsed_output as z.infer<S>, model: response.model, usage: response.usage };
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------
const MAX_DOC_BYTES = 20 * 1024 * 1024;

export async function loadAttachments(e: Encounter): Promise<Attachment[]> {
  const out: Attachment[] = [];
  for (const doc of e.documents ?? []) {
    if (doc.size > MAX_DOC_BYTES) continue;
    const { data } = await db().storage.from(MEDIA_BUCKET).download(doc.path);
    if (data) out.push({ name: doc.name, mime: doc.mime, data: Buffer.from(await data.arrayBuffer()) });
  }
  return out;
}

export function transcriptText(e: Pick<Encounter, "transcript">) {
  return (e.transcript ?? []).map((s) => (s.speaker === "unknown" ? s.text : `[${s.speaker.toUpperCase()}] ${s.text}`)).join("\n");
}
