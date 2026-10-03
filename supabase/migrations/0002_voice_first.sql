-- Voice-first visits: a new patient starts blank and is filled in from the audio.
alter table patients
  alter column first_name    drop not null,
  alter column last_name     drop not null,
  alter column date_of_birth drop not null,
  alter column sex           drop not null,
  alter column phone         drop not null;

alter table patients add column if not exists dob_is_estimate boolean not null default false;

-- What the live extractor has picked up so far (notes, diagnosis quote, timestamps)
alter table encounters add column if not exists live_state jsonb not null default '{}';

-- Doctor's choice: one of the 3 recommendations, or an override with their own drug
alter table prescriptions alter column medication_id drop not null;
alter table prescriptions
  add column if not exists recommendation_id uuid references recommendations(id) on delete set null,
  add column if not exists custom_medication text,
  add column if not exists is_override boolean not null default false,
  add column if not exists selection_reason text;

alter table prescriptions drop constraint if exists prescriptions_drug_present;
alter table prescriptions add constraint prescriptions_drug_present
  check (medication_id is not null or custom_medication is not null);
