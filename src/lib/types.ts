export type Sex = "MALE" | "FEMALE" | "UNKNOWN";

export interface Address {
  street1?: string | null;
  street2?: string | null;
  city?: string | null;
  state?: string | null; // 2-letter
  postalCode?: string | null;
}

export function formatAddress(a: Address | null | undefined) {
  if (!a) return null;
  const line1 = [a.street1, a.street2].filter(Boolean).join(", ");
  const line2 = [a.city, [a.state, a.postalCode].filter(Boolean).join(" ")].filter(Boolean).join(", ");
  return [line1, line2].filter(Boolean).join(", ") || null;
}
export type PregnancyStatus = "not_applicable" | "not_pregnant" | "childbearing_potential" | "pregnant" | "breastfeeding";

export interface Patient {
  id: string;
  first_name: string | null;
  last_name: string | null;
  date_of_birth: string | null;
  dob_is_estimate: boolean;
  sex: Sex | null;
  ethnicity: string | null;
  phone: string | null;
  email: string | null;
  height_cm: number | null;
  weight_kg: number | null;
  conditions: string[];
  current_medications: string[];
  allergies: string[];
  pregnancy_status: PregnancyStatus;
  address: Address | null;
  photon_patient_id: string | null;
  created_at: string;
}

export interface TranscriptSegment {
  speaker: "doctor" | "patient" | "unknown";
  text: string;
  t: number; // seconds since recording start
}

export interface EncounterDocument {
  name: string;
  path: string;
  mime: string;
  size: number;
}

export interface Vitals {
  bp_systolic?: number | null;
  bp_diastolic?: number | null;
  heart_rate?: number | null;
}

export interface Labs {
  egfr?: number | null;
  potassium?: number | null;
  sodium?: number | null;
  uacr?: number | null;
}

export type EncounterStatus = "in_progress" | "recommended" | "med_chosen" | "prescribed" | "completed";

export interface Encounter {
  id: string;
  patient_id: string;
  status: EncounterStatus;
  transcript: TranscriptSegment[];
  patient_text: string | null;
  video_path: string | null;
  documents: EncounterDocument[];
  vitals: Vitals;
  labs: Labs;
  diagnosis_id: string | null;
  diagnosis_notes: string | null;
  chosen_recommendation_id: string | null;
  live_state: LiveState;
  plan?: TreatmentPlan;
  created_at: string;
  updated_at: string;
}

export interface TreatmentPlan {
  mode?: "single" | "dual" | "add_on";
  reason?: string;
  current?: string[];
  pill1?: { medication_id: string; dose_mg: number | null; recommendation_id?: string } | null;
}

export interface LiveState {
  notes?: string;            // clinically relevant things said (side effects, cost, preferences)
  diagnosis_quote?: string;  // what the doctor said that triggered generation
  extracted_at?: string;
  extracted_segments?: number;
}

export interface Diagnosis {
  id: string;
  name: string;
  icd10: string;
  description: string | null;
}

export interface Medication {
  id: string;
  generic_name: string;
  brand_names: string[];
  drug_class: string;
  class_key: string;
  rxcui: string | null;
  mechanism: string | null;
  usual_dose_min_mg: number | null;
  usual_dose_max_mg: number | null;
  start_dose_mg: number | null;
  start_dose_elderly_mg: number | null;
  doses_per_day: string | null;
  available_strengths: string[];
  avg_sbp_reduction: number | null;
  monitoring: string | null;
  pregnancy_safety: string | null;
  cost_tier: number | null;
  label_boxed_warning: string | null;
  label_contraindications: string | null;
  label_warnings: string | null;
  label_adverse_reactions: string | null;
  label_drug_interactions: string | null;
  label_dosage: string | null;
  dailymed_url: string | null;
  sources: { label: string; url: string; used_for: string }[];
}

export interface Recommendation {
  id: string;
  encounter_id: string;
  rank: number;
  medication_id: string;
  match_percent: number;
  rule_score: number | null;
  summary: string;
  rationale: string;
  factors_for: string[];
  factors_against: string[];
  dose_mg: number | null;
  sig: string | null;
  dispense_quantity: number | null;
  days_supply: number | null;
  fills_allowed: number | null;
  monitoring: string | null;
  engine: "ai" | "rules";
  model: string | null;
  slot?: number;
  monthly_cost?: number | null;
  created_at: string;
}

export type PrescriptionStatus =
  | "draft"
  | "sent_to_photon"
  | "order_created"
  | "patient_notified"
  | "pharmacy_selected"
  | "filled"
  | "picked_up"
  | "canceled"
  | "error";

export interface Prescription {
  id: string;
  encounter_id: string;
  patient_id: string;
  medication_id: string | null;
  custom_medication: string | null;
  recommendation_id: string | null;
  is_override: boolean;
  selection_reason: string | null;
  order_group?: string | null;
  combination_id?: string | null;
  monthly_cost?: number | null;
  dose_mg: number | null;
  sig: string;
  dispense_quantity: number;
  dispense_unit: string;
  days_supply: number;
  fills_allowed: number;
  notes: string | null;
  status: PrescriptionStatus;
  photon_mode: "live" | "mock";
  photon_treatment_id: string | null;
  photon_prescription_id: string | null;
  photon_order_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface PatientMessage {
  id: string;
  patient_id: string;
  prescription_id: string | null;
  channel: string;
  body: string;
  source: string;
  created_at: string;
}

/** Conditions the rule engine understands (keys referenced by Table 2). */
export const CONDITIONS: { key: string; label: string; group: string }[] = [
  { key: "diabetes", label: "Diabetes", group: "Metabolic / renal" },
  { key: "ckd", label: "Chronic kidney disease", group: "Metabolic / renal" },
  { key: "gout", label: "Gout / hyperuricemia", group: "Metabolic / renal" },
  { key: "hyponatremia_history", label: "History of hyponatremia", group: "Metabolic / renal" },
  { key: "bilateral_ras", label: "Bilateral renal artery stenosis", group: "Metabolic / renal" },
  { key: "primary_aldosteronism", label: "Primary aldosteronism", group: "Metabolic / renal" },
  { key: "resistant_htn", label: "Resistant hypertension (≥3 agents)", group: "Metabolic / renal" },
  { key: "hfref", label: "Heart failure, reduced EF", group: "Cardiac" },
  { key: "hfpef", label: "Heart failure, preserved EF", group: "Cardiac" },
  { key: "cad", label: "Coronary artery disease", group: "Cardiac" },
  { key: "post_mi", label: "Prior myocardial infarction", group: "Cardiac" },
  { key: "angina", label: "Angina", group: "Cardiac" },
  { key: "afib", label: "Atrial fibrillation", group: "Cardiac" },
  { key: "heart_block", label: "2nd/3rd-degree heart block", group: "Cardiac" },
  { key: "edema", label: "Peripheral edema", group: "Cardiac" },
  { key: "orthostatic_hypotension", label: "Orthostatic hypotension", group: "Cardiac" },
  { key: "stroke_tia", label: "Prior stroke / TIA", group: "Neuro / other" },
  { key: "migraine", label: "Migraine", group: "Neuro / other" },
  { key: "essential_tremor", label: "Essential tremor", group: "Neuro / other" },
  { key: "depression", label: "Depression", group: "Neuro / other" },
  { key: "asthma", label: "Asthma", group: "Neuro / other" },
  { key: "copd", label: "COPD", group: "Neuro / other" },
  { key: "raynaud", label: "Raynaud phenomenon", group: "Neuro / other" },
  { key: "hyperthyroidism", label: "Hyperthyroidism", group: "Neuro / other" },
  { key: "osteoporosis", label: "Osteoporosis", group: "Neuro / other" },
  { key: "bph", label: "Benign prostatic hyperplasia", group: "Neuro / other" },
  { key: "liver_disease", label: "Liver disease", group: "Neuro / other" },
  { key: "angioedema_history", label: "History of angioedema", group: "Drug reactions" },
  { key: "acei_cough", label: "Prior ACE-inhibitor cough", group: "Drug reactions" },
];

export const ETHNICITIES: { key: string; label: string }[] = [
  { key: "black", label: "Black / African American" },
  { key: "white", label: "White" },
  { key: "hispanic", label: "Hispanic / Latino" },
  { key: "east_asian", label: "East Asian" },
  { key: "south_asian", label: "South Asian" },
  { key: "southeast_asian", label: "Southeast Asian" },
  { key: "middle_eastern", label: "Middle Eastern / North African" },
  { key: "native_american", label: "American Indian / Alaska Native" },
  { key: "pacific_islander", label: "Native Hawaiian / Pacific Islander" },
  { key: "multiracial", label: "Multiracial" },
  { key: "unknown", label: "Prefer not to say" },
];

export function patientName(p: Pick<Patient, "first_name" | "last_name">) {
  const n = [p.first_name, p.last_name].filter(Boolean).join(" ");
  return n || "New patient";
}
