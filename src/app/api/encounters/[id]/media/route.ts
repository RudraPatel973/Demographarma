import { NextResponse } from "next/server";
import { db, MEDIA_BUCKET } from "@/lib/supabase";
import { json, route } from "@/lib/api";

type Ctx = { params: Promise<{ id: string }> };

/** Redirects to a short-lived signed URL for a file belonging to this visit. */
export const GET = route(async (req: Request, { params }: Ctx) => {
  const { id } = await params;
  const path = new URL(req.url).searchParams.get("path") ?? "";
  if (!path.startsWith(`${id}/`)) return json({ error: "Not found" }, 404);
  const { data, error } = await db().storage.from(MEDIA_BUCKET).createSignedUrl(path, 600);
  if (error || !data) return json({ error: error?.message ?? "Not found" }, 404);
  return NextResponse.redirect(data.signedUrl);
});
