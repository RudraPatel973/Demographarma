import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import type { Medication, Patient, PrescriptionStatus } from "./types";

/**
 * Photon Health integration.
 *
 * Photon only lets an authorized, logged-in prescriber write prescriptions, so:
 *  - backend (M2M token): sync the patient, resolve the treatment id
 *  - frontend (<photon-prescribe-workflow>): prescriber reviews the pre-filled
 *    draft and clicks "Send Order"; Photon then texts the patient
 *  - webhooks: order lifecycle updates our prescription status
 *
 * Without credentials the app runs in mock mode with the same lifecycle.
 */

const ENV = (process.env.PHOTON_ENV ?? "neutron") as "neutron" | "photon";
const AUTH_URL = `https://auth.${ENV}.health/oauth/token`;
const AUDIENCE = `https://api.${ENV}.health`;
const API_URL = `https://api.${ENV}.health/graphql`;

export function photonMode(): "live" | "mock" {
  return process.env.PHOTON_CLIENT_ID &&
    process.env.PHOTON_CLIENT_SECRET &&
    process.env.NEXT_PUBLIC_PHOTON_CLIENT_ID &&
    process.env.NEXT_PUBLIC_PHOTON_ORG_ID
    ? "live"
    : "mock";
}

let token: { value: string; exp: number } | null = null;

async function accessToken() {
  if (token && token.exp > Date.now() + 60_000) return token.value;
  const res = await fetch(AUTH_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      client_id: process.env.PHOTON_CLIENT_ID,
      client_secret: process.env.PHOTON_CLIENT_SECRET,
      audience: AUDIENCE,
      grant_type: "client_credentials",
    }),
  });
  if (!res.ok) throw new Error(`Photon auth failed: ${res.status} ${await res.text()}`);
  const j = (await res.json()) as { access_token: string; expires_in: number };
  token = { value: j.access_token, exp: Date.now() + j.expires_in * 1000 };
  return token.value;
}

async function gql<T>(query: string, variables: Record<string, unknown>): Promise<T> {
  const res = await fetch(API_URL, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${await accessToken()}` },
    body: JSON.stringify({ query, variables }),
  });
  const j = (await res.json()) as { data?: T; errors?: { message: string }[] };
  if (!res.ok || j.errors?.length) throw new Error(`Photon GraphQL error: ${j.errors?.map((e) => e.message).join("; ") ?? res.status}`);
  return j.data as T;
}

/** E.164 for US numbers; leaves already-formatted numbers alone. */
export function toE164(phone: string) {
  const digits = phone.replace(/\D/g, "");
  if (phone.trim().startsWith("+")) return "+" + digits;
  if (digits.length === 10) return "+1" + digits;
  if (digits.length === 11 && digits.startsWith("1")) return "+" + digits;
  return "+" + digits;
}

export async function ensurePhotonPatient(p: Patient): Promise<string> {
  if (p.photon_patient_id) return p.photon_patient_id;
  const data = await gql<{ createPatient: { id: string } }>(
    `mutation createPatient($externalId: ID, $name: NameInput!, $dateOfBirth: AWSDate!, $sex: SexType!, $phone: AWSPhone!, $email: AWSEmail) {
      createPatient(externalId: $externalId, name: $name, dateOfBirth: $dateOfBirth, sex: $sex, phone: $phone, email: $email) { id }
    }`,
    {
      externalId: p.id,
      name: { first: p.first_name, last: p.last_name },
      dateOfBirth: p.date_of_birth,
      sex: p.sex,
      phone: toE164(p.phone ?? ""),
      email: p.email || undefined,
    },
  );
  return data.createPatient.id;
}

/** Strength string from RxNorm that matches the dose, e.g. "lisinopril 10 MG Oral Tablet". */
export function strengthFor(m: Medication, doseMg: number | null) {
  if (!doseMg) return m.available_strengths[0] ?? null;
  const re = new RegExp(`\\b${String(doseMg).replace(".", "\\.")} MG\\b`, "i");
  return m.available_strengths.find((s) => re.test(s) && /tablet/i.test(s)) ?? m.available_strengths.find((s) => re.test(s)) ?? null;
}

export async function findTreatment(m: Medication, doseMg: number | null): Promise<{ id: string; name: string } | null> {
  const q = `query medications($filter: MedicationFilter, $first: Int) { medications(filter: $filter, first: $first) { id name } }`;
  const strength = strengthFor(m, doseMg);
  for (const name of [strength, `${m.generic_name.replace(/ extended-release/, "")} ${doseMg ?? ""} MG`.trim(), m.generic_name]) {
    if (!name) continue;
    const d = await gql<{ medications: { id: string; name: string }[] }>(q, { filter: { drug: { name } }, first: 10 });
    if (d.medications?.length) {
      const exact = d.medications.find((x) => x.name.toLowerCase() === name.toLowerCase());
      return exact ?? d.medications[0];
    }
  }
  return null;
}

/** For doctor overrides with a drug that isn't in our table. */
export async function findTreatmentByName(name: string): Promise<{ id: string; name: string } | null> {
  const d = await gql<{ medications: { id: string; name: string }[] }>(
    `query medications($filter: MedicationFilter, $first: Int) { medications(filter: $filter, first: $first) { id name } }`,
    { filter: { drug: { name } }, first: 5 },
  );
  return d.medications?.[0] ?? null;
}

export function verifyWebhook(raw: string, signature: string | null) {
  const secret = process.env.PHOTON_WEBHOOK_SECRET ?? "";
  if (!signature) return false;
  const candidates = [raw];
  try {
    candidates.push(JSON.stringify(JSON.parse(raw)));
  } catch {
    return false;
  }
  return candidates.some((body) => {
    const digest = createHmac("sha256", secret).update(body).digest("hex");
    return digest.length === signature.length && timingSafeEqual(Buffer.from(digest), Buffer.from(signature));
  });
}

/** Map a Photon webhook event to our prescription status. */
export function statusFromEvent(type: string, data: { fulfillment?: { state?: string } }): PrescriptionStatus | null {
  switch (type) {
    case "photon:order:created":
      return "patient_notified"; // Photon texts the patient when the order is created
    case "photon:order:placed":
    case "photon:order:rerouted":
      return "pharmacy_selected";
    case "photon:order:fulfillment": {
      const s = data.fulfillment?.state ?? "";
      if (/PICKED_UP|DELIVERED/.test(s)) return "picked_up";
      if (/READY|FILLED|SHIPPED|RECEIVED/.test(s)) return "filled";
      return null;
    }
    case "photon:order:completed":
      return "picked_up";
    case "photon:order:canceled":
      return "canceled";
    default:
      return null;
  }
}

/** The SMS copy used for mock mode (mirrors what Photon sends). */
export function mockMessage(step: "notified" | "pharmacy" | "ready", ctx: { first: string; drug: string; pharmacy?: string; link?: string }) {
  switch (step) {
    case "notified":
      return `Hi ${ctx.first}, your doctor sent a prescription for ${ctx.drug}. Choose a pharmacy here: ${ctx.link}`;
    case "pharmacy":
      return `Your ${ctx.drug} prescription was sent to ${ctx.pharmacy}. We'll text you when it's ready.`;
    case "ready":
      return `Good news ${ctx.first} — your ${ctx.drug} is ready for pickup at ${ctx.pharmacy}.`;
  }
}
