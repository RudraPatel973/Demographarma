import { json, route } from "@/lib/api";
import { db, must } from "@/lib/supabase";
import type { Prescription } from "@/lib/types";
import { buildPriorAuth } from "@/lib/prior-auth";

type Ctx = { params: Promise<{ id: string }> };
export const maxDuration = 120;

/** Create a prior-auth / step-therapy-exception packet. Body: { medication_id, dose_mg, sig, quantity } or { combo: {id, product_rxcui, label}, sig } */
export const POST = route(async (req: Request, { params }: Ctx) => {
  const { id } = await params;
  const b = await req.json();
  if (b.prescription_id) {
    // a packet for something already sent: take the drug, dose, sig and quantity from the prescription itself
    const rx = must(await db().from("prescriptions").select("*").eq("id", b.prescription_id).eq("encounter_id", id).single()) as Prescription;
    const combo = rx.combination_id
      ? ((await db().from("combination_products").select("id,product_rxcui,label").eq("id", rx.combination_id).maybeSingle()).data as { id: string; product_rxcui: string; label: string } | null)
      : null;
    if (!rx.medication_id && !combo) return json({ error: "A packet needs a drug from the list — this prescription was written by name only." }, 422);
    const paId = await buildPriorAuth({
      encounterId: id,
      medicationId: rx.medication_id,
      doseMg: rx.dose_mg,
      combo,
      sig: rx.sig,
      quantity: rx.dispense_quantity,
      prescriptionId: rx.id,
    });
    return json({ id: paId });
  }
  const paId = await buildPriorAuth({
    encounterId: id,
    medicationId: b.medication_id ?? null,
    doseMg: b.dose_mg == null || b.dose_mg === "" ? null : Number(b.dose_mg),
    combo: b.combo ?? null,
    sig: b.sig ?? null,
    quantity: b.quantity ?? null,
  });
  return json({ id: paId });
});
