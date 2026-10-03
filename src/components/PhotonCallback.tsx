"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { Loader2 } from "lucide-react";

export const PHOTON_RETURN_KEY = "photon:return";

/**
 * Photon's sign-in sends the doctor back to the whitelisted origin (https://<site>/?photon=true&code=…&state=…).
 * A <photon-client> must be on that page to finish the sign-in, so this (mounted in the root layout)
 * completes it and then returns to the visit that started the sign-in.
 */
export function PhotonCallback({ clientId, orgId, devMode }: { clientId?: string; orgId?: string; devMode: boolean }) {
  // Read the URL on the client only (server snapshot = false) to avoid a hydration mismatch
  const active = useSyncExternalStore(
    () => () => {},
    () => {
      if (!clientId || !orgId) return false;
      const q = new URLSearchParams(window.location.search);
      return q.has("photon") && q.has("state") && (q.has("code") || q.has("error"));
    },
    () => false,
  );
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!active) return;
    const q = new URLSearchParams(window.location.search);
    if (q.has("error")) {
      // Defer so the state update isn't synchronous inside the effect
      setTimeout(() => setError(q.get("error_description") || q.get("error")), 0);
      return;
    }
    let returnTo = "/";
    try {
      returnTo = sessionStorage.getItem(PHOTON_RETURN_KEY) || "/";
    } catch {
      /* storage unavailable */
    }
    import("@photonhealth/elements")
      .then(() => {
        const client = document.createElement("photon-client");
        client.setAttribute("id", clientId!);
        client.setAttribute("org", orgId!);
        client.setAttribute("redirect-uri", window.location.origin);
        client.setAttribute("redirect-path", returnTo);
        if (devMode) client.setAttribute("dev-mode", "true");
        client.style.display = "none";
        document.body.appendChild(client);
        // If Photon doesn't navigate within a few seconds, go back anyway
        setTimeout(() => window.location.replace(returnTo), 8000);
      })
      .catch((e) => setError(String(e)));
  }, [active, clientId, orgId, devMode]);

  if (!active) return null;
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-white/90" role="status">
      <div className="text-center">
        {error ? (
          <>
            <p className="font-medium text-red-700">Photon sign-in failed</p>
            <p className="mt-1 max-w-md text-sm text-slate-600">{error}</p>
            <Link href="/" className="mt-3 inline-block text-sm text-sky-700 hover:underline">
              Back to visits
            </Link>
          </>
        ) : (
          <>
            <Loader2 className="mx-auto animate-spin text-brand-600" />
            <p className="mt-3 text-sm text-slate-600">Finishing Photon sign-in…</p>
          </>
        )}
      </div>
    </div>
  );
}
