/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Loads Medicare Part D plans and their drug lists (formularies) for our antihypertensives.
 * Source: CMS "Monthly Prescription Drug Plan Formulary and Pharmacy Network Information" (public).
 * Only the small files are needed (plan information + basic drugs formulary + beneficiary cost), not the 2 GB pharmacy lists.
 *
 * Usage: npx tsx scripts/load-partd.ts <folder with the unzipped .txt files> [states=NY,NJ,CT]
 * Keeps: every stand-alone drug plan (PDP) + Medicare Advantage drug plans in the given states.
 */
import { createReadStream, readdirSync } from "node:fs";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";

config({ path: join(__dirname, "../.env.local"), quiet: true });
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

async function* rows(file: string) {
  const rl = createInterface({ input: createReadStream(file), crlfDelay: Infinity });
  let header: string[] | null = null;
  for await (const line of rl) {
    const cols = line.split("|");
    if (!header) header = cols;
    else yield Object.fromEntries(header.map((h, i) => [h, cols[i]?.trim() ?? ""]));
  }
}

const titleCase = (s: string) => s.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase()).replace(/\bInc\b\.?/, "Inc.");

async function main() {
  const dir = process.argv[2];
  const states = new Set((process.argv[3] ?? "NY,NJ,CT").split(","));
  const file = (prefix: string) => join(dir, readdirSync(dir).find((f) => f.startsWith(prefix) && f.endsWith(".txt"))!);

  // our drug strengths (RxNorm SCD codes) from drug_prices
  const ours = new Map<string, { medication_id: string | null; combination_id: string | null }>();
  for (let from = 0; ; from += 1000) {
    const { data } = await db.from("drug_prices").select("rxcui,medication_id,combination_id").range(from, from + 999);
    if (!data?.length) break;
    for (const r of data) ours.set(r.rxcui, { medication_id: r.medication_id, combination_id: r.combination_id });
  }
  console.log(`our drug strengths: ${ours.size}`);

  // ---- plans --------------------------------------------------------------
  const plans = new Map<string, any>();
  for await (const r of rows(file("plan information"))) {
    if (r.PLAN_SUPPRESSED_YN === "Y") continue;
    const isPDP = r.CONTRACT_ID.startsWith("S");
    if (!isPDP && !states.has(r.STATE)) continue;
    const id = `${r.CONTRACT_ID}-${r.PLAN_ID}-${r.SEGMENT_ID}`;
    const p = plans.get(id) ?? {
      id,
      name: r.PLAN_NAME,
      payer: titleCase(r.CONTRACT_NAME),
      plan_type: isPDP ? "PDP" : "MA-PD",
      formulary_id: r.FORMULARY_ID,
      states: new Set<string>(),
      source: "CMS Part D plan information 2026-09",
    };
    if (r.STATE) p.states.add(r.STATE);
    plans.set(id, p);
  }
  const formularyIds = new Set([...plans.values()].map((p) => p.formulary_id));
  console.log(`plans kept: ${plans.size} (${[...plans.values()].filter((p) => p.plan_type === "PDP").length} PDP), formularies: ${formularyIds.size}`);

  // ---- copay per tier (initial coverage, 30-day, preferred retail) --------
  const tierCosts = new Map<string, Record<string, { type: string; amount: number }>>();
  for await (const r of rows(file("beneficiary cost file"))) {
    const id = `${r.CONTRACT_ID}-${r.PLAN_ID}-${r.SEGMENT_ID}`;
    if (!plans.has(id) || r.COVERAGE_LEVEL !== "1" || r.DAYS_SUPPLY !== "1") continue;
    const t = tierCosts.get(id) ?? {};
    // cost type: 0 = not offered at this pharmacy type, 1 = copay ($), 2 = coinsurance (fraction, 0.25 = 25%)
    const usePref = r.COST_TYPE_PREF !== "0";
    const type = usePref ? r.COST_TYPE_PREF : r.COST_TYPE_NONPREF;
    const amount = Number(usePref ? r.COST_AMT_PREF : r.COST_AMT_NONPREF);
    if (type === "0") continue;
    t[r.TIER] = { type: type === "2" ? "coinsurance" : "copay", amount };
    tierCosts.set(id, t);
  }

  // ---- formulary entries for our drugs only --------------------------------
  const entries = new Map<string, any>();
  for await (const r of rows(file("basic drugs formulary"))) {
    if (!formularyIds.has(r.FORMULARY_ID)) continue;
    const ourRow = ours.get(r.RXCUI);
    if (!ourRow) continue;
    const key = `${r.FORMULARY_ID}|${r.RXCUI}`;
    const prev = entries.get(key);
    const tier = Number(r.TIER_LEVEL_VALUE) || null;
    // several NDCs per RXCUI: keep the least restrictive / lowest tier listing
    if (prev && (prev.tier ?? 9) <= (tier ?? 9) && !(prev.prior_auth && r.PRIOR_AUTHORIZATION_YN === "N")) continue;
    entries.set(key, {
      formulary_id: r.FORMULARY_ID,
      rxcui: r.RXCUI,
      medication_id: ourRow.medication_id,
      combination_id: ourRow.combination_id,
      tier,
      prior_auth: r.PRIOR_AUTHORIZATION_YN === "Y",
      step_therapy: r.STEP_THERAPY_YN === "Y",
      quantity_limit: r.QUANTITY_LIMIT_YN === "Y" ? `${r.QUANTITY_LIMIT_AMOUNT} per ${r.QUANTITY_LIMIT_DAYS} days` : null,
    });
  }
  console.log(`formulary entries for our drugs: ${entries.size}`);

  // ---- write ----------------------------------------------------------------
  await db.from("formulary_entries").delete().neq("rxcui", "");
  await db.from("insurance_plans").delete().neq("id", "");
  const planRows = [
    ...[...plans.values()].map((p) => ({ ...p, states: [...p.states], tier_costs: tierCosts.get(p.id) ?? null })),
    { id: "COMMERCIAL", name: "Commercial / employer plan (drug list checked in Photon)", payer: null, plan_type: "Commercial", formulary_id: null, states: [], source: "manual", tier_costs: null },
    { id: "MEDICAID", name: "Medicaid (drug list checked in Photon)", payer: null, plan_type: "Medicaid", formulary_id: null, states: [], source: "manual", tier_costs: null },
    { id: "CASH", name: "Self-pay / cash (NADAC price estimate)", payer: null, plan_type: "Cash", formulary_id: null, states: [], source: "manual", tier_costs: null },
  ];
  const insert = async (table: string, all: any[], strip?: string) => {
    for (let i = 0; i < all.length; i += 500) {
      let chunk = all.slice(i, i + 500);
      let res = await db.from(table).insert(chunk);
      if (res.error && strip && res.error.message.includes(strip)) {
        // column not added yet (migration 0006): load without it
        chunk = chunk.map(({ [strip]: _drop, ...rest }) => rest); // eslint-disable-line @typescript-eslint/no-unused-vars
        res = await db.from(table).insert(chunk);
      }
      if (res.error) throw new Error(`${table}: ${res.error.message}`);
    }
  };
  await insert("insurance_plans", planRows, "tier_costs");
  await insert("formulary_entries", [...entries.values()]);
  console.log(`loaded ${planRows.length} plans, ${entries.size} formulary entries`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
