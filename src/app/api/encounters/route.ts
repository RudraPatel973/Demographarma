import { db, must } from "@/lib/supabase";
import { json, route } from "@/lib/api";

/**
 * Start a visit.
 *   { patient_id }  -> returning patient (chart already on file)
 *   {}              -> new patient; the chart is filled in from the visit audio
 */
export const POST = route(async (req: Request) => {
  const body = await req.json().catch(() => ({}));
  let patientId: string | undefined = body.patient_id;
  if (!patientId) {
    const created = must(await db().from("patients").insert({}).select("id").single()) as { id: string };
    patientId = created.id;
  }
  const enc = must(await db().from("encounters").insert({ patient_id: patientId }).select("id").single()) as { id: string };
  return json({ id: enc.id, patient_id: patientId });
});
