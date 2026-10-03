# Volution

Clinician decision support for **hypertension** prescribing. The doctor records the visit, enters a diagnosis and clicks **Generate**. The app returns the 3 medications that best match the patient's profile, each with a match %. The doctor approves one and it's e-prescribed through **Photon Health**, which texts the patient.

> Demo software. It does not replace clinical judgement. Every prescription is reviewed and sent by a licensed prescriber.

## Live demo
**https://demographarma.vercel.app**

| | |
|---|---|
| Username | `doctor` |
| Password | `dexter` |

The patient's phone page (`/patient/...`, linked from the SMS) and Photon's webhook are not password-protected.
Change the login with `DEMO_USER` / `DEMO_PASSWORD` in Vercel → Settings → Environment Variables, then redeploy.

## Flow (from the whiteboard)

| Diagram | Where it lives |
|---|---|
| 🔴 Doctor enters inputs: medical docs, video, text from patient, diagnosis | `/visits/[id]` steps 1–3 (`Recorder`, documents upload, patient text, diagnosis) |
| 🔴 Doctor clicks Generate | `POST /api/encounters/[id]/generate` |
| 🟢 Look up meds from diagnosis in **Table 1** | `diagnosis_medications` (line of therapy + base score per diagnosis) |
| 🟢 Take meds + demographics from **Table 2**, send to Claude with all other inputs | `demographic_modifiers` → `src/lib/scoring.ts` → `src/lib/claude.ts` (transcript, PDFs/images, profile, candidates) |
| 🔴 Doctor chooses med | Recommendation cards with match meter → editable prescription |
| 🔴 Finish prescription process | `POST /api/encounters/[id]/prescribe` |
| 🟢 Photon API does its work / notifies patient | `src/lib/photon.ts`, `<photon-prescribe-workflow>`, `POST /api/photon/webhook` |
| 🟠 Patient records video / gets message | Visit recording, plus the patient's phone view at `/patient/[id]` |

### How a recommendation is computed
1. **Table 1:** every drug mapped to the diagnosis, with a guideline prior (first-line 70, second-line 45–50, add-on 30…).
2. **Table 2:** 147 cited modifiers check the patient's age, sex, ethnicity, BMI, pregnancy, 29 comorbidities, current meds (interactions), allergies, eGFR/K⁺/Na⁺/UACR and heart rate. A `contraindicated` match excludes the drug.
3. The shortlist keeps the best drug from each class first, so the options are real alternatives.
4. **Claude (`claude-opus-5-5`)** reads the transcript, uploaded documents and patient text, then picks the top 3 with a match %, rationale, factors for/against, dose and sig. The output is schema-constrained to the shortlist, and doses are checked against the label range server-side.
5. If Claude is unavailable, the rule engine's top 3 are shown instead.

## Data (Table 1 & 2)
`npm run scrape` rebuilds `supabase/seed.sql` from:
- **RxNorm (NLM RxNav):** ingredient RXCUI and available oral strengths for 36 antihypertensives
- **openFDA drug labels:** boxed warning, contraindications, warnings, adverse reactions, interactions and dosing, linked to DailyMed
- **Curated guideline rules** in `data/hypertension/knowledge.ts`, each citing its source: 2025 AHA/ACC BP guideline, 2017 ACC/AHA (dose table), 2022 HF guideline, KDIGO 2021, ADA 2025, ACOG, Beers 2023, ALLHAT, PATHWAY-2, CLICK, A-HeFT, ONTARGET, Law 2009 meta-analysis

**Ethnicity:** the 2025 AHA/ACC guideline made first-line drug choice race-neutral. Table 2 keeps only ethnicity effects that are still evidence-backed (ACE-inhibitor angioedema in Black patients, ACE-inhibitor cough in East Asian patients, hydralazine/ISDN in Black patients with HFrEF). The 2017 "thiazide/CCB first in Black patients" rule is stored with `active = false` for transparency.

## Setup
1. Create a Supabase project. In the SQL editor run `supabase/migrations/0001_schema.sql`, then `supabase/seed.sql`.
2. `cp .env.example .env.local` and fill in the keys (Supabase required; Anthropic recommended; Photon optional).
3. `npm install && npm run dev`, then open http://localhost:3000 in Chrome (needed for live transcription).

### Photon
- Sandbox (Neutron) credentials come from https://app.neutron.health/settings: a machine-to-machine client (server), the Elements client ID + org ID (browser), and a webhook to `/api/photon/webhook` with a shared secret.
- Add your app URL (e.g. `http://localhost:3000`) to the allowed callback URLs.
- Photon only lets authorized prescribers write prescriptions. Our backend syncs the patient and finds the treatment; the embedded Photon widget opens pre-filled, and the doctor signs in and clicks **Send Order**. Photon then texts the patient to choose a pharmacy, and webhooks update the status.
- Without Photon keys the app runs **mock mode**: same lifecycle, simulated texts, and buttons to step through pharmacy/fill/pickup.

### Check-in vitals (inference layer)
A new visit starts with a 30-second camera check before the voice recording. The clip is analysed by **Presage SmartSpectra** (camera-based pulse, breathing, HRV). A reliable pulse goes straight into the chart and the recording starts; an unreliable one shows the problem (e.g. someone else in frame) with **Retake** or **Start visit without it**.
- Choose the reader with `VITALS_MODEL` (unset = no check-in step), then restart:
  - `demo`: placeholder for presentations. Records a 10-second clip, but the pulse is generated (the average of 10 readings around a resting rate), not measured. Its observations are stored as model `demo_pulse`.
  - `smartspectra`: real camera readings from a 30-second clip. Needs `SMARTSPECTRA_API_KEY` (from physiology.presagetech.com).
- Run `supabase/migrations/0007_model_observations.sql` first.
- `src/lib/inference/` is model-agnostic: a model implements `ClinicalModel` and only returns observations. Every reading is stored in `model_observations` (value, vendor confidence, model version, model card, quality hints). Only a pulse where at least 3 readings met the vendor's accuracy standard (±3 bpm) is written to `encounters.vitals`, tagged with its source in `vitals.sources` (the observation records `accepted_via: auto`). A heart rate the doctor types or says later replaces it and drops the tag.
- The SDK is a native Node module (macOS arm64, Linux x64/arm64 with glibc ≥ 2.35, Windows x64), so run it locally or on a Node server. It hasn't been tested in Vercel functions. The browser records H.264 because the SDK's bundled decoder doesn't read VP8/VP9.
- The clip is played back to the SDK at camera speed (~30 fps); decoding it as fast as possible gives almost no readings.
- `/tools` shows every AI model, agent, data source and service by visit step (integrated, available, planned). The catalogue is `src/lib/integrations.ts`.
- `scripts/smartspectra-test.mjs` measures from the webcam in a terminal, which is handy for comparing against a wearable.
- Camera vitals are an investigational estimate, not a calibrated measurement. The SDK's arterial pressure trace is unitless and is never used as blood pressure.

## Security notes
- All tables have RLS on with no policies. The browser never talks to Supabase directly; route handlers use the service-role key on the server.
- Media (visit video, documents) sits in a private bucket. Uploads use one-time signed URLs and playback uses 10-minute signed URLs.
- There is **no user authentication** yet. Add Supabase Auth (or similar) before any real patient data goes in.
