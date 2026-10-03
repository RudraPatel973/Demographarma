import { db, must } from "@/lib/supabase";
import { json, route } from "@/lib/api";
import type { Prescription } from "@/lib/types";

type Ctx = { params: Promise<{ id: string }> };

/** Photon element config for an existing live prescription (used after a page reload). */
export const GET = route(async (_req: Request, { params }: Ctx) => {
  const { id } = await params;
  const rx = must(await db().from("prescriptions").select("*").eq("id", id).single()) as Prescription;
  const patient = must(await db().from("patients").select("photon_patient_id,weight_kg").eq("id", rx.patient_id).single()) as {
    photon_patient_id: string | null;
    weight_kg: number | null;
  };
  return json({
    clientId: process.env.NEXT_PUBLIC_PHOTON_CLIENT_ID,
    orgId: process.env.NEXT_PUBLIC_PHOTON_ORG_ID,
    devMode: (process.env.PHOTON_ENV ?? "neutron") === "neutron",
    patientId: patient.photon_patient_id,
    treatment: rx.photon_treatment_id ? { id: rx.photon_treatment_id, name: "" } : null,
    weightKg: patient.weight_kg,
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
  must(await db().from("prescriptions").update(update).eq("id", id).select("id"));
  return json({ ok: true });
});
