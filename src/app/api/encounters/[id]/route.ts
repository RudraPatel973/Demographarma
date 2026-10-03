import { db, must } from "@/lib/supabase";
import { json, pick, route } from "@/lib/api";
import { getEncounterBundle } from "@/lib/data";

type Ctx = { params: Promise<{ id: string }> };

export const GET = route(async (_req: Request, { params }: Ctx) => {
  const { id } = await params;
  return json(await getEncounterBundle(id));
});

const FIELDS = ["transcript", "patient_text", "video_path", "documents", "vitals", "labs", "diagnosis_id", "diagnosis_notes", "status"];

export const PATCH = route(async (req: Request, { params }: Ctx) => {
  const { id } = await params;
  const body = await req.json();
  const update = { ...pick(body, FIELDS), updated_at: new Date().toISOString() };
  must(await db().from("encounters").update(update).eq("id", id).select("id").single());
  return json({ ok: true });
});
