import { json, route } from "@/lib/api";
import { reviewObservation } from "@/lib/inference";

type Ctx = { params: Promise<{ id: string; obsId: string }> };

/** Review. Body: { status: "accepted" | "rejected", auto?: boolean }. Accepting writes the value into the chart. */
export const PATCH = route(async (req: Request, { params }: Ctx) => {
  const { id, obsId } = await params;
  const { status, auto } = (await req.json()) as { status?: string; auto?: boolean };
  if (status !== "accepted" && status !== "rejected") return json({ error: "status must be accepted or rejected" }, 400);
  try {
    return json(await reviewObservation(id, obsId, status, auto ? "auto" : "clinician"));
  } catch (e) {
    const code = (e as { status?: number }).status;
    if (code) return json({ error: (e as Error).message }, code);
    throw e;
  }
});
