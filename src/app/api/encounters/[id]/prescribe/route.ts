import { db, must } from "@/lib/supabase";
import { json, route } from "@/lib/api";
import { ensurePhotonPatient, findTreatment, findTreatmentByName, mockMessage, photonMode } from "@/lib/photon";
import type { Medication, Patient, Recommendation } from "@/lib/types";

type Ctx = { params: Promise<{ id: string }> };

/**
 * The doctor's decision. Body:
 *  { recommendation_id, selection_reason, ...regimen }                      -> picked one of the 3
 *  { override: true, medication_id | custom_medication, selection_reason, ...regimen } -> their own prescription
 * regimen = dose_mg, sig, dispense_quantity, dispense_unit, days_supply, fills_allowed, notes
 */
export const POST = route(async (req: Request, { params }: Ctx) => {
  const { id } = await params;
  const body = await req.json();
  const enc = must(await db().from("encounters").select("patient_id").eq("id", id).single()) as { patient_id: string };
  const patient = must(await db().from("patients").select("*").eq("id", enc.patient_id).single()) as Patient;

  let rec: Recommendation | null = null;
  if (!body.override) {
    rec = must(await db().from("recommendations").select("*").eq("id", body.recommendation_id).eq("encounter_id", id).single()) as Recommendation;
  }
  const medicationId: string | null = rec?.medication_id ?? body.medication_id ?? null;
  const customName: string | null = !medicationId && body.custom_medication ? String(body.custom_medication).trim() : null;
  if (!medicationId && !customName) return json({ error: "Choose a medication." }, 400);
  if (body.override && !String(body.selection_reason ?? "").trim()) return json({ error: "Add a reason for overriding the recommendations." }, 400);
  const med = medicationId ? (must(await db().from("medications").select("*").eq("id", medicationId).single()) as Medication) : null;
  const drugLabel = med?.generic_name ?? customName!;

  const mode = photonMode();
  const rx = {
    encounter_id: id,
    patient_id: patient.id,
    medication_id: medicationId,
    custom_medication: customName,
    recommendation_id: rec?.id ?? null,
    is_override: Boolean(body.override),
    selection_reason: body.selection_reason ? String(body.selection_reason) : null,
    dose_mg: body.dose_mg === "" || body.dose_mg == null ? rec?.dose_mg ?? null : Number(body.dose_mg),
    sig: String(body.sig ?? rec?.sig ?? "").trim(),
    dispense_quantity: Number(body.dispense_quantity ?? rec?.dispense_quantity ?? 30),
    dispense_unit: String(body.dispense_unit ?? "Tablet"),
    days_supply: Number(body.days_supply ?? rec?.days_supply ?? 30),
    fills_allowed: Number(body.fills_allowed ?? rec?.fills_allowed ?? 1),
    notes: body.notes || null,
    photon_mode: mode,
    status: "draft",
  };
  if (!rx.sig || !rx.dispense_quantity || !rx.days_supply) return json({ error: "Directions, quantity and days supply are required." }, 400);

  must(
    await db()
      .from("encounters")
      .update({ chosen_recommendation_id: rec?.id ?? null, status: "med_chosen", updated_at: new Date().toISOString() })
      .eq("id", id)
      .select("id"),
  );

  if (mode === "live") {
    const missing = (["first_name", "last_name", "date_of_birth", "sex", "phone"] as const).filter((k) => !patient[k]);
    if (missing.length) return json({ error: `Photon needs the patient's ${missing.join(", ").replace(/_/g, " ")}. Add them to the chart first.` }, 400);
    const photonPatientId = await ensurePhotonPatient(patient);
    if (photonPatientId !== patient.photon_patient_id) {
      must(await db().from("patients").update({ photon_patient_id: photonPatientId }).eq("id", patient.id).select("id"));
    }
    const treatment = med ? await findTreatment(med, rx.dose_mg) : await findTreatmentByName(customName!);
    const created = must(await db().from("prescriptions").insert({ ...rx, photon_treatment_id: treatment?.id ?? null }).select("id").single()) as { id: string };
    return json({
      prescription_id: created.id,
      mode,
      photon: {
        clientId: process.env.NEXT_PUBLIC_PHOTON_CLIENT_ID,
        orgId: process.env.NEXT_PUBLIC_PHOTON_ORG_ID,
        devMode: (process.env.PHOTON_ENV ?? "neutron") === "neutron",
        patientId: photonPatientId,
        treatment,
        weightKg: patient.weight_kg,
      },
    });
  }

  // Mock: order created immediately, patient gets a text
  const created = must(
    await db().from("prescriptions").insert({ ...rx, status: "patient_notified", photon_order_id: `ord_mock_${Date.now()}` }).select("id").single(),
  ) as { id: string };
  const origin = new URL(req.url).origin;
  must(
    await db()
      .from("patient_messages")
      .insert({
        patient_id: patient.id,
        prescription_id: created.id,
        body: mockMessage("notified", { first: patient.first_name ?? "there", drug: `${drugLabel}${rx.dose_mg ? ` ${rx.dose_mg} mg` : ""}`, link: `${origin}/patient/${patient.id}` }),
        source: "photon_mock",
      })
      .select("id"),
  );
  must(await db().from("encounters").update({ status: "prescribed" }).eq("id", id).select("id"));
  return json({ prescription_id: created.id, mode });
});
