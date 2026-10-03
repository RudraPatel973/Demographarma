import { randomUUID } from "node:crypto";
import { db, must } from "@/lib/supabase";
import { json, route } from "@/lib/api";
import { findComboTreatment, findTreatment, findTreatmentByName, mockMessage, photonAddress, photonMode, syncPhotonPatient } from "@/lib/photon";
import type { Medication, Patient, Recommendation } from "@/lib/types";

type Ctx = { params: Promise<{ id: string }> };

type Item = {
  recommendation_id?: string | null;
  medication_id?: string | null;
  custom_medication?: string | null;
  // single-pill combination
  combination_id?: string | null;
  combo_product_rxcui?: string | null;
  combo_label?: string | null;
  dose_mg?: number | string | null;
  sig?: string;
  dispense_quantity?: number;
  dispense_unit?: string;
  days_supply?: number;
  fills_allowed?: number;
  monthly_cost?: number | null;
};

/**
 * The doctor's decision. Body:
 *  { items: Item[], selection_reason?, override? }   -> one or two pills, or a single-pill combination
 *  { recommendation_id, ...regimen }                 -> (legacy) one of the recommendations
 *  { override: true, medication_id | custom_medication, ... } -> (legacy) doctor's own drug
 */
export const POST = route(async (req: Request, { params }: Ctx) => {
  const { id } = await params;
  const body = await req.json();
  const items: Item[] = Array.isArray(body.items) ? body.items : [body];
  if (!items.length) return json({ error: "Nothing to prescribe." }, 400);
  if (body.override && !String(body.selection_reason ?? "").trim()) return json({ error: "Add a reason for overriding the recommendations." }, 400);

  const enc = must(await db().from("encounters").select("patient_id").eq("id", id).single()) as { patient_id: string };
  const patient = must(await db().from("patients").select("*").eq("id", enc.patient_id).single()) as Patient;
  const mode = photonMode();
  const group = randomUUID();

  // Resolve each item
  const rows: (Record<string, unknown> & { label: string; med: Medication | null; item: Item })[] = [];
  for (const it of items) {
    const rec = it.recommendation_id
      ? (must(await db().from("recommendations").select("*").eq("id", it.recommendation_id).eq("encounter_id", id).single()) as Recommendation)
      : null;
    const medicationId = it.combination_id ? null : rec?.medication_id ?? it.medication_id ?? null;
    const custom = it.combination_id ? it.combo_label ?? null : !medicationId && it.custom_medication ? String(it.custom_medication).trim() : null;
    if (!medicationId && !custom) return json({ error: "Choose a medication." }, 400);
    const med = medicationId ? (must(await db().from("medications").select("*").eq("id", medicationId).single()) as Medication) : null;
    const sig = String(it.sig ?? rec?.sig ?? "").trim();
    if (!sig) return json({ error: "Directions are required for every medication." }, 400);
    rows.push({
      label: med?.generic_name ?? custom!,
      med,
      item: it,
      encounter_id: id,
      patient_id: patient.id,
      medication_id: medicationId,
      custom_medication: custom,
      combination_id: it.combination_id ?? null,
      recommendation_id: rec?.id ?? null,
      is_override: Boolean(body.override),
      selection_reason: body.selection_reason ? String(body.selection_reason) : null,
      dose_mg: it.combination_id ? null : it.dose_mg === "" || it.dose_mg == null ? rec?.dose_mg ?? null : Number(it.dose_mg),
      sig,
      dispense_quantity: Number(it.dispense_quantity ?? rec?.dispense_quantity ?? 30),
      dispense_unit: String(it.dispense_unit ?? "Tablet"),
      days_supply: Number(it.days_supply ?? rec?.days_supply ?? 30),
      fills_allowed: Number(it.fills_allowed ?? rec?.fills_allowed ?? 1),
      monthly_cost: it.monthly_cost ?? rec?.monthly_cost ?? null,
      order_group: group,
      photon_mode: mode,
      status: "draft",
    });
  }

  must(
    await db()
      .from("encounters")
      .update({ chosen_recommendation_id: (rows[0].recommendation_id as string) ?? null, status: "med_chosen", updated_at: new Date().toISOString() })
      .eq("id", id)
      .select("id"),
  );

  const toInsert = rows.map(({ label: _l, med: _m, item: _i, ...r }) => r);

  if (mode === "live") {
    const missing: string[] = (["first_name", "last_name", "date_of_birth", "sex", "phone"] as const).filter((k) => !patient[k]);
    if (!photonAddress(patient)) missing.push("home address");
    if (missing.length) return json({ error: `Photon needs the patient's ${missing.join(", ").replace(/_/g, " ")}. Add them to the chart first.` }, 400);
    const photonPatientId = await syncPhotonPatient(patient);
    if (photonPatientId !== patient.photon_patient_id) {
      must(await db().from("patients").update({ photon_patient_id: photonPatientId }).eq("id", patient.id).select("id"));
    }
    const treatments = await Promise.all(
      rows.map((r) =>
        r.item.combination_id && r.item.combo_product_rxcui
          ? findComboTreatment(r.item.combo_product_rxcui, r.label)
          : r.med
            ? findTreatment(r.med, r.dose_mg as number | null)
            : findTreatmentByName(r.label),
      ),
    );
    const created = must(
      await db()
        .from("prescriptions")
        .insert(toInsert.map((r, i) => ({ ...r, photon_treatment_id: treatments[i]?.id ?? null })))
        .select("id,photon_treatment_id,dispense_quantity,dispense_unit,fills_allowed,days_supply,sig,notes"),
    ) as { id: string }[];
    return json({
      prescription_id: created[0].id,
      prescription_ids: created.map((c) => c.id),
      mode,
      photon: {
        clientId: process.env.NEXT_PUBLIC_PHOTON_CLIENT_ID,
        orgId: process.env.NEXT_PUBLIC_PHOTON_ORG_ID,
        devMode: (process.env.PHOTON_ENV ?? "neutron") === "neutron",
        patientId: photonPatientId,
        treatment: treatments[0],
        treatments,
        weightKg: patient.weight_kg,
        address: photonAddress(patient),
      },
    });
  }

  // Mock: the order is created immediately and the patient gets one text for the whole order
  const created = must(
    await db().from("prescriptions").insert(toInsert.map((r) => ({ ...r, status: "patient_notified", photon_order_id: `ord_mock_${group.slice(0, 8)}` }))).select("id"),
  ) as { id: string }[];
  const origin = new URL(req.url).origin;
  const drugs = rows.map((r) => `${r.label}${r.dose_mg ? ` ${r.dose_mg} mg` : ""}`).join(" and ");
  must(
    await db()
      .from("patient_messages")
      .insert({
        patient_id: patient.id,
        prescription_id: created[0].id,
        body: mockMessage("notified", { first: patient.first_name ?? "there", drug: drugs, link: `${origin}/patient/${patient.id}` }),
        source: "photon_mock",
      })
      .select("id"),
  );
  must(await db().from("encounters").update({ status: "prescribed" }).eq("id", id).select("id"));
  return json({ prescription_id: created[0].id, prescription_ids: created.map((c) => c.id), mode });
});
