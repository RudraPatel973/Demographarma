import { json, route } from "@/lib/api";
import { buildPriorAuth } from "@/lib/prior-auth";

type Ctx = { params: Promise<{ id: string }> };
export const maxDuration = 120;

/** Create a prior-auth / step-therapy-exception packet. Body: { medication_id, dose_mg, sig, quantity } or { combo: {id, product_rxcui, label}, sig } */
export const POST = route(async (req: Request, { params }: Ctx) => {
  const { id } = await params;
  const b = await req.json();
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
