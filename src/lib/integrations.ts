/**
 * Catalogue for the /tools page: the AI models, agents, data sources and services that plug into
 * each step of a visit. "integrated" entries are built into this app (the comment on each names
 * where); "available" and "planned" are categories a clinic could add, so they name no vendor.
 */

export type Stage = "check_in" | "visit" | "decision" | "prescribe" | "follow_up";
export type Kind = "AI model" | "AI agent" | "Data source" | "Service";
export type Status = "integrated" | "available" | "planned";

export interface Integration {
  id: string;
  name: string;
  vendor?: string;
  stage: Stage;
  kind: Kind;
  status: Status;
  /** One line: what it does for the clinic */
  summary: string;
  inputs: string[];
  outputs: string[];
  /** What happens to its output */
  review: string;
  /** Bullet list for featured cards */
  capabilities?: string[];
  /** Vendor docs (integrated vendors only) */
  link?: string;
  featured?: boolean;
}

export const STAGES: { key: Stage; label: string; blurb: string }[] = [
  { key: "check_in", label: "Check-in", blurb: "Before the conversation starts: vitals and intake." },
  { key: "visit", label: "Visit", blurb: "While the doctor and patient talk: the chart fills itself in." },
  { key: "decision", label: "Decision", blurb: "Choosing the medication that fits this patient and their plan." },
  { key: "prescribe", label: "Prescribe", blurb: "Getting the prescription signed, covered and sent." },
  { key: "follow_up", label: "Follow-up", blurb: "After the patient leaves: pharmacy, pickup and blood pressure at home." },
];

export const STATUS_LABEL: Record<Status, string> = { integrated: "Integrated", available: "Available", planned: "Planned" };

export const INTEGRATIONS: Integration[] = [
  // ---- Check-in
  {
    // src/lib/inference/smartspectra.ts
    id: "camera_vitals",
    name: "Camera vitals",
    vendor: "Presage SmartSpectra",
    stage: "check_in",
    kind: "AI model",
    status: "integrated",
    summary: "Measures pulse, breathing and heart-rate variability from a short camera clip, no device on the patient.",
    inputs: ["Camera clip of the patient's face"],
    outputs: ["Pulse", "Breathing rate", "HRV"],
    review: "A reliable pulse goes into the chart tagged with its source; the doctor can overwrite it.",
    link: "https://smartspectra.presagetech.com/docs/nodejs/",
  },
  {
    id: "bp_cuff",
    name: "Connected BP cuff",
    stage: "check_in",
    kind: "Service",
    status: "available",
    summary: "Reads blood pressure from a Bluetooth cuff at check-in instead of typing it in.",
    inputs: ["Cuff reading"],
    outputs: ["Systolic / diastolic BP", "Pulse"],
    review: "Added to the chart with its source.",
  },
  {
    id: "intake_agent",
    name: "Intake questionnaire agent",
    stage: "check_in",
    kind: "AI agent",
    status: "planned",
    summary: "Asks the patient about symptoms, medications and allergies on their phone before the visit.",
    inputs: ["Patient's answers"],
    outputs: ["Pre-filled chart", "Visit notes"],
    review: "Shown to the doctor to confirm during the visit.",
  },

  // ---- Visit
  {
    // src/lib/clinical.ts syncFromTranscript, src/components/useVisitRecorder.ts
    id: "ambient_scribe",
    name: "Ambient scribe & live chart",
    vendor: "Speech recognition + LLM",
    stage: "visit",
    kind: "AI agent",
    status: "integrated",
    summary: "Listens to the visit and fills in the chart as details are said: demographics, conditions, medications, vitals, diagnosis.",
    inputs: ["Visit audio"],
    outputs: ["Transcript", "Structured chart", "Diagnosis"],
    review: "Doctor sees the chart fill in live and can edit anything.",
  },
  {
    // src/lib/llm.ts loadAttachments
    id: "document_reader",
    name: "Document reader",
    vendor: "LLM",
    stage: "visit",
    kind: "AI model",
    status: "integrated",
    summary: "Reads lab reports, referrals and photos the doctor attaches and pulls out what matters for prescribing.",
    inputs: ["PDFs", "Images", "Text"],
    outputs: ["Labs", "Conditions", "History"],
    review: "Findings appear in the chart for the doctor to check.",
  },
  {
    id: "medical_scribe",
    name: "Medical-grade ambient scribe",
    stage: "visit",
    kind: "AI agent",
    status: "available",
    summary: "Swap in a dedicated clinical scribe product for speaker separation and full visit notes.",
    inputs: ["Visit audio"],
    outputs: ["Visit note", "Transcript"],
    review: "Doctor signs the note.",
  },

  // ---- Decision
  {
    // src/lib/scoring.ts, data/hypertension/knowledge.ts
    id: "rule_engine",
    name: "Guideline rule engine",
    vendor: "RxNorm · openFDA · AHA/ACC, KDIGO, ADA guidelines",
    stage: "decision",
    kind: "Data source",
    status: "integrated",
    summary: "Scores every guideline-listed drug against the patient's age, conditions, labs, vitals and current medications, and rules out contraindicated ones.",
    inputs: ["Diagnosis", "Patient profile"],
    outputs: ["Shortlist with reasons", "Excluded drugs"],
    review: "Every rule cites its source; reasons show on each recommendation.",
  },
  {
    // src/lib/clinical.ts rankCandidates
    id: "ai_ranking",
    name: "AI ranking",
    vendor: "Claude, or any configured model",
    stage: "decision",
    kind: "AI model",
    status: "integrated",
    summary: "Reads the transcript, documents and shortlist, then picks the top 3 with a match %, rationale and dose.",
    inputs: ["Shortlist", "Transcript", "Documents"],
    outputs: ["Top 3 with match %", "Dose and directions"],
    review: "Limited to the rule engine's shortlist; doses checked against the label; the doctor chooses.",
  },
  {
    // src/lib/coverage.ts, src/lib/coverage-server.ts, scripts/load-partd.ts
    id: "coverage",
    name: "Insurance coverage",
    vendor: "CMS Part D formularies · NADAC prices",
    stage: "decision",
    kind: "Data source",
    status: "integrated",
    summary: "Checks each option against the patient's drug plan: tier, prior auth, step therapy, and expected cost.",
    inputs: ["Patient's plan", "Candidate drugs"],
    outputs: ["Coverage per drug", "Cheaper covered alternatives"],
    review: "Nudges close options only; clinical fit stays primary.",
  },
  {
    // supabase/migrations/0004_two_pill_plans.sql, src/app/api/encounters/[id]/combine
    id: "combinations",
    name: "Single-pill combinations",
    vendor: "RxNorm",
    stage: "decision",
    kind: "Data source",
    status: "integrated",
    summary: "When two drugs are needed, finds a single pill that combines them.",
    inputs: ["Two chosen drugs"],
    outputs: ["Combination product and strengths"],
    review: "Offered to the doctor as an option.",
  },
  {
    id: "interactions",
    name: "Drug-interaction database",
    stage: "decision",
    kind: "Data source",
    status: "available",
    summary: "Adds a commercial interaction and dosing database on top of the built-in label checks.",
    inputs: ["Current medications", "Candidate drug"],
    outputs: ["Interaction alerts"],
    review: "Alerts shown on the recommendation.",
  },
  {
    id: "pgx",
    name: "Pharmacogenomics",
    stage: "decision",
    kind: "Data source",
    status: "planned",
    summary: "Uses a patient's genetic test results to flag drugs they may process too fast or too slowly.",
    inputs: ["Genetic test results"],
    outputs: ["Drug–gene flags"],
    review: "Shown as factors for or against each drug.",
  },

  // ---- Prescribe
  {
    // src/lib/photon.ts, src/components/PhotonPrescribe.tsx, /api/photon/webhook
    id: "photon",
    name: "E-prescribing & fulfilment",
    vendor: "Photon Health",
    stage: "prescribe",
    kind: "Service",
    status: "integrated",
    featured: true,
    summary: "Sends the chosen prescription to the patient's pharmacy and keeps the visit updated until it's picked up.",
    inputs: ["Chosen drug and dose", "Patient details"],
    outputs: ["Signed e-prescription", "Order status"],
    capabilities: [
      "Syncs the patient to Photon and finds the exact treatment and strength",
      "Opens Photon's prescribe widget pre-filled; the prescriber signs and sends",
      "Photon texts the patient to choose a pharmacy",
      "Order status flows back automatically: sent, pharmacy selected, filled, picked up",
      "Practice and prescriber details prefill Settings and prior-auth packets",
    ],
    review: "Prescriber signs every order in Photon.",
  },
  {
    // src/lib/prior-auth.ts, src/lib/clinic.ts
    id: "prior_auth",
    name: "Prior-auth agent",
    vendor: "LLM + Photon prescriber data",
    stage: "prescribe",
    kind: "AI agent",
    status: "integrated",
    summary: "Builds prior-authorization and step-therapy exception packets, with a letter of medical necessity written only from documented facts.",
    inputs: ["Chart", "Plan requirements", "Prior drug trials"],
    outputs: ["PA form", "Letter of medical necessity"],
    review: "Doctor fills any gaps and reviews the packet before submitting it to the plan.",
  },
  {
    // src/lib/geocode.ts
    id: "geocoder",
    name: "Address completion",
    vendor: "US Census geocoder",
    stage: "prescribe",
    kind: "Data source",
    status: "integrated",
    summary: "Fills in the ZIP code and city from the address the patient says out loud, so the prescription can be sent.",
    inputs: ["Spoken address"],
    outputs: ["Complete mailing address"],
    review: "Shown in the chart.",
  },
  {
    id: "price_compare",
    name: "Pharmacy price comparison",
    stage: "prescribe",
    kind: "Service",
    status: "available",
    summary: "Shows the cash and insured price at nearby pharmacies before the patient picks one.",
    inputs: ["Drug and dose", "Patient location"],
    outputs: ["Prices by pharmacy"],
    review: "Shared with the patient.",
  },

  // ---- Follow-up
  {
    // src/lib/photon.ts statusFromEvent, /api/photon/webhook, src/app/patient/[id]
    id: "patient_updates",
    name: "Patient messages & order tracking",
    vendor: "Photon Health",
    stage: "follow_up",
    kind: "Service",
    status: "integrated",
    summary: "The patient gets a text to choose a pharmacy, and the visit shows when the prescription is filled and picked up.",
    inputs: ["Sent order"],
    outputs: ["Patient texts", "Fill and pickup status"],
    review: "Visible to the doctor on the visit.",
  },
  {
    id: "remote_bp",
    name: "Remote BP monitoring",
    stage: "follow_up",
    kind: "Service",
    status: "planned",
    summary: "Collects home blood pressure readings so the doctor can see whether the new medication is working.",
    inputs: ["Home cuff readings"],
    outputs: ["BP trend", "Alerts when out of range"],
    review: "Doctor reviews the trend at the next visit.",
  },
  {
    id: "adherence",
    name: "Adherence nudges agent",
    stage: "follow_up",
    kind: "AI agent",
    status: "planned",
    summary: "Checks in with the patient by text about refills and side effects, and flags problems for the clinic.",
    inputs: ["Refill status", "Patient replies"],
    outputs: ["Reminders", "Flags for the care team"],
    review: "Flags go to the care team; no medical advice is sent automatically.",
  },
];
