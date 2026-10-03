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

/** Photon's AddressInput (country is required). Null if incomplete. */
export function photonAddress(p: Patient) {
  const a = p.address;
  if (!a?.street1 || !a?.city || !a?.state || !a?.postalCode) return null;
  return { street1: a.street1, street2: a.street2 || undefined, city: a.city, state: a.state, postalCode: a.postalCode, country: "US" };
}

/**
 * Create the patient in Photon, or update the existing record so Photon has the latest
 * contact details and default order address (so the doctor isn't asked for it again).
 */
export async function syncPhotonPatient(p: Patient): Promise<string> {
  const address = photonAddress(p) ?? undefined;
  const fields = {
    name: { first: p.first_name, last: p.last_name },
    dateOfBirth: p.date_of_birth,
    sex: p.sex,
    phone: toE164(p.phone ?? ""),
    email: p.email || undefined,
    address,
  };
  if (p.photon_patient_id) {
    await gql<{ updatePatient: { id: string } }>(
      `mutation updatePatient($id: ID!, $name: NameInput, $dateOfBirth: AWSDate, $sex: SexType, $phone: AWSPhone, $email: AWSEmail, $address: AddressInput) {
        updatePatient(id: $id, name: $name, dateOfBirth: $dateOfBirth, sex: $sex, phone: $phone, email: $email, address: $address) { id }
      }`,
      { id: p.photon_patient_id, ...fields },
    );
    return p.photon_patient_id;
  }
  const data = await gql<{ createPatient: { id: string } }>(
    `mutation createPatient($externalId: ID, $name: NameInput!, $dateOfBirth: AWSDate!, $sex: SexType!, $phone: AWSPhone!, $email: AWSEmail, $address: AddressInput) {
      createPatient(externalId: $externalId, name: $name, dateOfBirth: $dateOfBirth, sex: $sex, phone: $phone, email: $email, address: $address) { id }
    }`,
    { externalId: p.id, ...fields },
  );
  return data.createPatient.id;
}

/** Strength string from RxNorm that matches the dose, e.g. "lisinopril 10 MG Oral Tablet". */
export function strengthFor(m: Medication, doseMg: number | null) {
  if (!doseMg) return m.available_strengths[0] ?? null;
  const re = new RegExp(`\\b${String(doseMg).replace(".", "\\.")} MG\\b`, "i");
  return m.available_strengths.find((s) => re.test(s) && /tablet/i.test(s)) ?? m.available_strengths.find((s) => re.test(s)) ?? null;
}

type Treatment = { id: string; name: string };

async function rxcuiForName(name: string): Promise<string | null> {
  const exact = await fetch(`https://rxnav.nlm.nih.gov/REST/rxcui.json?name=${encodeURIComponent(name)}&search=2`).then((r) => r.json()).catch(() => null);
  const id = exact?.idGroup?.rxnormId?.[0];
  if (id) return id;
  const approx = await fetch(`https://rxnav.nlm.nih.gov/REST/approximateTerm.json?term=${encodeURIComponent(name)}&maxEntries=1`).then((r) => r.json()).catch(() => null);
  return approx?.approximateGroup?.candidate?.[0]?.rxcui ?? null;
}

async function searchCatalog(drug: { code?: string; name?: string }): Promise<Treatment[]> {
  const d = await gql<{ medications: Treatment[] }>(
    `query medications($filter: MedicationFilter, $first: Int) { medications(filter: $filter, first: $first) { id name } }`,
    { filter: { drug }, first: 15 },
  );
  return d.medications ?? [];
}

const doseRe = (mg: number) => new RegExp(`(^|[^\\d.])${String(mg).replace(".", "\\.")}\\s*mg\\b`, "i");

/** Single-ingredient product with exactly this ingredient and dose (no combination pills, no brand combos). */
function pickSingle(list: Treatment[], ingredient: string, doseMg: number | null) {
  const ing = ingredient.split(/[\s/]/)[0].toLowerCase();
  const ok = list.filter((t) => {
    const n = t.name.toLowerCase();
    if (!n.includes(ing) || n.includes(",") && /\d\s*mg\s*,/.test(n)) return false; // "A 5 mg, B 10 mg" = combination
    if (/\(.*\d\s*mg.*\)/.test(n)) return false; // "Brand (A 5 mg, B 40 mg)"
    return doseMg ? doseRe(doseMg).test(n) : true;
  });
  return ok.find((t) => !/\[|\(/.test(t.name)) ?? ok[0] ?? null;
}

/** Combination or free-text product: every ingredient word and every dose in the request must appear. */
function pickAll(list: Treatment[], request: string) {
  const words = request.toLowerCase().match(/[a-z]{4,}/g)?.filter((w) => !["oral", "tablet", "capsule", "extended", "release"].includes(w)) ?? [];
  const doses = request.match(/\d+(\.\d+)?/g)?.map(Number) ?? [];
  const ok = list.filter((t) => words.every((w) => t.name.toLowerCase().includes(w)) && doses.every((d) => doseRe(d).test(t.name)));
  return ok.find((t) => !t.name.includes("(")) ?? ok[0] ?? null;
}

const titleCase = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/**
 * Resolve our medication + dose to a Photon treatment id.
 * Searches by RxNorm code and by Photon-style name, then keeps only an exact ingredient + dose match.
 * Returns null when nothing is safe; the doctor then searches inside Photon's widget.
 */
export async function findTreatment(m: Medication, doseMg: number | null): Promise<Treatment | null> {
  const base = m.generic_name.replace(/ (extended|delayed)-release/, "");
  const strength = strengthFor(m, doseMg);
  const code = strength ? await rxcuiForName(strength) : null;
  const er = /extended-release/.test(m.generic_name);
  const [byCode, byName] = await Promise.all([
    code ? searchCatalog({ code }) : Promise.resolve([]),
    doseMg ? searchCatalog({ name: `${titleCase(base)} ${doseMg} mg Oral tablet${er ? ", extended release" : ""}` }) : Promise.resolve([]),
  ]);
  const all = [...byCode, ...byName].filter((t) => !er || /extended|er\b|xl|cd|la\b/i.test(t.name));
  return pickSingle(all, base, doseMg);
}

/** For doctor overrides (e.g. "losartan/hydrochlorothiazide 50/12.5 mg"). */
export async function findTreatmentByName(name: string): Promise<Treatment | null> {
  const normalized = name.replace(/\//g, " ");
  const code = await rxcuiForName(name);
  const [byCode, byName] = await Promise.all([code ? searchCatalog({ code }) : Promise.resolve([]), searchCatalog({ name: normalized })]);
  return pickAll([...byCode, ...byName], normalized);
}

/** Single-pill combination by its RxNorm code (+ name as a fallback), verified to contain every ingredient and dose. */
export async function findComboTreatment(productRxcui: string, label: string): Promise<Treatment | null> {
  const [byCode, byName] = await Promise.all([searchCatalog({ code: productRxcui }), searchCatalog({ name: label.replace(/\//g, " ") })]);
  return pickAll([...byCode, ...byName], label.replace(/\//g, " "));
}

/** Practice + prescriber details Photon already knows (org name/phone/NPI, latest prescriber's name and email). */
export async function photonOrgProfile() {
  const d = await gql<{
    organization: { name: string; NPI: string | null; phone: string | null; fax: string | null };
    prescriptions: { prescriber: { name: { full: string } | null; email: string | null; phone: string | null; fax: string | null } | null }[];
  }>(`{ organization { name NPI phone fax } prescriptions(first: 1) { prescriber { name { full } email phone fax } } }`, {});
  const pr = d.prescriptions?.[0]?.prescriber;
  const fmtPhone = (x: string | null | undefined) => (x ? x.replace(/^\+1(\d{3})(\d{3})(\d{4})$/, "($1) $2-$3") : null);
  return {
    practice_name: d.organization?.name ?? null,
    npi: d.organization?.NPI ?? null,
    phone: fmtPhone(d.organization?.phone ?? pr?.phone),
    fax: fmtPhone(d.organization?.fax ?? pr?.fax),
    prescriber_name: pr?.name?.full ?? null,
    email: pr?.email ?? null,
  };
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
