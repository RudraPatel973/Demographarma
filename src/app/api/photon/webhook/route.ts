import { db, must } from "@/lib/supabase";
import { json, route } from "@/lib/api";
import { statusFromEvent, verifyWebhook } from "@/lib/photon";

/**
 * Photon webhook receiver. Register https://<your-domain>/api/photon/webhook in the
 * Photon (Neutron) settings page with a shared secret = PHOTON_WEBHOOK_SECRET.
 * The order's externalId is our prescription id (set via external-order-id on the element).
 */
export const POST = route(async (req: Request) => {
  const raw = await req.text();
  if (!verifyWebhook(raw, req.headers.get("x-photon-signature"))) return json({ error: "Invalid signature" }, 401);
  const evt = JSON.parse(raw) as { id: string; type: string; subject?: string; data: Record<string, any> }; // eslint-disable-line @typescript-eslint/no-explicit-any

  // Idempotency: ignore events we've already processed
  const existing = await db().from("photon_events").select("id").eq("id", evt.id).maybeSingle();
  if (existing.data) return json({ ok: true, duplicate: true });

  const orderId: string | undefined = evt.data?.id;
  const externalId: string | undefined = evt.data?.externalId;
  let rx: { id: string; patient_id: string; encounter_id: string } | null = null;
  if (externalId) rx = (await db().from("prescriptions").select("id,patient_id,encounter_id").eq("id", externalId).maybeSingle()).data;
  if (!rx && orderId) rx = (await db().from("prescriptions").select("id,patient_id,encounter_id").eq("photon_order_id", orderId).maybeSingle()).data;

  must(await db().from("photon_events").insert({ id: evt.id, prescription_id: rx?.id ?? null, type: evt.type, subject: evt.subject ?? null, payload: evt }).select("id"));

  const status = statusFromEvent(evt.type, evt.data ?? {});
  if (rx && status) {
    must(await db().from("prescriptions").update({ status, photon_order_id: orderId ?? undefined, updated_at: new Date().toISOString() }).eq("id", rx.id).select("id"));
    const text: Record<string, string> = {
      patient_notified: "Photon texted the patient to confirm their pharmacy.",
      pharmacy_selected: `Order sent to ${evt.data?.pharmacy?.name ?? "the pharmacy"}.`,
      filled: "The pharmacy reports the prescription is ready.",
      picked_up: "The patient picked up the prescription.",
      canceled: "The order was canceled.",
    };
    if (text[status]) {
      must(await db().from("patient_messages").insert({ patient_id: rx.patient_id, prescription_id: rx.id, body: text[status], source: "photon" }).select("id"));
    }
    if (status === "picked_up") must(await db().from("encounters").update({ status: "completed" }).eq("id", rx.encounter_id).select("id"));
  }
  return json({ ok: true });
});
