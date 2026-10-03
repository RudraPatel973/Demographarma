import type { Encounter, Patient } from "./types";

/**
 * What must be in the chart before recommendations are generated (shared by client and server).
 * Required items change which drugs fit or are needed by Photon to send the prescription.
 */
export type RequiredKey =
  | "first_name"
  | "last_name"
  | "date_of_birth"
  | "sex"
  | "phone"
  | "address"
  | "height_cm"
  | "weight_kg"
  | "blood_pressure"
  | "pregnancy_status";

export const REQUIRED_LABELS: Record<RequiredKey, string> = {
  first_name: "First name",
  last_name: "Last name",
  date_of_birth: "Date of birth",
  sex: "Sex",
  phone: "Mobile number",
  address: "Home address",
  height_cm: "Height",
  weight_kg: "Weight",
  blood_pressure: "Blood pressure",
  pregnancy_status: "Pregnancy status",
};

function ageOf(dob: string | null) {
  if (!dob) return null;
  const d = new Date(dob);
  const n = new Date();
  let a = n.getFullYear() - d.getFullYear();
  if (n.getMonth() < d.getMonth() || (n.getMonth() === d.getMonth() && n.getDate() < d.getDate())) a--;
  return a;
}

export function missingRequired(p: Patient, e: Pick<Encounter, "vitals">): RequiredKey[] {
  const out: RequiredKey[] = [];
  if (!p.first_name?.trim()) out.push("first_name");
  if (!p.last_name?.trim()) out.push("last_name");
  if (!p.date_of_birth) out.push("date_of_birth");
  if (!p.sex || p.sex === "UNKNOWN") out.push("sex");
  if (!p.phone || p.phone.replace(/\D/g, "").length < 10) out.push("phone");
  if (addressMissing(p)) out.push("address");
  if (!p.height_cm) out.push("height_cm");
  if (!p.weight_kg) out.push("weight_kg");
  if (!e.vitals?.bp_systolic || !e.vitals?.bp_diastolic) out.push("blood_pressure");
  const age = ageOf(p.date_of_birth);
  if (p.sex === "FEMALE" && age !== null && age >= 12 && age <= 55 && p.pregnancy_status === "not_applicable") out.push("pregnancy_status");
  return out;
}

/** Not blocking, but shown so the doctor knows the match is less certain. */
export function missingRecommended(e: Pick<Encounter, "labs">): string[] {
  const out: string[] = [];
  if (e.labs?.egfr == null) out.push("eGFR (kidney function)");
  if (e.labs?.potassium == null) out.push("Potassium");
  return out;
}

/** Street, city, state and ZIP present (ZIP is auto-looked-up when the street and city/state are said). */
export function addressMissing(p: Pick<Patient, "address">) {
  const a = p.address;
  return !a?.street1 || !a?.city || !a?.state || !a?.postalCode;
}
