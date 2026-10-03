import { db, must } from "@/lib/supabase";
import { json, route } from "@/lib/api";
import { llmProvider } from "@/lib/llm";
import { syncFromTranscript } from "@/lib/clinical";
import { recommend } from "@/lib/recommend";
import { missingRequired, REQUIRED_LABELS } from "@/lib/requirements";
import type { Encounter, Patient } from "@/lib/types";

type Ctx = { params: Promise<{ id: string }> };

// The ranking model over transcript + documents can take a while.
export const maxDuration = 300;

/**
 * Diagram flow (see src/lib/recommend.ts):
 *  1. look up meds for the diagnosis in TABLE 1 (diagnosis_medications)
 *  2. take those meds + demographic modifiers from TABLE 2, score them
 *  3. send candidates + all other inputs (transcript, docs, profile) to the AI model
 *  4. store the top 3 with a match percentage (+ monthly cost; near-ties go to the cheaper drug)
 * Stage 2 patients then get a second pill via /second, and /combine checks for a single-pill combination.
 */
export const POST = route(async (req: Request, { params }: Ctx) => {
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  // Catch up on anything said since the last live extraction
  const pre = must(await db().from("encounters").select("transcript,live_state").eq("id", id).single()) as Pick<Encounter, "transcript" | "live_state">;
  const stale = (pre.live_state?.extracted_segments ?? -1) < (pre.transcript?.length ?? 0);
  if (body.sync && stale && llmProvider()) {
    try {
      await syncFromTranscript(id);
    } catch (e) {
      console.error("[generate] final sync failed:", e);
    }
  }
  const encounter = must(await db().from("encounters").select("*").eq("id", id).single()) as Encounter;
  if (!encounter.diagnosis_id) {
    // Doctor ended the visit without a recognised diagnosis: this demo is hypertension-only
    must(await db().from("encounters").update({ diagnosis_id: "essential_hypertension" }).eq("id", id).select("id"));
  }
  const patient = must(await db().from("patients").select("*").eq("id", encounter.patient_id).single()) as Patient;

  // The chart must be complete before matching (and Photon needs these to send the prescription)
  const missingKeys = missingRequired(patient, encounter);
  if (missingKeys.length) {
    return json({ error: `Key information missing: ${missingKeys.map((k) => REQUIRED_LABELS[k]).join(", ")}`, missing: missingKeys }, 422);
  }

  try {
    const out = await recommend(id, { slot: 1 });
    return json({ ok: true, ...out });
  } catch (e) {
    if ((e as { status?: number }).status === 422) return json({ error: (e as Error).message }, 422);
    throw e;
  }
});
