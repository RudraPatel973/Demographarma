import { db, MEDIA_BUCKET } from "@/lib/supabase";
import { json, route } from "@/lib/api";

type Ctx = { params: Promise<{ id: string }> };

/**
 * Returns a one-time signed upload URL so the browser can PUT large files
 * (visit video, PDFs) straight to Supabase Storage without passing through Next.
 * Body: { kind: "video" | "document" | "vitals", name: string }  ("vitals" = the check-in camera clip)
 */
export const POST = route(async (req: Request, { params }: Ctx) => {
  const { id } = await params;
  const { kind, name } = (await req.json()) as { kind: "video" | "document" | "vitals"; name: string };
  if (!["video", "document", "vitals"].includes(kind)) return json({ error: "Unknown upload kind" }, 400);
  const safe = String(name || "file").replace(/[^\w.\-]+/g, "_").slice(-80);
  const path = `${id}/${kind}/${Date.now()}-${safe}`;
  const { data, error } = await db().storage.from(MEDIA_BUCKET).createSignedUploadUrl(path);
  if (error || !data) return json({ error: error?.message ?? "Could not create upload URL" }, 500);
  return json({ path, signedUrl: data.signedUrl });
});
