import { db, must } from "@/lib/supabase";
import { json, route } from "@/lib/api";
import { buildProfile } from "@/lib/scoring";
import { comboMonthlyCost, findCombination, monthlyCost, pickStrength, sameForm, separateReasons, type Combination, type PriceRow } from "@/lib/plan";
import type { Encounter, Medication, Patient } from "@/lib/types";
import { comboCoverage, coverageFor, loadCoverageContext } from "@/lib/coverage-server";

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
  const allMeds = must(await db().from("medications").select("*")) as Medication[];
  const medsById = new Map(allMeds.map((m) => [m.id, m]));
  const meds = allMeds.filter((m) => m.id === a.medication_id || m.id === b.medication_id);
  const medA = meds.find((m) => m.id === a.medication_id)!;
  const medB = meds.find((m) => m.id === b.medication_id)!;
  const combos = must(await db().from("combination_products").select("*")) as Combination[];
  const prices = must(await db().from("drug_prices").select("rxcui,name,medication_id,combination_id,dose_mg,nadac_per_unit")) as PriceRow[];

  const separateCost = (() => {
    const x = monthlyCost(prices, medA, a.dose_mg);
    const y = monthlyCost(prices, medB, b.dose_mg);
    return x != null && y != null ? Math.round((x + y) * 100) / 100 : null;
  })();
  const found = findCombination(combos, medA.id, medB.id);
  const combo = found ? sameForm(found, medsById) : null;

  /**
   * No single pill for this exact pair? Look for one that swaps either drug for a same-class sibling
   * (e.g. chlorthalidone -> hydrochlorothiazide gives lisinopril/HCTZ). Offered as an option, not the default,
   * because it changes a drug the doctor picked.
   */
  const alternative = (() => {
    const options: { keep: Medication; keepDose: number; swapFrom: Medication; swapTo: Medication }[] = [];
    for (const [keep, keepDose, other] of [[medA, a.dose_mg, medB], [medB, b.dose_mg, medA]] as const) {
      for (const c of combos) {
        const partnerId = c.medication_a === keep.id ? c.medication_b : c.medication_b === keep.id ? c.medication_a : null;
        const partner = partnerId ? medsById.get(partnerId) : null;
        if (partner && partner.id !== other.id && partner.class_key === other.class_key) options.push({ keep, keepDose, swapFrom: other, swapTo: partner });
      }
    }
    for (const o of options) {
      const c = sameForm(findCombination(combos, o.keep.id, o.swapTo.id)!, medsById);
      const pick = pickStrength(c, o.keep.id, o.keepDose, o.swapTo.start_dose_mg ?? o.swapTo.usual_dose_min_mg ?? 0);
      if (!pick) continue;
      const [dk, ds] = pick.flip ? [pick.product.dose_b, pick.product.dose_a] : [pick.product.dose_a, pick.product.dose_b];
      return {
        id: c.id,
        name: c.name,
        brands: c.brand_names,
        product_rxcui: pick.product.rxcui,
        product_name: pick.product.name,
        exact: pick.exact,
        label: `${o.keep.generic_name}/${o.swapTo.generic_name} ${dk}/${ds} mg`,
        swap: { from: o.swapFrom.generic_name, to: o.swapTo.generic_name, from_id: o.swapFrom.id, to_id: o.swapTo.id },
        monthly_cost: comboMonthlyCost(prices, pick.product.rxcui),
      };
    }
    return null;
  })();
  const reasons = separateReasons(buildProfile(patient, enc), medA, medB);

  if (!combo) {
    return json({ recommendation: "separate", reasons: [`No single-pill combination of ${medA.generic_name} + ${medB.generic_name} exists.`, ...reasons], separate: { monthly_cost: separateCost }, combo: null, alternative: reasons.length ? null : alternative });
  }
  const pick = pickStrength(combo, medA.id, a.dose_mg, b.dose_mg);
  if (!pick) {
    return json({
      recommendation: "separate",
      reasons: [`${combo.name} isn't made in a strength close to ${a.dose_mg} mg + ${b.dose_mg} mg.`, ...reasons],
      separate: { monthly_cost: separateCost },
      combo: { id: combo.id, name: combo.name, brands: combo.brand_names, strengths: combo.products.map((p) => p.name) },
      alternative: reasons.length ? null : alternative,
    });
  }
  const [doseA, doseB] = pick.flip ? [pick.product.dose_b, pick.product.dose_a] : [pick.product.dose_a, pick.product.dose_b];
  const comboCost = comboMonthlyCost(prices, pick.product.rxcui);
  // Insurance: a brand combination often needs PA/step therapy while the two generics don't
  const ctx = await loadCoverageContext(patient, enc);
  const comboCov = comboCoverage(ctx, pick.product.rxcui);
  const sepCov = [coverageFor(ctx, prices, allMeds, medA, a.dose_mg), coverageFor(ctx, prices, allMeds, medB, b.dose_mg)];
  const comboBlocked = comboCov.status === "not_covered" || (comboCov.prior_auth && !comboCov.pa_criteria_met) || (comboCov.step_therapy && !comboCov.step_met);
  const sepClean = sepCov.every((c) => c.status === "covered");
  if (ctx.formularyKnown && comboBlocked && sepClean) {
    reasons.push(`On ${ctx.planName}, the combination pill is ${comboCov.label.toLowerCase()} but both generics are covered without restrictions.`);
  }
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
    coverage: comboCov,
  };
  // Single pill is the guideline preference (better adherence) unless there's a clinical reason to keep them separate
  // Only default to one pill when it delivers exactly the chosen doses
  if (!pick.exact) reasons.push(`The closest single tablet is ${doseA}/${doseB} mg, which changes the chosen dose (${a.dose_mg}/${b.dose_mg} mg).`);
  const recommendation = reasons.length ? "separate" : "combo";
  return json({ recommendation, reasons, combo: spc, separate: { monthly_cost: separateCost, coverage: sepCov } });
});
