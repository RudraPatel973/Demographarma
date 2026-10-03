import { db, must, MEDIA_BUCKET } from "@/lib/supabase";
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

/**
 * Remove visits: { ids: string[] }. Recommendations, prescriptions, packets and model observations cascade with the visit.
 * Also clears the visit's stored media and any blank patient record a "new patient" visit created.
 */
export const DELETE = route(async (req: Request) => {
  const { ids } = (await req.json().catch(() => ({}))) as { ids?: unknown };
  if (!Array.isArray(ids) || !ids.length || !ids.every((x) => typeof x === "string")) return json({ error: "ids required" }, 400);

  const visits = must(
    await db().from("encounters").select("id, patient_id, video_path, documents").in("id", ids),
  ) as { id: string; patient_id: string; video_path: string | null; documents: { path?: string }[] | null }[];
  if (!visits.length) return json({ deleted: 0 });

  const paths = visits.flatMap((v) => [v.video_path, ...(v.documents ?? []).map((d) => d.path)]).filter((p): p is string => !!p);
  // Check-in camera clips aren't referenced from the visit row; they live under <id>/vitals/
  for (const v of visits) {
    const { data } = await db().storage.from(MEDIA_BUCKET).list(`${v.id}/vitals`, { limit: 1000 });
    paths.push(...(data ?? []).map((f) => `${v.id}/vitals/${f.name}`));
  }
  if (paths.length) await db().storage.from(MEDIA_BUCKET).remove(paths);

  must(await db().from("encounters").delete().in("id", visits.map((v) => v.id)));

  // A patient shell with no name and no remaining visits is leftover from an abandoned intake
  const patientIds = [...new Set(visits.map((v) => v.patient_id))];
  const shells = must(
    await db().from("patients").select("id, first_name, last_name, encounters(id)").in("id", patientIds),
  ) as { id: string; first_name: string | null; last_name: string | null; encounters: { id: string }[] }[];
  const orphans = shells.filter((p) => !p.first_name && !p.last_name && !p.encounters.length).map((p) => p.id);
  if (orphans.length) await db().from("patients").delete().in("id", orphans);

  return json({ deleted: visits.length });
});
