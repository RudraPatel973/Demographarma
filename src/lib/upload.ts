/** Browser-side: get a signed URL from our API, then PUT the file straight to Supabase Storage. */
export async function uploadFile(encounterId: string, kind: "video" | "document" | "vitals", file: File): Promise<string> {
  const res = await fetch(`/api/encounters/${encounterId}/upload`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ kind, name: file.name }),
  });
  const j = await res.json();
  if (!res.ok) throw new Error(j.error ?? "Upload URL failed");
  // Same wire format as supabase-js uploadToSignedUrl
  const form = new FormData();
  form.append("cacheControl", "3600");
  form.append("", file);
  const put = await fetch(j.signedUrl, { method: "PUT", body: form, headers: { "x-upsert": "false" } });
  if (!put.ok) throw new Error(`Storage upload failed (${put.status})`);
  return j.path as string;
}
