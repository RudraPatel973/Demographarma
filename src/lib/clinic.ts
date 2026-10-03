import "server-only";
import { db, MEDIA_BUCKET } from "./supabase";
import { photonMode, photonOrgProfile } from "./photon";

/** Practice + prescriber details used on prior-auth packets. Stored once in Settings; pre-filled from Photon. */
export interface ClinicProfile {
  practice_name: string;
  prescriber_name: string;
  credentials: string; // MD, DO, NP, PA
  npi: string;
  phone: string;
  fax: string;
  email: string;
  address: string;
}

const PATH = "settings/clinic.json";
const EMPTY: ClinicProfile = { practice_name: "", prescriber_name: "", credentials: "MD", npi: "", phone: "", fax: "", email: "", address: "" };

export async function getClinicProfile(): Promise<ClinicProfile & { from_photon: string[] }> {
  let saved: Partial<ClinicProfile> = {};
  const { data } = await db().storage.from(MEDIA_BUCKET).download(PATH);
  if (data) {
    try {
      saved = JSON.parse(await data.text());
    } catch {
      /* ignore a corrupt file */
    }
  }
  // Fill anything not saved yet from the Photon organization / most recent prescriber
  const fromPhoton: string[] = [];
  const merged: ClinicProfile = { ...EMPTY, ...saved };
  if (photonMode() === "live") {
    const org = await photonOrgProfile().catch(() => null);
    if (org) {
      for (const [k, v] of Object.entries(org) as [keyof ClinicProfile, string | null][]) {
        if (!merged[k] && v) {
          merged[k] = v;
          fromPhoton.push(k);
        }
      }
    }
  }
  return { ...merged, from_photon: fromPhoton };
}

export async function saveClinicProfile(p: Partial<ClinicProfile>) {
  const current = await getClinicProfile();
  const next: ClinicProfile = { ...EMPTY, ...current, ...p };
  const body = new Blob([JSON.stringify(next, null, 2)], { type: "application/json" });
  const { error } = await db().storage.from(MEDIA_BUCKET).upload(PATH, body, { upsert: true, contentType: "application/json" });
  if (error) throw new Error(error.message);
  return next;
}

/** What a packet still needs from the practice profile. */
export function clinicMissing(p: ClinicProfile) {
  const out: string[] = [];
  if (!p.prescriber_name) out.push("Prescriber name (Settings)");
  if (!/^\d{10}$/.test(p.npi)) out.push("Prescriber NPI (Settings)");
  if (!p.phone) out.push("Practice phone (Settings)");
  if (!p.fax) out.push("Practice fax (Settings)");
  if (!p.address) out.push("Practice address (Settings)");
  return out;
}
