import { db, must } from "@/lib/supabase";
import { json, pick, route } from "@/lib/api";
import { completeAddress } from "@/lib/geocode";
import type { Address } from "@/lib/types";

type Ctx = { params: Promise<{ id: string }> };

const FIELDS = [
  "first_name", "last_name", "date_of_birth", "sex", "ethnicity", "phone", "email",
  "height_cm", "weight_kg", "conditions", "current_medications", "allergies", "pregnancy_status", "address", "dob_is_estimate",
];

export const PATCH = route(async (req: Request, { params }: Ctx) => {
  const { id } = await params;
  const body = await req.json();
  const update: Record<string, unknown> = { ...pick(body, FIELDS), updated_at: new Date().toISOString() };
  // Typed addresses get the same ZIP/city/state completion as spoken ones
  if (update.address) update.address = await completeAddress(update.address as Address);
  const row = must(await db().from("patients").update(update).eq("id", id).select("*").single());
  return json(row);
});
