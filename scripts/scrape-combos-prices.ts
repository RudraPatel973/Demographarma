/* eslint-disable @typescript-eslint/no-explicit-any -- loosely-typed public API JSON */
/**
 * Scrapes:
 *  1. Two-drug single-pill combinations (fixed-dose combos) whose ingredients are both in our
 *     antihypertensive list — RxNorm (NLM RxNav): MIN concepts -> ingredients -> clinical drugs (SCD) + brands.
 *  2. Prices for every single-drug strength and every combo strength — CMS NADAC
 *     (National Average Drug Acquisition Cost, data.medicaid.gov) via RxNorm SCD -> NDC codes.
 *
 * Writes data/hypertension/combos_prices.json and supabase/seed_combos_prices.sql
 * Usage: npx tsx scripts/scrape-combos-prices.ts
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(__dirname, "..");
const RXNAV = "https://rxnav.nlm.nih.gov/REST";
const NADAC_DATASET = "fbb83258-11c7-47f5-8b18-5f8e79f7e704"; // "NADAC 2026" on data.medicaid.gov
const NADAC = `https://data.medicaid.gov/api/1/datastore/query/${NADAC_DATASET}/0`;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function getJson(url: string, tries = 4): Promise<any> {
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url, { headers: { "user-agent": "demographarma-scraper/1.0" }, signal: AbortSignal.timeout(20000) });
      if (res.ok) return res.json();
      if (res.status === 404) return null;
    } catch {
      /* retry */
    }
    await sleep(600 * (i + 1));
  }
  return null;
}
const related = async (rxcui: string, tty: string) =>
  ((await getJson(`${RXNAV}/rxcui/${rxcui}/related.json?tty=${tty}`))?.relatedGroup?.conceptGroup ?? []).flatMap(
    (g: any) => (g.conceptProperties ?? []).map((c: any) => ({ rxcui: c.rxcui as string, name: c.name as string, tty: c.tty as string })),
  );

type Med = { id: string; generic: string; rxcui: string | null; strengths: string[]; dosesPerDay: string };

/** "losartan potassium 50 MG / hydrochlorothiazide 12.5 MG Oral Tablet" -> [{name, mg}] */
function parseComponents(scd: string) {
  const body = scd.replace(/^\d+ HR /, "").replace(/ (Oral|Extended|Delayed).*$/i, "");
  return body.split(" / ").map((part) => {
    const m = /^(.*?)\s+([\d.]+)\s*MG$/i.exec(part.trim());
    return m ? { name: m[1].toLowerCase(), mg: Number(m[2]) } : { name: part.toLowerCase(), mg: NaN };
  });
}

async function nadacFor(rxcui: string): Promise<{ perUnit: number; date: string; ndcs: number } | null> {
  const ndcs: string[] = (await getJson(`${RXNAV}/rxcui/${rxcui}/ndcs.json`))?.ndcGroup?.ndcList?.ndc ?? [];
  if (!ndcs.length) return null;
  const prices: { p: number; d: string }[] = [];
  for (let i = 0; i < ndcs.length; i += 40) {
    const chunk = ndcs.slice(i, i + 40);
    const q = new URLSearchParams({ limit: "500" });
    q.append("conditions[0][property]", "ndc");
    q.append("conditions[0][operator]", "in");
    chunk.forEach((n, k) => q.append(`conditions[0][value][${k}]`, n));
    const j = await getJson(`${NADAC}?${q}`);
    // keep the most recent row per NDC
    const latest = new Map<string, any>();
    for (const r of j?.results ?? []) {
      const prev = latest.get(r.ndc);
      if (!prev || r.effective_date > prev.effective_date) latest.set(r.ndc, r);
    }
    for (const r of latest.values()) prices.push({ p: Number(r.nadac_per_unit), d: r.effective_date });
  }
  if (!prices.length) return null;
  prices.sort((a, b) => a.p - b.p);
  const median = prices[Math.floor(prices.length / 2)];
  return { perUnit: median.p, date: prices.map((x) => x.d).sort().at(-1)!, ndcs: prices.length };
}

async function main() {
  const scraped = JSON.parse(readFileSync(join(ROOT, "data/hypertension/scraped.json"), "utf8"));
  const meds: Med[] = scraped.drugs.map((d: any) => ({ id: d.id, generic: d.generic, rxcui: d.rxcui, strengths: d.strengths, dosesPerDay: d.dosesPerDay }));
  const byIngredient = new Map<string, Med>();
  for (const m of meds) if (m.rxcui && !byIngredient.has(m.rxcui)) byIngredient.set(m.rxcui, m);

  // ---- 1) combinations --------------------------------------------------
  const mins = new Map<string, string>(); // MIN rxcui -> name
  for (const m of meds) {
    if (!m.rxcui) continue;
    for (const c of await related(m.rxcui, "MIN")) mins.set(c.rxcui, c.name);
    await sleep(80);
  }
  console.log(`MIN concepts touching our drugs: ${mins.size}`);

  const combos: any[] = [];
  for (const [minId, minName] of mins) {
    const ins = await related(minId, "IN");
    if (ins.length !== 2) continue; // two-drug combos only
    const a = byIngredient.get(ins[0].rxcui);
    const b = byIngredient.get(ins[1].rxcui);
    if (!a || !b) continue;
    const products = (await related(minId, "SCD"))
      .filter((p: any) => /oral (tablet|capsule)/i.test(p.name))
      .map((p: any) => {
        const comps = parseComponents(p.name);
        const doseFor = (med: Med) => comps.find((c) => c.name.includes(med.generic.split(" ")[0].toLowerCase()))?.mg ?? null;
        return { rxcui: p.rxcui, name: p.name, dose_a: doseFor(a), dose_b: doseFor(b), extended: /extended|24 hr/i.test(p.name) };
      })
      .filter((p: any) => p.dose_a && p.dose_b);
    if (!products.length) continue;
    const brands = Array.from(new Set((await related(minId, "BN")).map((x: any) => x.name)));
    combos.push({ id: minId, name: minName, med_a: a.id, med_b: b.id, brands, products });
    console.log(`  combo ${minName.padEnd(40)} ${products.length} strengths  ${brands.join(", ")}`);
    await sleep(80);
  }

  // ---- 2) prices --------------------------------------------------------
  const prices: any[] = [];
  const priceSeen = new Set<string>();
  const addPrice = async (rxcui: string, name: string, extra: Record<string, unknown>) => {
    if (priceSeen.has(rxcui)) return;
    priceSeen.add(rxcui);
    const p = await nadacFor(rxcui);
    prices.push({ rxcui, name, ...extra, nadac_per_unit: p?.perUnit ?? null, effective_date: p?.date ?? null, ndc_count: p?.ndcs ?? 0 });
  };
  // run lookups 6 at a time
  const pool = async <T,>(items: T[], fn: (x: T) => Promise<void>, n = 6) => {
    let i = 0;
    await Promise.all(Array.from({ length: n }, async () => {
      while (i < items.length) await fn(items[i++]);
    }));
  };
  const singles = meds.flatMap((m) => m.strengths.map((s) => ({ m, s })));
  let done = 0;
  await pool(singles, async ({ m, s }) => {
    const id = (await getJson(`${RXNAV}/rxcui.json?name=${encodeURIComponent(s)}&search=2`))?.idGroup?.rxnormId?.[0];
    const mg = /([\d.]+) MG/i.exec(s)?.[1];
    if (id) await addPrice(id, s, { medication_id: m.id, combination_id: null, dose_mg: mg ? Number(mg) : null });
    if (++done % 25 === 0) console.log(`  single-drug prices ${done}/${singles.length}`);
  });
  const comboItems = combos.flatMap((c) => c.products.map((p: any) => ({ c, p })));
  done = 0;
  await pool(comboItems, async ({ c, p }) => {
    await addPrice(p.rxcui, p.name, { medication_id: null, combination_id: c.id, dose_mg: null });
    if (++done % 25 === 0) console.log(`  combo prices ${done}/${comboItems.length}`);
  });
  console.log(`\nprices: ${prices.filter((p) => p.nadac_per_unit != null).length}/${prices.length} found in NADAC`);

  writeFileSync(join(ROOT, "data/hypertension/combos_prices.json"), JSON.stringify({ scraped_at: new Date().toISOString(), combos, prices }, null, 2));

  // ---- SQL --------------------------------------------------------------
  const lit = (v: unknown) => (v === null || v === undefined ? "null" : typeof v === "number" ? String(v) : typeof v === "boolean" ? String(v) : `'${String(v).replace(/'/g, "''")}'`);
  const L = ["-- Generated by scripts/scrape-combos-prices.ts on " + new Date().toISOString(), "begin;", "truncate combination_products, drug_prices;"];
  for (const c of combos) {
    L.push(
      `insert into combination_products (id,name,medication_a,medication_b,brand_names,products,source_url) values (${lit(c.id)},${lit(c.name)},${lit(c.med_a)},${lit(c.med_b)},${c.brands.length ? `array[${c.brands.map(lit).join(",")}]` : "'{}'"}::text[],${lit(JSON.stringify(c.products))}::jsonb,${lit(`https://mor.nlm.nih.gov/RxNav/search?searchBy=RXCUI&searchTerm=${c.id}`)});`,
    );
  }
  for (const p of prices) {
    L.push(
      `insert into drug_prices (rxcui,name,medication_id,combination_id,dose_mg,nadac_per_unit,effective_date,ndc_count) values (${lit(p.rxcui)},${lit(p.name)},${lit(p.medication_id)},${lit(p.combination_id)},${lit(p.dose_mg)},${lit(p.nadac_per_unit)},${lit(p.effective_date)},${p.ndc_count});`,
    );
  }
  L.push("commit;");
  writeFileSync(join(ROOT, "supabase/seed_combos_prices.sql"), L.join("\n") + "\n");
  console.log(`combos: ${combos.length} -> supabase/seed_combos_prices.sql`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
