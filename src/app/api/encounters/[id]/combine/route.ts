import { db, must } from "@/lib/supabase";
import { json, route } from "@/lib/api";
import { buildProfile } from "@/lib/scoring";
import { comboMonthlyCost, findCombination, monthlyCost, pickStrength, separateReasons, type Combination, type PriceRow } from "@/lib/plan";
import type { Encounter, Medication, Patient } from "@/lib/types";

type Ctx = { params: Promise<{ id: string }> };

/**
 * Pill 1 + pill 2 chosen: is there a single tablet with both, at these doses, and is it the better option?
 * Body: { a: { medication_id, dose_mg }, b: { medication_id, dose_mg } }
 */
export const POST = route(async (req: Request, { params }: Ctx) => {
  const { id } = await params;
  const { a, b } = (await req.json()) as { a: { medication_id: string; dose_mg: number }; b: { medication_id: string; dose_mg: number } };
  const enc = must(await db().from("encounters").select("*").eq("id", id).single()) as Encounter;
  const patient = must(await db().from("patients").select("*").eq("id", enc.patient_id).single()) as Patient;
  const meds = must(await db().from("medications").select("*").in("id", [a.medication_id, b.medication_id])) as Medication[];
  const medA = meds.find((m) => m.id === a.medication_id)!;
  const medB = meds.find((m) => m.id === b.medication_id)!;
  const combos = must(await db().from("combination_products").select("*")) as Combination[];
  const prices = must(await db().from("drug_prices").select("rxcui,name,medication_id,combination_id,dose_mg,nadac_per_unit")) as PriceRow[];

  const separateCost = (() => {
    const x = monthlyCost(prices, medA, a.dose_mg);
    const y = monthlyCost(prices, medB, b.dose_mg);
    return x != null && y != null ? Math.round((x + y) * 100) / 100 : null;
  })();
  const combo = findCombination(combos, medA.id, medB.id);
  const reasons = separateReasons(buildProfile(patient, enc), medA, medB);

  if (!combo) {
    return json({ recommendation: "separate", reasons: [`No single-pill combination of ${medA.generic_name} + ${medB.generic_name} exists.`, ...reasons], separate: { monthly_cost: separateCost }, combo: null });
  }
  const pick = pickStrength(combo, medA.id, a.dose_mg, b.dose_mg);
  if (!pick) {
    return json({
      recommendation: "separate",
      reasons: [`${combo.name} isn't made in a strength close to ${a.dose_mg} mg + ${b.dose_mg} mg.`, ...reasons],
      separate: { monthly_cost: separateCost },
      combo: { id: combo.id, name: combo.name, brands: combo.brand_names, strengths: combo.products.map((p) => p.name) },
    });
  }
  const [doseA, doseB] = pick.flip ? [pick.product.dose_b, pick.product.dose_a] : [pick.product.dose_a, pick.product.dose_b];
  const comboCost = comboMonthlyCost(prices, pick.product.rxcui);
  const spc = {
    id: combo.id,
    name: combo.name,
    brands: combo.brand_names,
    product_rxcui: pick.product.rxcui,
    product_name: pick.product.name,
    exact: pick.exact,
    dose_a: doseA,
    dose_b: doseB,
    label: `${medA.generic_name}/${medB.generic_name} ${doseA}/${doseB} mg`,
    monthly_cost: comboCost,
  };
  // Single pill is the guideline preference (better adherence) unless there's a clinical reason to keep them separate
  const recommendation = reasons.length ? "separate" : "combo";
  return json({ recommendation, reasons, combo: spc, separate: { monthly_cost: separateCost } });
});
