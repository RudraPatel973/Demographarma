import { db, must } from "@/lib/supabase";
import { json, pick, route } from "@/lib/api";

type Ctx = { params: Promise<{ id: string }> };

/** Update status (draft -> submitted -> approved/denied/appealed) or the edited letter. */
export const PATCH = route(async (req: Request, { params }: Ctx) => {
  const { id } = await params;
  const body = await req.json();
  const update = { ...pick(body, ["status", "letter"]), updated_at: new Date().toISOString() };
  must(await db().from("prior_auths").update(update).eq("id", id).select("id"));
  return json({ ok: true });
});
