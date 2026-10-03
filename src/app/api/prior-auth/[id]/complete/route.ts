import { db, must } from "@/lib/supabase";
import { json, route } from "@/lib/api";
import { buildPriorAuth } from "@/lib/prior-auth";
import { saveClinicProfile } from "@/lib/clinic";
import { approxDate } from "@/lib/clinical";
import type { Encounter, Patient } from "@/lib/types";

type Ctx = { params: Promise<{ id: string }> };
export const maxDuration = 120;

/**
 * Fill the gaps the packet listed, then rebuild the form + letter in place.
 * Body: { clinic?: {npi, fax, address}, trials?: [{trial_id, started_when}], adherence?, member_id? }
 */
export const POST = route(async (req: Request, { params }: Ctx) => {
  const { id } = await params;
  const b = await req.json();
  const pa = must(await db().from("prior_auths").select("*").eq("id", id).single()) as {
    encounter_id: string;
    patient_id: string;
    form: { request?: { medication_id: string | null; dose_mg: number | null; combo: { id: string; product_rxcui: string; label: string } | null; sig: string | null; quantity: number | null } };
  };

  const clinic = Object.fromEntries(Object.entries(b.clinic ?? {}).filter(([, v]) => typeof v === "string" && v.trim()));
  if (Object.keys(clinic).length) await saveClinicProfile(clinic as Record<string, string>);

  for (const t of b.trials ?? []) {
    if (!t.trial_id || !t.started_when) continue;
    // accept "2 years ago", "2023", "March 2024" or a real date
    const date = /^\d{4}-\d{2}-\d{2}$/.test(t.started_when) ? t.started_when : approxDate(t.started_when);
    if (date) await db().from("medication_trials").update({ started_on: date }).eq("id", t.trial_id).eq("patient_id", pa.patient_id);
  }
  if (typeof b.adherence === "string" && b.adherence.trim()) {
    const enc = must(await db().from("encounters").select("live_state").eq("id", pa.encounter_id).single()) as Pick<Encounter, "live_state">;
    await db().from("encounters").update({ live_state: { ...enc.live_state, adherence: b.adherence.trim() } }).eq("id", pa.encounter_id);
  }
  if (typeof b.member_id === "string" && b.member_id.trim()) {
    const p = must(await db().from("patients").select("insurance").eq("id", pa.patient_id).single()) as Pick<Patient, "insurance">;
    await db().from("patients").update({ insurance: { ...(p.insurance ?? {}), member_id: b.member_id.trim() } }).eq("id", pa.patient_id);
  }

  const r = pa.form.request;
  await buildPriorAuth({
    encounterId: pa.encounter_id,
    medicationId: r?.medication_id ?? null,
    doseMg: r?.dose_mg ?? null,
    combo: r?.combo ?? null,
    sig: r?.sig ?? null,
    quantity: r?.quantity ?? null,
    existingId: id,
  });
  return json({ ok: true });
});
