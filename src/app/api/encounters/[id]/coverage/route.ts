import { db, must } from "@/lib/supabase";
import { json, route } from "@/lib/api";
import { loadCoverageContext, coverageFor } from "@/lib/coverage-server";
import type { PriceRow } from "@/lib/plan";
import type { Encounter, Medication, Patient } from "@/lib/types";

type Ctx = { params: Promise<{ id: string }> };

/** Coverage for any drug the doctor picks (used for overrides). ?medication_id=clonidine&dose_mg=0.1 */
export const GET = route(async (req: Request, { params }: Ctx) => {
  const { id } = await params;
  const q = new URL(req.url).searchParams;
  const medicationId = q.get("medication_id");
  if (!medicationId) return json({ coverage: null });
  const dose = q.get("dose_mg") ? Number(q.get("dose_mg")) : null;
  const enc = must(await db().from("encounters").select("patient_id,vitals").eq("id", id).single()) as Pick<Encounter, "patient_id" | "vitals">;
  const patient = must(await db().from("patients").select("*").eq("id", enc.patient_id).single()) as Patient;
  const meds = must(await db().from("medications").select("*")) as Medication[];
  const med = meds.find((m) => m.id === medicationId);
  if (!med) return json({ coverage: null });
  const prices = must(await db().from("drug_prices").select("rxcui,name,medication_id,combination_id,dose_mg,nadac_per_unit")) as PriceRow[];
  const ctx = await loadCoverageContext(patient, enc);
  return json({ coverage: coverageFor(ctx, prices, meds, med, dose) });
});
