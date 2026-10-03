import "server-only";
import type { Address } from "./types";

/**
 * Fill in what the patient didn't say (usually the ZIP) using the US Census Bureau geocoder
 * (free, no key): "560 W 163rd St, New York, NY" -> ZIP 10032.
 * The apartment/unit can't be looked up, so street2 is left as spoken.
 */
const CENSUS = "https://geocoding.geo.census.gov/geocoder/locations/onelineaddress";

const titleCase = (s: string) => s.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());

export async function completeAddress(a: Address | null | undefined): Promise<Address | null | undefined> {
  if (!a?.street1) return a;
  if (a.postalCode && a.city && a.state) return a; // already complete
  if (!a.city && !a.state && !a.postalCode) return a; // not enough to match on
  const oneLine = [a.street1, a.city, a.state, a.postalCode].filter(Boolean).join(", ");
  try {
    const url = `${CENSUS}?${new URLSearchParams({ address: oneLine, benchmark: "Public_AR_Current", format: "json" })}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) return a;
    const j = (await res.json()) as { result?: { addressMatches?: { addressComponents: { zip?: string; city?: string; state?: string } }[] } };
    const m = j.result?.addressMatches?.[0]?.addressComponents;
    if (!m) return a;
    return {
      ...a,
      postalCode: a.postalCode || m.zip || null,
      city: a.city || (m.city ? titleCase(m.city) : null),
      state: a.state || m.state || null,
    };
  } catch {
    return a; // lookup is best-effort; the doctor can still type it
  }
}
