-- Two-pill (dual therapy) plans, single-pill combinations, and drug prices.

-- TABLE 3: fixed-dose single-pill combinations (from RxNorm), e.g. losartan/hydrochlorothiazide
create table if not exists combination_products (
  id            text primary key,              -- RxNorm MIN rxcui
  name          text not null,
  medication_a  text not null references medications(id) on delete cascade,
  medication_b  text not null references medications(id) on delete cascade,
  brand_names   text[] not null default '{}',
  products      jsonb not null,                -- [{rxcui, name, dose_a, dose_b, extended}]
  source_url    text,
  created_at    timestamptz not null default now()
);
create index if not exists combination_products_pair_idx on combination_products (medication_a, medication_b);

-- NADAC (CMS) pharmacy acquisition price per tablet/capsule, for every strength we can prescribe
create table if not exists drug_prices (
  rxcui           text primary key,            -- RxNorm SCD
  name            text not null,
  medication_id   text references medications(id) on delete cascade,
  combination_id  text references combination_products(id) on delete cascade,
  dose_mg         numeric,
  nadac_per_unit  numeric,
  effective_date  text,
  ndc_count       int not null default 0
);
create index if not exists drug_prices_med_idx on drug_prices (medication_id);

-- Which pill a recommendation is for: 1 = first drug, 2 = the add-on drug
alter table recommendations add column if not exists slot int not null default 1;
alter table recommendations add column if not exists monthly_cost numeric;

-- The treatment plan for the visit: single / dual / add_on, and what the doctor picked
alter table encounters add column if not exists plan jsonb not null default '{}';

-- A prescription can be one pill of a two-pill order, or a single-pill combination
alter table prescriptions
  add column if not exists order_group uuid,
  add column if not exists combination_id text references combination_products(id),
  add column if not exists monthly_cost numeric;

alter table combination_products enable row level security;
alter table drug_prices          enable row level security;
