-- Inference layer: what external medical AI models inferred during a visit.
-- One row per metric per run, kept for audit even when the clinician rejects it.
-- A value only reaches the chart (encounters.vitals) after the clinician accepts it.
create table if not exists model_observations (
  id             uuid primary key default gen_random_uuid(),
  encounter_id   uuid not null references encounters(id) on delete cascade,
  model          text not null,                 -- e.g. 'smartspectra'
  model_version  text,                          -- SDK / model version that produced it
  metric         text not null,                 -- 'heart_rate' | 'respiratory_rate' | 'hrv_sdnn' | 'hrv_rmssd'
  value          numeric,
  unit           text,
  confidence     numeric,                       -- vendor score, 0-100
  stable         boolean not null default false,-- met the vendor's accuracy threshold
  detail         jsonb not null default '{}',   -- samples, range, quality hints, accuracy claim, model card
  status         text not null default 'pending'
                 check (status in ('pending','accepted','rejected','info','superseded')),
  media_path     text,                          -- storage path of the input (check-in clip)
  reviewed_at    timestamptz,
  created_at     timestamptz not null default now()
);
create index if not exists model_observations_encounter_idx on model_observations (encounter_id, created_at desc);

alter table model_observations enable row level security;
