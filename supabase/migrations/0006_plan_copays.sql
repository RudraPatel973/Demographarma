-- Copay / coinsurance per drug tier for each plan (initial coverage, 30-day supply, preferred retail pharmacy).
-- Shape: {"1": {"type": "copay", "amount": 0}, "2": {"type": "copay", "amount": 5}, ...}
alter table insurance_plans add column if not exists tier_costs jsonb;
