-- Insurance coverage, step therapy and prior authorization.

-- Insurance plans (Medicare Part D from CMS public files; plus generic commercial / cash entries)
create table if not exists insurance_plans (
  id            text primary key,          -- CMS contract-plan-segment, e.g. "S5601-012-000", or "COMMERCIAL"
  name          text not null,
  payer         text,                      -- organization, e.g. "Humana"
  plan_type     text not null,             -- PDP | MA-PD | Commercial | Medicaid | Cash
  formulary_id  text,                      -- CMS formulary id (null = formulary unknown)
  states        text[] not null default '{}',
  source        text,
  created_at    timestamptz not null default now()
);
create index if not exists insurance_plans_name_idx on insurance_plans using gin (to_tsvector('simple', name || ' ' || coalesce(payer, '')));

-- TABLE 4: what each formulary says about each drug strength (only our antihypertensives)
create table if not exists formulary_entries (
  formulary_id    text not null,
  rxcui           text not null,           -- RxNorm clinical/branded drug
  medication_id   text references medications(id) on delete cascade,
  combination_id  text references combination_products(id) on delete cascade,
  tier            int,
  prior_auth      boolean not null default false,
  step_therapy    boolean not null default false,
  quantity_limit  text,
  primary key (formulary_id, rxcui)
);
create index if not exists formulary_entries_med_idx on formulary_entries (formulary_id, medication_id);

-- Patient's insurance: {plan_id, plan_name, payer, member_id, group_number, bin, pcn}
alter table patients add column if not exists insurance jsonb;

-- What the patient has tried before and how it went (feeds step therapy and prior auth)
create table if not exists medication_trials (
  id             uuid primary key default gen_random_uuid(),
  patient_id     uuid not null references patients(id) on delete cascade,
  encounter_id   uuid references encounters(id) on delete set null,
  medication_id  text references medications(id),
  drug_name      text not null,
  dose_mg        numeric,
  started_on     date,
  ended_on       date,
  outcome        text not null check (outcome in ('ongoing','not_at_goal','side_effect','allergy','contraindicated','stopped_other')),
  detail         text,
  source         text not null default 'transcript',   -- transcript | prescription | manual
  created_at     timestamptz not null default now()
);
create index if not exists medication_trials_patient_idx on medication_trials (patient_id);

-- Prior authorization / step-therapy exception packets
create table if not exists prior_auths (
  id              uuid primary key default gen_random_uuid(),
  encounter_id    uuid not null references encounters(id) on delete cascade,
  patient_id      uuid not null references patients(id) on delete cascade,
  prescription_id uuid references prescriptions(id) on delete set null,
  medication_id   text references medications(id),
  combination_id  text references combination_products(id),
  drug_label      text not null,
  plan_id         text,
  plan_name       text,
  request_type    text not null check (request_type in ('prior_authorization','step_therapy_exception','formulary_exception')),
  status          text not null default 'draft' check (status in ('draft','submitted','approved','denied','appealed')),
  form            jsonb not null default '{}',
  letter          text,
  model           text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- Recommendation = clinical fit + coverage adjustment
alter table recommendations add column if not exists clinical_percent int;
alter table recommendations add column if not exists coverage jsonb;

alter table insurance_plans   enable row level security;
alter table formulary_entries enable row level security;
alter table medication_trials enable row level security;
alter table prior_auths       enable row level security;
