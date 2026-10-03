import { db, must } from "@/lib/supabase";
import { json, route } from "@/lib/api";
import { buildProfile, defaultRegimen, diversify, missingInputs, scoreCandidates, type ModifierRow, type Table1Row } from "@/lib/scoring";
import { llmModelName, llmProvider } from "@/lib/llm";
import { rankCandidates, syncFromTranscript } from "@/lib/clinical";
import type { Diagnosis, Encounter, Medication, Patient } from "@/lib/types";

type Ctx = { params: Promise<{ id: string }> };

// The ranking model over transcript + documents can take a while.
export const maxDuration = 300;

/**
 * Diagram flow:
 *  1. look up meds for the diagnosis in TABLE 1 (diagnosis_medications)
 *  2. take those meds + demographic modifiers from TABLE 2, score them
 *  3. send candidates + all other inputs (transcript, docs, profile) to the AI model
 *  4. store the top 3 with a match percentage
 */
export const POST = route(async (req: Request, { params }: Ctx) => {
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  // Catch up on anything said since the last live extraction
  if (body.sync && llmProvider()) {
    try {
      await syncFromTranscript(id);
    } catch (e) {
      console.error("[generate] final sync failed:", e);
    }
  }
  let encounter = must(await db().from("encounters").select("*").eq("id", id).single()) as Encounter;
  if (!encounter.diagnosis_id) {
    // Doctor ended the visit without a recognised diagnosis: this demo is hypertension-only
    encounter = must(await db().from("encounters").update({ diagnosis_id: "essential_hypertension" }).eq("id", id).select("*").single()) as Encounter;
  }
  const patient = must(await db().from("patients").select("*").eq("id", encounter.patient_id).single()) as Patient;
  const diagnosis = must(await db().from("diagnoses").select("*").eq("id", encounter.diagnosis_id).single()) as Diagnosis;

  // 1. Table 1
  const table1 = must(
    await db().from("diagnosis_medications").select("medication_id,line_of_therapy,base_score,guideline,notes").eq("diagnosis_id", diagnosis.id),
  ) as Table1Row[];
  const meds = must(await db().from("medications").select("*").in("id", table1.map((r) => r.medication_id))) as Medication[];

  // 2. Table 2
  const modifiers = must(await db().from("demographic_modifiers").select("*").eq("active", true)) as ModifierRow[];
  const profile = buildProfile(patient, encounter);
  const scored = scoreCandidates(table1, meds, modifiers, profile);
  const eligible = scored.filter((c) => !c.contraindicated);
  const excluded = scored.filter((c) => c.contraindicated);
  // best per class first, so the model sees real alternatives (rule-only top 3 = 3 different classes)
  const candidates = diversify(eligible, 12);
  const missing = missingInputs(profile);
  if (candidates.length === 0) return json({ error: "Every medication for this diagnosis is contraindicated for this patient." }, 422);

  const excludedSummary = excluded.map((c) => ({
    medication_id: c.medication.id,
    name: c.medication.generic_name,
    reasons: c.fired.filter((f) => f.effect === "contraindicated").map((f) => ({ matched: f.matched, rationale: f.rationale, source: f.source })),
  }));
  const candidateSummary = candidates.map((c) => ({
    medication_id: c.medication.id,
    name: c.medication.generic_name,
    line_of_therapy: c.line_of_therapy,
    base_score: c.base_score,
    rule_score: c.rule_score,
    fired: c.fired,
  }));

  // 3. AI ranking (falls back to the rule engine if no key or the call fails)
  let engine: "ai" | "rules" = "rules";
  let clinicalNote: string | null = null;
  let stopReason: string | null = null;
  let usage: unknown = null;
  let model: string | null = null;
  let aiError: string | null = null;
  let rows: Record<string, unknown>[] = [];
  const createdAt = new Date().toISOString();

  if (llmProvider()) {
    try {
      const out = await rankCandidates({ patient, profile, encounter, diagnosis, candidates, excluded, missing });
      const byId = new Map(candidates.map((c) => [c.medication.id, c]));
      const seen = new Set<string>();
      const recs = out.data.recommendations
        .filter((r) => byId.has(r.medication_id) && !seen.has(r.medication_id) && seen.add(r.medication_id))
        .slice(0, 3);
      if (recs.length) {
        engine = "ai";
        model = out.model;
        stopReason = "end_turn";
        usage = out.usage;
        clinicalNote = [
          out.data.clinical_summary,
          out.data.combination_note ? `Combination therapy: ${out.data.combination_note}` : null,
          out.data.safety_flags.length ? `Safety flags: ${out.data.safety_flags.join("; ")}` : null,
        ]
          .filter(Boolean)
          .join("\n\n");
        rows = recs
          .sort((a, b) => b.match_percent - a.match_percent)
          .map((r, i) => {
            const c = byId.get(r.medication_id)!;
            const min = c.medication.usual_dose_min_mg ?? 0;
            const max = c.medication.usual_dose_max_mg ?? Number.MAX_SAFE_INTEGER;
            const startFloor = Math.min(min, c.medication.start_dose_elderly_mg ?? c.medication.start_dose_mg ?? min);
            const doseOk = r.dose_mg >= startFloor && r.dose_mg <= max;
            const fallback = defaultRegimen(c.medication, profile.age);
            return {
              encounter_id: id,
              rank: i + 1,
              medication_id: r.medication_id,
              match_percent: Math.max(1, Math.min(99, Math.round(r.match_percent))), // never claim certainty
              rule_score: c.rule_score,
              summary: r.summary,
              rationale: r.rationale,
              factors_for: r.factors_for,
              factors_against: r.factors_against,
              dose_mg: doseOk ? r.dose_mg : fallback.dose_mg,
              sig: doseOk ? r.sig : fallback.sig,
              dispense_quantity: r.dispense_quantity || fallback.dispense_quantity,
              days_supply: r.days_supply || fallback.days_supply,
              fills_allowed: r.fills_allowed || fallback.fills_allowed,
              monitoring: r.monitoring,
              engine,
              model,
              created_at: createdAt,
            };
          });
      }
    } catch (e) {
      aiError = e instanceof Error ? e.message : String(e);
      console.error("[generate] AI ranking failed, using rule engine:", aiError);
    }
  }

  if (engine === "rules") {
    rows = candidates.slice(0, 3).map((c, i) => {
      const reg = defaultRegimen(c.medication, profile.age);
      return {
        encounter_id: id,
        rank: i + 1,
        medication_id: c.medication.id,
        match_percent: c.rule_score,
        rule_score: c.rule_score,
        summary: `${c.medication.drug_class} — ${c.line_of_therapy.replace("_", " ")} for ${diagnosis.name.toLowerCase()}.`,
        rationale: c.fired.length
          ? c.fired.map((f) => `${f.delta >= 0 ? "+" : ""}${f.delta}: ${f.rationale}`).join(" ")
          : "No patient-specific modifiers applied; ranked by guideline line of therapy.",
        factors_for: c.fired.filter((f) => f.delta > 0).map((f) => f.rationale),
        factors_against: c.fired.filter((f) => f.delta < 0).map((f) => f.rationale),
        ...reg,
        monitoring: c.medication.monitoring,
        engine,
        model: null,
        created_at: createdAt,
      };
    });
    clinicalNote = aiError
      ? `The AI model was unavailable (${aiError}). These results come from the rule engine only.`
      : "No AI model is configured. These results come from the rule engine only.";
  }

  // 4. Persist
  must(await db().from("recommendations").insert(rows).select("id"));
  must(
    await db()
      .from("generation_runs")
      .insert({ encounter_id: id, engine, model: model ?? (engine === "ai" ? llmModelName() : null), candidates: candidateSummary, excluded: excludedSummary, clinical_note: clinicalNote, stop_reason: stopReason, usage })
      .select("id"),
  );
  must(await db().from("encounters").update({ status: "recommended", updated_at: createdAt }).eq("id", id).select("id"));

  return json({ ok: true, engine, missing, excluded: excludedSummary.length, error: aiError });
});
