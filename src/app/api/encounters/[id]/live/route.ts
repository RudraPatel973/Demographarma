import { db, must } from "@/lib/supabase";
import { json, route } from "@/lib/api";
import { syncFromTranscript } from "@/lib/clinical";
import { llmProvider } from "@/lib/llm";

type Ctx = { params: Promise<{ id: string }> };
export const maxDuration = 60;

/**
 * Called repeatedly while the visit is recording.
 * Body: { transcript } — saves it, extracts the chart from it, and reports whether
 * the doctor has stated the diagnosis (the client then stops and generates).
 */
export const POST = route(async (req: Request, { params }: Ctx) => {
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  if (Array.isArray(body.transcript)) {
    must(await db().from("encounters").update({ transcript: body.transcript, updated_at: new Date().toISOString() }).eq("id", id).select("id"));
  }
  if (!llmProvider()) return json({ error: "No LLM configured (set LLM_BASE_URL or ANTHROPIC_API_KEY)." }, 400);
  const { patient, encounter, diagnosisStated } = await syncFromTranscript(id);
  return json({ patient, encounter, diagnosisStated });
});
