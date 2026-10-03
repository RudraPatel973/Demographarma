import { json, pick, route } from "@/lib/api";
import { getClinicProfile, saveClinicProfile } from "@/lib/clinic";

export const GET = route(async () => json(await getClinicProfile()));

export const PUT = route(async (req: Request) => {
  const body = await req.json();
  const saved = await saveClinicProfile(pick(body, ["practice_name", "prescriber_name", "credentials", "npi", "phone", "fax", "email", "address"]) as Record<string, string>);
  return json(saved);
});
