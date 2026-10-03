import { db, must } from "@/lib/supabase";
import { json, route } from "@/lib/api";
import type { Patient, Prescription } from "@/lib/types";
import { photonAddress, photonMode, syncPhotonPatient } from "@/lib/photon";

type Ctx = { params: Promise<{ id: string }> };

/** Photon element config for an existing live prescription (used after a page reload). */
export const GET = route(async (_req: Request, { params }: Ctx) => {
  const { id } = await params;
  const rx = must(await db().from("prescriptions").select("*").eq("id", id).single()) as Prescription;
  const patient = must(await db().from("patients").select("*").eq("id", rx.patient_id).single()) as Patient;
  // Push any chart edits (e.g. an address added after the draft was created) to Photon before the widget opens
  if (photonMode() === "live" && patient.photon_patient_id) {
    await syncPhotonPatient(patient).catch((e) => console.error("[photon] patient sync failed:", e));
  }
  return json({
    clientId: process.env.NEXT_PUBLIC_PHOTON_CLIENT_ID,
    orgId: process.env.NEXT_PUBLIC_PHOTON_ORG_ID,
    devMode: (process.env.PHOTON_ENV ?? "neutron") === "neutron",
    patientId: patient.photon_patient_id,
    treatment: rx.photon_treatment_id ? { id: rx.photon_treatment_id, name: "" } : null,
    items: rx.order_group
      ? (must(await db().from("prescriptions").select("id,photon_treatment_id,dispense_quantity,dispense_unit,fills_allowed,days_supply,sig,notes").eq("order_group", rx.order_group).order("created_at")) as Prescription[])
      : [rx],
    weightKg: patient.weight_kg,
    address: photonAddress(patient),
  });
});

/**
 * Called by the Photon element in the browser:
 *  { event: "prescriptions_created", photon_prescription_id }
 *  { event: "order_created", photon_order_id }
 * Webhooks keep the status current after this.
 */
export const PATCH = route(async (req: Request, { params }: Ctx) => {
  const { id } = await params;
  const body = await req.json();
  const rx = must(await db().from("prescriptions").select("*").eq("id", id).single()) as Prescription;
  const update: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (body.event === "prescriptions_created") {
    update.status = "sent_to_photon";
    update.photon_prescription_id = body.photon_prescription_id ?? null;
  } else if (body.event === "order_created") {
    update.status = "patient_notified";
    update.photon_order_id = body.photon_order_id ?? null;
    must(
      await db()
        .from("patient_messages")
        .insert({ patient_id: rx.patient_id, prescription_id: id, body: "Photon texted the patient a link to choose a pharmacy.", source: "photon" })
        .select("id"),
    );
    must(await db().from("encounters").update({ status: "prescribed" }).eq("id", rx.encounter_id).select("id"));
  } else if (body.event === "error") {
    update.status = "error";
    update.notes = String(body.message ?? "Photon error");
  } else {
    return json({ error: "Unknown event" }, 400);
  }
  // A two-pill order moves together
  if (rx.order_group) must(await db().from("prescriptions").update(update).eq("order_group", rx.order_group).select("id"));
  else must(await db().from("prescriptions").update(update).eq("id", id).select("id"));
  return json({ ok: true });
});
