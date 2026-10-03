/* eslint-disable @typescript-eslint/no-explicit-any -- loosely-typed public API JSON */
/**
 * Scrapes public drug data for every antihypertensive in data/hypertension/knowledge.ts
 *
 *  - RxNorm (NLM RxNav REST)   -> ingredient RXCUI + available oral strengths (SCD)
 *  - openFDA drug label API    -> boxed warning, indications, contraindications,
 *                                 warnings, adverse reactions, interactions, dosing
 *
 * Writes:
 *  - data/hypertension/scraped.json   (raw-ish scrape output, for review)
 *  - supabase/seed.sql                (Table 1, Table 2, medications, diagnoses)
 *
 * Usage:  npx tsx scripts/scrape-hypertension.ts
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import {
  DRUGS,
  DIAGNOSES,
  MODIFIERS,
  SOURCES,
  CLASS_EFFICACY,
  buildDiagnosisMedications,
  type DrugSeed,
} from "../data/hypertension/knowledge";

const ROOT = join(__dirname, "..");
const RXNAV = "https://rxnav.nlm.nih.gov/REST";
const OPENFDA = "https://api.fda.gov/drug/label.json";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function getJson(url: string, tries = 3): Promise<any> {
  for (let i = 0; i < tries; i++) {
    const res = await fetch(url, { headers: { "user-agent": "demographarma-scraper/1.0" } });
    if (res.ok) return res.json();
    if (res.status === 404) return null;
    await sleep(800 * (i + 1));
  }
  throw new Error(`GET ${url} failed`);
}

function clip(s: string | undefined, n = 1800): string | null {
  if (!s) return null;
  const t = s.replace(/\s+/g, " ").trim();
  return t.length > n ? t.slice(0, n).trimEnd() + " …" : t;
}

async function rxnorm(d: DrugSeed) {
  const name = d.rxnormName ?? d.generic;
  const idj = await getJson(`${RXNAV}/rxcui.json?name=${encodeURIComponent(name)}&search=2`);
  const rxcui: string | undefined = idj?.idGroup?.rxnormId?.[0];
  if (!rxcui) return { rxcui: null, strengths: [] as string[] };
  const rel = await getJson(`${RXNAV}/rxcui/${rxcui}/related.json?tty=SCD`);
  const concepts: { name: string }[] =
    rel?.relatedGroup?.conceptGroup?.flatMap((g: any) => g.conceptProperties ?? []) ?? [];
  // Keep single-ingredient oral tablets/capsules only
  const ext = /extended|24 hr|12 hr/i;
  const wantsER = /extended-release/.test(d.generic);
  const strengths = concepts
    .map((c) => c.name)
    .filter((n) => !n.includes(" / "))
    .filter((n) => /oral (tablet|capsule)/i.test(n))
    .filter((n) => !/disintegrating|chewable/i.test(n))
    .filter((n) => (wantsER ? ext.test(n) : true))
    .filter((n) => (wantsER && d.dosesPerDay === "1" ? /24 HR/.test(n) : true))
    .sort();
  return { rxcui, strengths: Array.from(new Set(strengths)) };
}

async function fdaLabel(d: DrugSeed) {
  const name = (d.fdaName ?? d.generic.replace(/ extended-release/, "")).toUpperCase();
  const q = `openfda.generic_name.exact:"${name}"`;
  const j = await getJson(`${OPENFDA}?search=${encodeURIComponent(q)}&limit=25`);
  const results: any[] = j?.results ?? [];
  // Prefer single-ingredient Rx labels with the richest content, newest first
  const scored = results
    .filter((r) => (r.openfda?.product_type ?? []).includes("HUMAN PRESCRIPTION DRUG"))
    .map((r) => ({
      r,
      score:
        (r.contraindications ? 2 : 0) +
        (r.boxed_warning ? 1 : 0) +
        (r.warnings_and_cautions || r.warnings ? 1 : 0) +
        (r.dosage_and_administration ? 1 : 0) +
        Number(r.effective_time ?? 0) / 1e9,
    }))
    .sort((a, b) => b.score - a.score);
  const r = scored[0]?.r;
  if (!r) return null;
  return {
    set_id: r.set_id as string,
    effective_time: r.effective_time as string,
    pharm_class: r.openfda?.pharm_class_epc ?? [],
    boxed_warning: clip(r.boxed_warning?.[0], 1200),
    indications: clip(r.indications_and_usage?.[0], 900),
    contraindications: clip(r.contraindications?.[0], 1200),
    warnings: clip((r.warnings_and_cautions ?? r.warnings)?.[0], 2000),
    adverse_reactions: clip(r.adverse_reactions?.[0], 1500),
    drug_interactions: clip(r.drug_interactions?.[0], 1500),
    dosage: clip(r.dosage_and_administration?.[0], 1500),
  };
}

// --- SQL helpers -----------------------------------------------------------
const lit = (v: unknown): string => {
  if (v === null || v === undefined) return "null";
  if (typeof v === "number") return Number.isFinite(v) ? String(v) : "null";
  if (typeof v === "boolean") return v ? "true" : "false";
  return "'" + String(v).replace(/'/g, "''") + "'";
};
const arr = (a: string[]) => (a.length ? `array[${a.map(lit).join(",")}]::text[]` : `'{}'::text[]`);
const json = (o: unknown) => `${lit(JSON.stringify(o))}::jsonb`;

async function main() {
  const scraped: any[] = [];
  const runs: { source: string; url: string; status: string; detail: unknown }[] = [];

  for (const d of DRUGS) {
    process.stdout.write(`• ${d.generic.padEnd(32)}`);
    let rx: Awaited<ReturnType<typeof rxnorm>> = { rxcui: null, strengths: [] };
    let label: Awaited<ReturnType<typeof fdaLabel>> = null;
    try {
      rx = await rxnorm(d);
      runs.push({ source: "rxnorm", url: `${RXNAV}/rxcui.json?name=${d.rxnormName ?? d.generic}`, status: rx.rxcui ? "ok" : "not_found", detail: { drug: d.id, rxcui: rx.rxcui, strengths: rx.strengths.length } });
    } catch (e) {
      runs.push({ source: "rxnorm", url: RXNAV, status: "error", detail: { drug: d.id, error: String(e) } });
    }
    try {
      label = await fdaLabel(d);
      runs.push({ source: "openfda", url: OPENFDA, status: label ? "ok" : "not_found", detail: { drug: d.id, set_id: label?.set_id ?? null } });
    } catch (e) {
      runs.push({ source: "openfda", url: OPENFDA, status: "error", detail: { drug: d.id, error: String(e) } });
    }
    console.log(`rxcui=${rx.rxcui ?? "—"}  strengths=${rx.strengths.length}  label=${label ? label.set_id.slice(0, 8) : "—"}`);
    scraped.push({ ...d, rxcui: rx.rxcui, strengths: rx.strengths, label });
    await sleep(250); // be polite: openFDA allows 240 req/min without a key
  }

  const outJson = join(ROOT, "data/hypertension/scraped.json");
  writeFileSync(outJson, JSON.stringify({ scraped_at: new Date().toISOString(), drugs: scraped }, null, 2));

  // ---- Build seed.sql ------------------------------------------------------
  const L: string[] = [];
  L.push("-- Generated by scripts/scrape-hypertension.ts on " + new Date().toISOString());
  L.push("-- Re-run the script to refresh. Safe to re-apply (truncates reference tables).");
  L.push("begin;");
  L.push("truncate diagnosis_medications, demographic_modifiers, scrape_runs restart identity cascade;");
  L.push("");
  for (const dx of DIAGNOSES) {
    L.push(`insert into diagnoses (id,name,icd10,description) values (${lit(dx.id)},${lit(dx.name)},${lit(dx.icd10)},${lit(dx.description)}) on conflict (id) do update set name=excluded.name, icd10=excluded.icd10, description=excluded.description;`);
  }
  L.push("");
  for (const s of scraped) {
    const lb = s.label;
    const sources = [
      { label: SOURCES.acc2017.label, url: SOURCES.acc2017.url, used_for: "dose range" },
      ...(s.rxcui ? [{ label: "RxNorm (NLM)", url: `https://mor.nlm.nih.gov/RxNav/search?searchBy=RXCUI&searchTerm=${s.rxcui}`, used_for: "RXCUI, strengths" }] : []),
      ...(lb ? [{ label: "FDA label (DailyMed)", url: `https://dailymed.nlm.nih.gov/dailymed/lookup.cfm?setid=${lb.set_id}`, used_for: "label text" }] : []),
    ];
    const cols = {
      id: s.id, generic_name: s.generic, brand_names: s.brands, drug_class: s.drugClass, class_key: s.classKey,
      rxcui: s.rxcui, mechanism: s.mechanism, usual_dose_min_mg: s.usualMin, usual_dose_max_mg: s.usualMax,
      start_dose_mg: s.start, start_dose_elderly_mg: s.startElderly ?? null, doses_per_day: s.dosesPerDay,
      available_strengths: s.strengths, avg_sbp_reduction: CLASS_EFFICACY[s.classKey] ?? null,
      monitoring: s.monitoring, pregnancy_safety: s.pregnancy, cost_tier: s.costTier,
      label_boxed_warning: lb?.boxed_warning, label_indications: lb?.indications,
      label_contraindications: lb?.contraindications, label_warnings: lb?.warnings,
      label_adverse_reactions: lb?.adverse_reactions, label_drug_interactions: lb?.drug_interactions,
      label_dosage: lb?.dosage, label_set_id: lb?.set_id, label_effective_date: lb?.effective_time,
      dailymed_url: lb ? `https://dailymed.nlm.nih.gov/dailymed/lookup.cfm?setid=${lb.set_id}` : null,
    } as Record<string, unknown>;
    const names = Object.keys(cols);
    const vals = names.map((k) => (Array.isArray(cols[k]) ? arr(cols[k] as string[]) : lit(cols[k])));
    L.push(
      `insert into medications (${names.join(",")},sources,scraped_at) values (${vals.join(",")},${json(sources)},now())\n` +
        `  on conflict (id) do update set ${names.filter((n) => n !== "id").map((n) => `${n}=excluded.${n}`).join(", ")}, sources=excluded.sources, scraped_at=excluded.scraped_at;`,
    );
  }
  L.push("");
  L.push("-- TABLE 1: diagnosis -> medications");
  for (const r of buildDiagnosisMedications()) {
    L.push(`insert into diagnosis_medications (diagnosis_id,medication_id,line_of_therapy,base_score,guideline,notes) values (${lit(r.diagnosis_id)},${lit(r.medication_id)},${lit(r.line_of_therapy)},${r.base_score},${lit(r.guideline)},${lit(r.notes)});`);
  }
  L.push("");
  L.push("-- TABLE 2: demographic / comorbidity / lab modifiers");
  let modCount = 0;
  for (const m of MODIFIERS) {
    for (const target of Array.isArray(m.target) ? m.target : [m.target]) {
      modCount++;
      L.push(
        `insert into demographic_modifiers (target_type,target,conditions,effect,score_delta,rationale,source,source_url,active) values (${lit(m.target_type)},${lit(target)},${json(m.when)},${lit(m.effect)},${m.delta},${lit(m.rationale)},${lit(SOURCES[m.source].label)},${lit(SOURCES[m.source].url)},${m.active === false ? "false" : "true"});`,
      );
    }
  }
  L.push("");
  for (const r of runs) {
    L.push(`insert into scrape_runs (source,url,status,detail) values (${lit(r.source)},${lit(r.url)},${lit(r.status)},${json(r.detail)});`);
  }
  L.push("commit;");

  const outSql = join(ROOT, "supabase/seed.sql");
  mkdirSync(dirname(outSql), { recursive: true });
  writeFileSync(outSql, L.join("\n") + "\n");

  const ok = scraped.filter((s) => s.label).length;
  const okRx = scraped.filter((s) => s.rxcui).length;
  console.log(`\nDone. ${scraped.length} drugs | RxNorm ${okRx}/${scraped.length} | FDA labels ${ok}/${scraped.length} | Table 1 rows ${buildDiagnosisMedications().length} | Table 2 rows ${modCount}`);
  console.log(`→ ${outJson}\n→ ${outSql}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
