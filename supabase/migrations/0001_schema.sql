-- Volution schema
-- All tables have RLS enabled with no policies: the browser never talks to
-- Supabase directly. Every read/write goes through Next.js route handlers
-- using the service-role key (server only).


-- ---------------------------------------------------------------------------
-- Reference data
-- ---------------------------------------------------------------------------

create table if not exists diagnoses (
  id          text primary key,              -- e.g. 'essential_hypertension'
  name        text not null,
  icd10       text not null,
  description text,
  created_at  timestamptz not null default now()
);

create table if not exists medications (
  id                   text primary key,     -- e.g. 'lisinopril'
  generic_name         text not null,
  brand_names          text[] not null default '{}',
  drug_class           text not null,        -- e.g. 'ACE inhibitor'
  class_key            text not null,        -- e.g. 'acei'
  rxcui                text,                 -- RxNorm ingredient RXCUI
  mechanism            text,
  usual_dose_min_mg    numeric,
  usual_dose_max_mg    numeric,
  start_dose_mg        numeric,
  start_dose_elderly_mg numeric,
  doses_per_day        text,                 -- '1', '1-2', '2-3'
  available_strengths  text[] not null default '{}',  -- from RxNorm SCDs
  avg_sbp_reduction    numeric,              -- mmHg at standard dose (class level)
  monitoring           text,
  pregnancy_safety     text,                 -- 'contraindicated' | 'avoid' | 'preferred' | 'caution'
  cost_tier            int,                  -- 1 generic/cheap .. 3 expensive
  -- scraped FDA label excerpts
  label_boxed_warning     text,
  label_indications       text,
  label_contraindications text,
  label_warnings          text,
  label_adverse_reactions text,
  label_drug_interactions text,
  label_dosage            text,
  label_set_id            text,
  label_effective_date    text,
  dailymed_url            text,
  sources              jsonb not null default '[]',
  scraped_at           timestamptz,
  created_at           timestamptz not null default now()
);

-- TABLE 1: which meds are used for which diagnosis, and at which line of therapy
create table if not exists diagnosis_medications (
  id              uuid primary key default gen_random_uuid(),
  diagnosis_id    text not null references diagnoses(id) on delete cascade,
  medication_id   text not null references medications(id) on delete cascade,
  line_of_therapy text not null check (line_of_therapy in ('first_line','second_line','add_on','special_population')),
  base_score      int  not null,             -- prior before patient modifiers
  guideline       text not null,
  notes           text,
  unique (diagnosis_id, medication_id)
);

-- TABLE 2: demographic / comorbidity / lab modifiers
-- `conditions` is an array of predicates that must ALL match the patient, e.g.
-- [{"factor":"condition","op":"has","value":"diabetes"}]
-- [{"factor":"age","op":">=","value":65}]
-- target_type = 'class' (matches medications.class_key) or 'drug' (medications.id)
create table if not exists demographic_modifiers (
  id           uuid primary key default gen_random_uuid(),
  target_type  text not null check (target_type in ('class','drug')),
  target       text not null,
  conditions   jsonb not null,
  effect       text not null check (effect in ('contraindicated','avoid','caution','neutral','prefer','strongly_prefer')),
  score_delta  int  not null,
  rationale    text not null,
  source       text not null,
  source_url   text,
  active       boolean not null default true,
  created_at   timestamptz not null default now()
);
create index if not exists demographic_modifiers_target_idx on demographic_modifiers (target_type, target);

-- Log of every scrape pass (for provenance)
create table if not exists scrape_runs (
  id          uuid primary key default gen_random_uuid(),
  source      text not null,
  url         text,
  status      text not null,
  detail      jsonb,
  created_at  timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Clinical workflow
-- ---------------------------------------------------------------------------

create table if not exists patients (
  id                 uuid primary key default gen_random_uuid(),
  first_name         text not null,
  last_name          text not null,
  date_of_birth      date not null,
  sex                text not null check (sex in ('MALE','FEMALE','UNKNOWN')),
  ethnicity          text,
  phone              text not null,
  email              text,
  height_cm          numeric,
  weight_kg          numeric,
  conditions         text[] not null default '{}',
  current_medications text[] not null default '{}',
  allergies          text[] not null default '{}',
  pregnancy_status   text not null default 'not_applicable'
                     check (pregnancy_status in ('not_applicable','not_pregnant','childbearing_potential','pregnant','breastfeeding')),
  photon_patient_id  text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create table if not exists encounters (
  id               uuid primary key default gen_random_uuid(),
  patient_id       uuid not null references patients(id) on delete cascade,
  status           text not null default 'in_progress'
                   check (status in ('in_progress','recommended','med_chosen','prescribed','completed')),
  transcript       jsonb not null default '[]',   -- [{speaker, text, t}]
  patient_text     text,                          -- free text from patient
  video_path       text,                          -- storage path
  documents        jsonb not null default '[]',   -- [{name, path, mime, size}]
  vitals           jsonb not null default '{}',   -- {bp_systolic, bp_diastolic, heart_rate}
  labs             jsonb not null default '{}',   -- {egfr, potassium, sodium, uacr}
  diagnosis_id     text references diagnoses(id),
  diagnosis_notes  text,
  chosen_recommendation_id uuid,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create table if not exists recommendations (
  id              uuid primary key default gen_random_uuid(),
  encounter_id    uuid not null references encounters(id) on delete cascade,
  rank            int not null,
  medication_id   text not null references medications(id),
  match_percent   int not null check (match_percent between 0 and 100),
  rule_score      int,
  summary         text not null,
  rationale       text not null,
  factors_for     jsonb not null default '[]',
  factors_against jsonb not null default '[]',
  dose_mg         numeric,
  sig             text,
  dispense_quantity int,
  days_supply     int,
  fills_allowed   int,
  monitoring      text,
  engine          text not null,           -- 'claude' | 'rules'
  model           text,
  created_at      timestamptz not null default now()
);

create table if not exists generation_runs (
  id            uuid primary key default gen_random_uuid(),
  encounter_id  uuid not null references encounters(id) on delete cascade,
  engine        text not null,
  model         text,
  candidates    jsonb not null,      -- rule-scored candidate list sent to Claude
  excluded      jsonb not null,      -- contraindicated meds + reasons
  clinical_note text,                -- Claude's overall note
  stop_reason   text,
  usage         jsonb,
  created_at    timestamptz not null default now()
);

create table if not exists prescriptions (
  id                    uuid primary key default gen_random_uuid(),
  encounter_id          uuid not null references encounters(id) on delete cascade,
  patient_id            uuid not null references patients(id) on delete cascade,
  medication_id         text not null references medications(id),
  dose_mg               numeric,
  sig                   text not null,
  dispense_quantity     int not null,
  dispense_unit         text not null default 'Tablet',
  days_supply           int not null,
  fills_allowed         int not null default 1,
  notes                 text,
  status                text not null default 'draft'
                        check (status in ('draft','sent_to_photon','order_created','patient_notified','pharmacy_selected','filled','picked_up','canceled','error')),
  photon_mode           text not null default 'mock' check (photon_mode in ('live','mock')),
  photon_treatment_id   text,
  photon_prescription_id text,
  photon_order_id       text,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

create table if not exists photon_events (
  id              text primary key,        -- Photon webhook event id (idempotency)
  prescription_id uuid references prescriptions(id) on delete set null,
  type            text not null,
  subject         text,
  payload         jsonb not null,
  received_at     timestamptz not null default now()
);

create table if not exists patient_messages (
  id              uuid primary key default gen_random_uuid(),
  patient_id      uuid not null references patients(id) on delete cascade,
  prescription_id uuid references prescriptions(id) on delete cascade,
  channel         text not null default 'sms',
  body            text not null,
  source          text not null,           -- 'photon' | 'photon_mock'
  created_at      timestamptz not null default now()
);

-- RLS on, no policies => only the service role can access.
alter table diagnoses             enable row level security;
alter table medications           enable row level security;
alter table diagnosis_medications enable row level security;
alter table demographic_modifiers enable row level security;
alter table scrape_runs           enable row level security;
alter table patients              enable row level security;
alter table encounters            enable row level security;
alter table recommendations       enable row level security;
alter table generation_runs       enable row level security;
alter table prescriptions         enable row level security;
alter table photon_events         enable row level security;
alter table patient_messages      enable row level security;

-- Private storage bucket for visit recordings and uploaded medical documents
insert into storage.buckets (id, name, public)
values ('encounter-media', 'encounter-media', false)
on conflict (id) do nothing;
