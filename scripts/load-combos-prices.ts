/**
 * Loads data/hypertension/combos_prices.json into Supabase (same data as supabase/seed_combos_prices.sql).
 * Usage: npx tsx scripts/load-combos-prices.ts
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";

config({ path: join(__dirname, "../.env.local"), quiet: true });
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

async function main() {
  const d = JSON.parse(readFileSync(join(__dirname, "../data/hypertension/combos_prices.json"), "utf8"));
  await db.from("drug_prices").delete().neq("rxcui", "");
  await db.from("combination_products").delete().neq("id", "");
  const combos = d.combos.map((c: any) => ({ // eslint-disable-line @typescript-eslint/no-explicit-any
    id: c.id, name: c.name, medication_a: c.med_a, medication_b: c.med_b, brand_names: c.brands, products: c.products,
    source_url: `https://mor.nlm.nih.gov/RxNav/search?searchBy=RXCUI&searchTerm=${c.id}`,
  }));
  const r1 = await db.from("combination_products").insert(combos).select("id");
  if (r1.error) throw r1.error;
  const prices = d.prices.map((p: any) => ({ // eslint-disable-line @typescript-eslint/no-explicit-any
    rxcui: p.rxcui, name: p.name, medication_id: p.medication_id, combination_id: p.combination_id, dose_mg: p.dose_mg,
    nadac_per_unit: p.nadac_per_unit, effective_date: p.effective_date, ndc_count: p.ndc_count,
  }));
  const r2 = await db.from("drug_prices").insert(prices).select("rxcui");
  if (r2.error) throw r2.error;
  console.log(`loaded ${r1.data.length} combinations, ${r2.data.length} prices`);
}
main().catch((e) => { console.error(e); process.exit(1); });
