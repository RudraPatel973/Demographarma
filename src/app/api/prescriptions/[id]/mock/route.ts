import { db, must } from "@/lib/supabase";
import { json, route } from "@/lib/api";
import { mockMessage } from "@/lib/photon";
import type { Medication, Patient, Prescription } from "@/lib/types";

type Ctx = { params: Promise<{ id: string }> };

const PHARMACY = "CVS Pharmacy — 123 Main St";

/** Mock mode only: patient picks a pharmacy / pharmacy fills / patient picks up. */
export const POST = route(async (req: Request, { params }: Ctx) => {
  const { id } = await params;
  const { step } = (await req.json()) as { step: "pharmacy" | "ready" | "picked_up" };
  const rx = must(await db().from("prescriptions").select("*").eq("id", id).single()) as Prescription;
  if (rx.photon_mode !== "mock") return json({ error: "Only available in mock mode" }, 400);
  const patient = must(await db().from("patients").select("first_name").eq("id", rx.patient_id).single()) as Pick<Patient, "first_name">;

  const names = new Map(
    (must(await db().from("medications").select("id,generic_name")) as Pick<Medication, "id" | "generic_name">[]).map((m) => [m.id, m.generic_name]),
  );
  const status = step === "pharmacy" ? "pharmacy_selected" : step === "ready" ? "filled" : "picked_up";
  const group = rx.order_group
    ? (must(await db().from("prescriptions").select("id,medication_id,custom_medication,dose_mg").eq("order_group", rx.order_group)) as Prescription[])
    : [rx];
  must(await db().from("prescriptions").update({ status, updated_at: new Date().toISOString() }).in("id", group.map((g) => g.id)).select("id"));
  const drug = group.map((g) => `${(g.medication_id && names.get(g.medication_id)) || g.custom_medication}${g.dose_mg ? ` ${g.dose_mg} mg` : ""}`).join(" and ");
  if (step !== "picked_up") {
    must(
      await db()
        .from("patient_messages")
        .insert({ patient_id: rx.patient_id, prescription_id: id, body: mockMessage(step, { first: patient.first_name ?? "there", drug, pharmacy: PHARMACY }), source: "photon_mock" })
        .select("id"),
    );
  } else {
    must(await db().from("encounters").update({ status: "completed" }).eq("id", rx.encounter_id).select("id"));
  }
  return json({ ok: true, status });
});
