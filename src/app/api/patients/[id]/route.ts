import { db, must } from "@/lib/supabase";
import { json, pick, route } from "@/lib/api";

type Ctx = { params: Promise<{ id: string }> };

const FIELDS = [
  "first_name", "last_name", "date_of_birth", "sex", "ethnicity", "phone", "email",
  "height_cm", "weight_kg", "conditions", "current_medications", "allergies", "pregnancy_status", "address", "dob_is_estimate",
];

export const PATCH = route(async (req: Request, { params }: Ctx) => {
  const { id } = await params;
  const body = await req.json();
  const update = { ...pick(body, FIELDS), updated_at: new Date().toISOString() };
  const row = must(await db().from("patients").update(update).eq("id", id).select("*").single());
  return json(row);
});
