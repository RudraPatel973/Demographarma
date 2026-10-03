import { db, must } from "@/lib/supabase";
import { json, route } from "@/lib/api";

/** Returning-patient search: ?q=name */
export const GET = route(async (req: Request) => {
  const q = (new URL(req.url).searchParams.get("q") ?? "").trim();
  let query = db()
    .from("patients")
    .select("id,first_name,last_name,date_of_birth,sex,conditions,updated_at")
    .not("first_name", "is", null)
    .order("updated_at", { ascending: false })
    .limit(20);
  if (q) query = query.or(`first_name.ilike.%${q.replace(/[%,()]/g, "")}%,last_name.ilike.%${q.replace(/[%,()]/g, "")}%`);
  return json(must(await query));
});
