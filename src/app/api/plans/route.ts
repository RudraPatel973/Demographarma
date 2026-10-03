import { db, must } from "@/lib/supabase";
import { json, route } from "@/lib/api";

/** Insurance plan search for the chart editor: ?q=humana */
export const GET = route(async (req: Request) => {
  const q = (new URL(req.url).searchParams.get("q") ?? "").trim().replace(/[%,()]/g, "");
  let query = db().from("insurance_plans").select("id,name,payer,plan_type,formulary_id").order("plan_type").order("name").limit(25);
  if (q) query = query.or(`name.ilike.%${q}%,payer.ilike.%${q}%,id.ilike.%${q}%`);
  return json(must(await query));
});
