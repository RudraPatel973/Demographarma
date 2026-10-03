import { db, must } from "@/lib/supabase";
import { json, route } from "@/lib/api";
import { recommend } from "@/lib/recommend";
import type { Recommendation } from "@/lib/types";

type Ctx = { params: Promise<{ id: string }> };
export const maxDuration = 300;

/** Two-drug plans: the doctor picked pill 1 -> rank complementary drugs for pill 2. Body: { recommendation_id, dose_mg } */
export const POST = route(async (req: Request, { params }: Ctx) => {
  const { id } = await params;
  const body = await req.json();
  const rec = must(await db().from("recommendations").select("*").eq("id", body.recommendation_id).eq("encounter_id", id).single()) as Recommendation;
  const dose = body.dose_mg === "" || body.dose_mg == null ? rec.dose_mg : Number(body.dose_mg);
  try {
    const out = await recommend(id, { slot: 2, first: { medication_id: rec.medication_id, dose_mg: dose, recommendation_id: rec.id } });
    return json({ ok: true, ...out });
  } catch (e) {
    if ((e as { status?: number }).status === 422) return json({ error: (e as Error).message }, 422);
    throw e;
  }
});
