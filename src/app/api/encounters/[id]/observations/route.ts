import { json, route } from "@/lib/api";
import { listObservations, runVideoModels } from "@/lib/inference";

type Ctx = { params: Promise<{ id: string }> };

// Analysing a 30 s clip takes a while (the SDK reads the whole file)
export const maxDuration = 300;

export const GET = route(async (_req: Request, { params }: Ctx) => {
  const { id } = await params;
  return json(await listObservations(id));
});

/**
 * Check-in vitals. Body: { path } — the clip the browser uploaded via /upload (kind "vitals").
 * Runs every configured video model and returns what they inferred; nothing is written to the chart.
 */
export const POST = route(async (req: Request, { params }: Ctx) => {
  const { id } = await params;
  const { path } = (await req.json()) as { path?: string };
  if (!path?.startsWith(`${id}/vitals/`)) return json({ error: "Upload the check-in clip first" }, 400);
  try {
    return json(await runVideoModels(id, path));
  } catch (e) {
    const status = (e as { status?: number }).status;
    if (status) return json({ error: (e as Error).message }, status);
    throw e;
  }
});
