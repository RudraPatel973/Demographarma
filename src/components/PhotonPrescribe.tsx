"use client";

import { useEffect, useRef, useState } from "react";
import { PHOTON_RETURN_KEY } from "./PhotonCallback";

export interface PhotonConfig {
  clientId: string;
  orgId: string;
  devMode: boolean;
  patientId: string;
  treatment: { id: string; name: string } | null;
  /** two-pill orders: one draft per pill (same order) */
  treatments?: ({ id: string; name: string } | null)[];
  weightKg: number | null;
  address?: { street1: string; street2?: string; city: string; state: string; postalCode: string; country?: string } | null;
}

/**
 * Embeds Photon's <photon-prescribe-workflow>. The prescriber signs in to Photon
 * (only authorized prescribers can write prescriptions), reviews the pre-filled draft
 * and clicks "Send Order". Photon then texts the patient to choose a pharmacy.
 */
export function PhotonPrescribe({
  config,
  prescriptionId,
  draft,
  onEvent,
  extraDrafts = [],
}: {
  config: PhotonConfig;
  prescriptionId: string;
  draft: { dispenseQuantity: number; dispenseUnit: string; fillsAllowed: number; daysSupply: number; instructions: string; notes?: string };
  /** extra pills in the same order (two-pill regimens) */
  extraDrafts?: { externalId: string; treatmentId: string | null; dispenseQuantity: number; dispenseUnit: string; fillsAllowed: number; daysSupply: number; instructions: string }[];
  onEvent: (e: { event: "prescriptions_created" | "order_created" | "error"; [k: string]: unknown }) => void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setSlow(true), 15000);
    return () => clearTimeout(t);
  }, []);

  useEffect(() => {
    let cancelled = false;
    const el = host.current;
    if (!el) return;

    import("@photonhealth/elements")
      .then(() => {
        if (cancelled) return;
        el.innerHTML = "";
        const client = document.createElement("photon-client");
        client.setAttribute("id", config.clientId);
        client.setAttribute("org", config.orgId);
        // Photon returns to the whitelisted origin; PhotonCallback (root layout) finishes sign-in and comes back here
        client.setAttribute("redirect-uri", window.location.origin);
        client.setAttribute("redirect-path", window.location.pathname);
        try {
          sessionStorage.setItem(PHOTON_RETURN_KEY, window.location.pathname);
        } catch {
          /* storage unavailable */
        }
        client.setAttribute("auto-login", "true");
        if (config.devMode) client.setAttribute("dev-mode", "true");

        const wf = document.createElement("photon-prescribe-workflow");
        wf.setAttribute("patient-id", config.patientId);
        wf.setAttribute("enable-order", "true");
        wf.setAttribute("enable-send-to-patient", "true");
        wf.setAttribute("enable-local-pickup", "true");
        wf.setAttribute("hide-templates", "true");
        wf.setAttribute("external-order-id", prescriptionId);
        if (config.weightKg) {
          wf.setAttribute("weight", String(config.weightKg));
          wf.setAttribute("weight-unit", "kg");
        }
        // Pre-fill the delivery/pharmacy-search address so the doctor isn't asked for it
        if (config.address) {
          const { street1, street2, city, state, postalCode } = config.address;
          wf.setAttribute("address", JSON.stringify({ street1, ...(street2 ? { street2 } : {}), city, state, postalCode, country: "US" }));
        }
        const initial = [
          ...(config.treatment ? [{ externalId: prescriptionId, treatmentId: config.treatment.id, dispenseAsWritten: false, ...draft }] : []),
          ...extraDrafts.filter((d) => d.treatmentId).map((d) => ({ ...d, dispenseAsWritten: false })),
        ];
        if (initial.length) wf.setAttribute("initial-prescriptions", JSON.stringify(initial));
        wf.setAttribute("additional-notes", "Selected with Volution decision support.");

        wf.addEventListener("photon-prescriptions-created", (e) => {
          const rx = (e as CustomEvent).detail?.prescriptions?.[0];
          onEvent({ event: "prescriptions_created", photon_prescription_id: rx?.id });
        });
        wf.addEventListener("photon-order-created", (e) => {
          onEvent({ event: "order_created", photon_order_id: (e as CustomEvent).detail?.order?.id });
        });
        wf.addEventListener("photon-order-error", (e) => onEvent({ event: "error", message: JSON.stringify((e as CustomEvent).detail?.errors ?? []) }));
        wf.addEventListener("photon-prescriptions-error", (e) => onEvent({ event: "error", message: JSON.stringify((e as CustomEvent).detail?.errors ?? []) }));

        client.appendChild(wf);
        el.appendChild(client);
      })
      .catch((e) => setError(`Could not load Photon Elements: ${e}`));

    return () => {
      cancelled = true;
      el.innerHTML = "";
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config.patientId, prescriptionId]);

  return (
    <div>
      {(!config.treatment || extraDrafts.some((d) => !d.treatmentId)) && (
        <p className="mb-3 rounded-lg bg-amber-50 p-3 text-sm text-amber-800">
          Photon&apos;s catalog didn&apos;t return an exact match for this drug and strength, so search for it in the widget below.
        </p>
      )}
      {error && <p className="mb-3 text-sm text-red-600">{error}</p>}
      <div ref={host} className="min-h-96" />
      {slow && (
        <p className="mt-2 text-xs text-slate-500">
          Still loading? Photon signs you in on its own page and sends you back here. Allow pop-ups/redirects for this site, and make sure{" "}
          <code className="rounded bg-slate-100 px-1">{typeof window !== "undefined" ? window.location.origin : ""}</code> is in Photon&apos;s whitelisted URLs.{" "}
          <button className="text-sky-700 hover:underline" onClick={() => window.location.reload()}>
            Reload
          </button>
        </p>
      )}
    </div>
  );
}
