import { db, must } from "@/lib/supabase";
import { json, pick, route } from "@/lib/api";
import { completeAddress } from "@/lib/geocode";
import type { Address } from "@/lib/types";

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

const FIELDS = ["first_name", "last_name", "date_of_birth", "sex", "phone", "email", "address", "insurance"];

/** Register a patient ahead of their first visit. Name is required; the rest can be filled in during the visit. */
export const POST = route(async (req: Request) => {
  const body = await req.json().catch(() => ({}));
  const row: Record<string, unknown> = pick(body, FIELDS);
  for (const k of ["first_name", "last_name", "phone", "email"]) if (typeof row[k] === "string") row[k] = (row[k] as string).trim() || null;
  if (!row.first_name || !row.last_name) return json({ error: "First and last name are required" }, 400);
  if (row.address) row.address = await completeAddress(row.address as Address);
  const created = must(await db().from("patients").insert(row).select("id").single()) as { id: string };
  return json({ id: created.id });
});
