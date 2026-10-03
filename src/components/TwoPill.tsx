"use client";

import { useState } from "react";
import clsx from "clsx";
import { CheckCircle2, Loader2, Pill, Send, Sparkles } from "lucide-react";
import { Badge, Button, Card, CardHeader, Input, Label, Textarea } from "./ui";
import { RecCard, Excluded, CoverageBox, type Fired } from "./Results";
import type { Coverage } from "@/lib/coverage";
import type { Medication, Recommendation, TreatmentPlan } from "@/lib/types";

type Run = {
  clinical_note: string | null;
  engine: string;
  model: string | null;
  candidates: { medication_id: string; line_of_therapy: string; fired: Fired[] }[];
  excluded: { medication_id: string; name: string; reasons: { matched: string; rationale: string }[] }[];
} | null;

type CombineResult = {
  recommendation: "combo" | "separate";
  reasons: string[];
  combo: {
    id: string;
    name: string;
    brands: string[];
    product_rxcui?: string;
    product_name?: string;
    exact?: boolean;
    dose_a?: number;
    dose_b?: number;
    label?: string;
    monthly_cost?: number | null;
    strengths?: string[];
    coverage?: Coverage;
  } | null;
  separate: { monthly_cost: number | null; coverage?: Coverage[] };
  /** one pill made possible by swapping a drug for a same-class sibling */
  alternative?: {
    id: string;
    name: string;
    brands: string[];
    product_rxcui: string;
    label: string;
    exact: boolean;
    swap: { from: string; to: string };
    monthly_cost: number | null;
  } | null;
};

const REASONS = ["Best overall match", "Guideline-preferred pairing", "Patient preference", "Lower cost", "Simpler regimen"];
const money = (n: number | null | undefined) => (n == null ? "price n/a" : `~$${Number(n).toFixed(2)}/month`);

/**
 * Stage 2: pick pill 1 (3 options) -> pick pill 2 (3 complementary options) ->
 * one combination tablet if it exists and fits, otherwise two separate pills -> approve.
 */
export function TwoPillFlow({
  encounterId,
  plan,
  first,
  second,
  run,
  run2,
  medById,
  onRefresh,
}: {
  encounterId: string;
  plan: TreatmentPlan;
  first: Recommendation[];
  second: Recommendation[];
  run: Run;
  run2: Run;
  medById: Map<string, Medication>;
  onRefresh: () => Promise<unknown>;
}) {
  const pill1Id = plan.pill1?.recommendation_id ?? null;
  const pill1 = first.find((r) => r.id === pill1Id) ?? null;
  const [loading2, setLoading2] = useState<string | null>(null);
  const [pill2, setPill2] = useState<Recommendation | null>(null);
  const [combine, setCombine] = useState<CombineResult | null>(null);
  const [checking, setChecking] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const cand1 = new Map((run?.candidates ?? []).map((c) => [c.medication_id, c]));
  const cand2 = new Map((run2?.candidates ?? []).map((c) => [c.medication_id, c]));

  async function choosePill1(r: Recommendation) {
    setErr(null);
    setLoading2(r.id);
    setPill2(null);
    setCombine(null);
    try {
      const res = await fetch(`/api/encounters/${encounterId}/second`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ recommendation_id: r.id, dose_mg: r.dose_mg }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error ?? "Could not find a second pill");
      await onRefresh();
      setTimeout(() => document.getElementById("pill2")?.scrollIntoView({ behavior: "smooth" }), 80);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading2(null);
    }
  }

  async function choosePill2(r: Recommendation) {
    if (!pill1) return;
    setErr(null);
    setPill2(r);
    setChecking(true);
    try {
      const res = await fetch(`/api/encounters/${encounterId}/combine`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ a: { medication_id: pill1.medication_id, dose_mg: pill1.dose_mg }, b: { medication_id: r.medication_id, dose_mg: r.dose_mg } }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error ?? "Combination check failed");
      setCombine(j);
      setTimeout(() => document.getElementById("combine")?.scrollIntoView({ behavior: "smooth" }), 80);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setChecking(false);
    }
  }

  return (
    <div className="space-y-6">
      <Card className="border-brand-200 bg-brand-50/60 p-4 text-sm">
        <p className="font-medium text-brand-700">Two medicines recommended</p>
        <p className="mt-1 text-slate-700">{plan.reason}</p>
      </Card>

      {/* Step 1 */}
      <section className="space-y-3">
        <StepTitle n={1} title="Pill 1" done={Boolean(pill1)} subtitle={pill1 ? `Chosen: ${medById.get(pill1.medication_id)?.generic_name} ${pill1.dose_mg} mg` : "Pick the first drug"} />
        {run?.clinical_note && <p className="whitespace-pre-line rounded-lg bg-sky-50/70 p-3 text-sm text-slate-700">{run.clinical_note}</p>}
        <div className="grid gap-4 lg:grid-cols-3">
          {first.map((r) => (
            <RecCard
              key={r.id}
              rec={r}
              med={medById.get(r.medication_id)}
              evidence={cand1.get(r.medication_id)?.fired ?? []}
              line={cand1.get(r.medication_id)?.line_of_therapy}
              selected={pill1?.id === r.id}
              busy={loading2 === r.id}
              disabled={Boolean(loading2)}
              chooseLabel={pill1 ? "Use as pill 1 instead" : "Choose as pill 1"}
              onChoose={() => choosePill1(r)}
            />
          ))}
        </div>
        {run && <Excluded items={run.excluded} />}
      </section>

      {loading2 && (
        <Card className="flex items-center gap-3 p-5 text-sm text-slate-600">
          <Loader2 size={16} className="animate-spin" /> Finding the best second drug to pair with {medById.get(first.find((r) => r.id === loading2)?.medication_id ?? "")?.generic_name}…
        </Card>
      )}

      {/* Step 2 */}
      {pill1 && !loading2 && second.length > 0 && (
        <section id="pill2" className="space-y-3">
          <StepTitle
            n={2}
            title="Pill 2"
            done={Boolean(pill2)}
            subtitle={`Pairs with ${medById.get(pill1.medication_id)?.generic_name} — unsafe pairings are already excluded`}
          />
          <div className="grid gap-4 lg:grid-cols-3">
            {second.map((r) => (
              <RecCard
                key={r.id}
                rec={r}
                med={medById.get(r.medication_id)}
                evidence={cand2.get(r.medication_id)?.fired ?? []}
                line={cand2.get(r.medication_id)?.line_of_therapy}
                selected={pill2?.id === r.id}
                busy={checking && pill2?.id === r.id}
                disabled={checking}
                chooseLabel="Choose as pill 2"
                onChoose={() => choosePill2(r)}
              />
            ))}
          </div>
        </section>
      )}

      {err && <p className="text-sm text-red-600">{err}</p>}

      {/* Step 3 */}
      {pill1 && pill2 && combine && (
        <CombinePanel
          key={`${pill1.id}-${pill2.id}`}
          encounterId={encounterId}
          pill1={pill1}
          pill2={pill2}
          med1={medById.get(pill1.medication_id)}
          med2={medById.get(pill2.medication_id)}
          result={combine}
          onDone={onRefresh}
        />
      )}
    </div>
  );
}

function StepTitle({ n, title, subtitle, done }: { n: number; title: string; subtitle: string; done: boolean }) {
  return (
    <div className="flex items-center gap-3">
      <span className={clsx("grid h-7 w-7 place-items-center rounded-full text-xs font-semibold", done ? "bg-brand-600 text-white" : "bg-slate-900 text-white")}>
        {done ? <CheckCircle2 size={14} /> : n}
      </span>
      <div>
        <h2 className="text-lg font-semibold leading-tight">{title}</h2>
        <p className="text-sm text-slate-500">{subtitle}</p>
      </div>
    </div>
  );
}

function CombinePanel({
  encounterId, pill1, pill2, med1, med2, result, onDone,
}: {
  encounterId: string;
  pill1: Recommendation;
  pill2: Recommendation;
  med1?: Medication;
  med2?: Medication;
  result: CombineResult;
  onDone: () => Promise<unknown>;
}) {
  const comboUsable = Boolean(result.combo?.product_rxcui);
  const [mode, setMode] = useState<"combo" | "separate" | "alt">(result.recommendation === "combo" && comboUsable ? "combo" : "separate");
  const [a, setA] = useState({ dose_mg: String(pill1.dose_mg ?? ""), sig: pill1.sig ?? "" });
  const [b, setB] = useState({ dose_mg: String(pill2.dose_mg ?? ""), sig: pill2.sig ?? "" });
  const [comboSig, setComboSig] = useState("Take 1 tablet by mouth once daily.");
  const [chips, setChips] = useState<string[]>([]);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function send() {
    setBusy(true);
    setErr(null);
    const base = { dispense_unit: "Tablet", days_supply: 30, fills_allowed: 3 };
    const single = mode === "combo" ? result.combo : mode === "alt" ? result.alternative : null;
    const items =
      single
        ? [{ ...base, combination_id: single.id, combo_product_rxcui: single.product_rxcui, combo_label: single.label, sig: comboSig, dispense_quantity: 30, monthly_cost: single.monthly_cost }]
        : [
            { ...base, recommendation_id: pill1.id, dose_mg: a.dose_mg, sig: a.sig, dispense_quantity: med1?.doses_per_day?.startsWith("2") ? 60 : 30 },
            { ...base, recommendation_id: pill2.id, dose_mg: b.dose_mg, sig: b.sig, dispense_quantity: med2?.doses_per_day?.startsWith("2") ? 60 : 30 },
          ];
    try {
      const r = await fetch(`/api/encounters/${encounterId}/prescribe`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          items,
          selection_reason: [
            mode === "combo" ? "Single-pill combination" : mode === "alt" ? `Single-pill combination (swapped ${result.alternative?.swap.from} for ${result.alternative?.swap.to})` : "Two separate pills",
            ...chips,
            note.trim(),
          ]
            .filter(Boolean)
            .join("; "),
        }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? "Could not create the prescription");
      if (j.photon) sessionStorage.setItem(`photon:${j.prescription_id}`, JSON.stringify(j.photon));
      await onDone();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  }

  const option = (key: "combo" | "separate" | "alt", title: React.ReactNode, sub: React.ReactNode, cost: number | null | undefined, recommended: boolean, disabled = false) => (
    <button
      type="button"
      disabled={disabled}
      onClick={() => setMode(key)}
      aria-pressed={mode === key}
      className={clsx(
        "flex-1 rounded-xl border p-4 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-50",
        mode === key ? "border-brand-600 bg-brand-50 ring-2 ring-brand-500" : "border-slate-200 bg-white hover:border-slate-300",
      )}
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-semibold">{title}</span>
        {recommended && <Badge tone="brand"><Sparkles size={11} /> Recommended</Badge>}
      </div>
      <p className="mt-1 text-sm text-slate-600">{sub}</p>
      <p className="mt-2 text-xs text-slate-500">{money(cost)}</p>
    </button>
  );

  return (
    <Card id="combine">
      <CardHeader title="Step 3 · One pill or two?" subtitle={`${med1?.generic_name} + ${med2?.generic_name}`} />
      <div className="space-y-5 p-5">
        <div className="flex flex-col gap-3 md:flex-row">
          {option(
            "combo",
            <>One combination pill</>,
            result.combo?.product_rxcui ? (
              <>
                <span className="font-medium capitalize">{result.combo.label}</span>
                {result.combo.brands?.length ? <> ({result.combo.brands.join(", ")})</> : null}
                {result.combo.exact === false && <span className="block text-xs text-amber-700">Closest available strength to the chosen doses.</span>}
              </>
            ) : result.combo ? (
              <>Made as {result.combo.name}, but not in a strength close to these doses.</>
            ) : (
              <>No single tablet contains both drugs.</>
            ),
            result.combo?.monthly_cost,
            result.recommendation === "combo" && comboUsable,
            !comboUsable,
          )}
          {option(
            "separate",
            <>Two separate pills</>,
            <>
              <span className="capitalize">{med1?.generic_name}</span> {a.dose_mg} mg + <span className="capitalize">{med2?.generic_name}</span> {b.dose_mg} mg
            </>,
            result.separate.monthly_cost,
            result.recommendation === "separate",
          )}
          {result.alternative &&
            option(
              "alt",
              <>One pill, same-class swap</>,
              <>
                <span className="font-medium capitalize">{result.alternative.label}</span>
                {result.alternative.brands?.length ? <> ({result.alternative.brands.join(", ")})</> : null}
                <span className="block text-xs text-amber-700">
                  Uses {result.alternative.swap.to} instead of {result.alternative.swap.from} (same drug class) so both fit in one tablet.
                  {!result.alternative.exact && " Closest available strength — check the doses."}
                </span>
              </>,
              result.alternative.monthly_cost,
              false,
            )}
        </div>

        {result.reasons.length > 0 && (
          <ul className="space-y-1 text-sm text-amber-800">
            {result.reasons.map((r, i) => (
              <li key={i}>• {r}</li>
            ))}
          </ul>
        )}
        {result.recommendation === "combo" && comboUsable && (
          <p className="text-sm text-slate-600">One pill a day improves adherence and is what the 2025 guideline prefers when a combination exists at the right doses.</p>
        )}
        {result.combo?.monthly_cost != null && result.separate.monthly_cost != null && result.combo.monthly_cost - result.separate.monthly_cost > 1 && (
          <p className="text-sm text-slate-600">
            Two separate pills would cost about ${(result.combo.monthly_cost - result.separate.monthly_cost).toFixed(2)} less per month (cash estimate); the patient&apos;s real copay shows in Photon.
          </p>
        )}

        {(mode === "combo" && result.combo) || (mode === "alt" && result.alternative) ? (
          <label className="block">
            <Label>Directions</Label>
            <Input value={comboSig} onChange={(e) => setComboSig(e.target.value)} />
            <span className="mt-1 block text-xs text-slate-500">#30 tablets · 30 days · 3 fills</span>
          </label>
        ) : (
          <div className="grid gap-3 md:grid-cols-2">
            {[
              { m: med1, v: a, set: setA },
              { m: med2, v: b, set: setB },
            ].map(({ m, v, set }, i) => (
              <div key={i} className="space-y-2 rounded-lg border border-slate-200 p-3">
                <p className="flex items-center gap-2 font-medium capitalize">
                  <Pill size={14} className="text-brand-600" /> Pill {i + 1}: {m?.generic_name}
                </p>
                <label className="block">
                  <Label hint={m ? `${m.usual_dose_min_mg}–${m.usual_dose_max_mg} mg/day` : undefined}>Dose (mg)</Label>
                  <Input type="number" step="0.5" value={v.dose_mg} onChange={(e) => set({ ...v, dose_mg: e.target.value })} />
                </label>
                <label className="block">
                  <Label>Directions</Label>
                  <Input value={v.sig} onChange={(e) => set({ ...v, sig: e.target.value })} />
                </label>
              </div>
            ))}
          </div>
        )}

        {mode === "combo" && result.combo?.product_rxcui && (
          <CoverageBox
            coverage={result.combo.coverage}
            encounterId={encounterId}
            request={{ combo: { id: result.combo.id, product_rxcui: result.combo.product_rxcui, label: result.combo.label ?? result.combo.name }, sig: comboSig, quantity: 30 }}
          />
        )}
        {mode === "separate" &&
          result.separate.coverage?.map((c, i) =>
            c.status !== "unknown" && c.status !== "covered" ? (
              <CoverageBox
                key={i}
                coverage={c}
                encounterId={encounterId}
                request={i === 0 ? { medication_id: pill1.medication_id, dose_mg: a.dose_mg, sig: a.sig } : { medication_id: pill2.medication_id, dose_mg: b.dose_mg, sig: b.sig }}
              />
            ) : null,
          )}
        <div>
          <Label>Why this plan?</Label>
          <div className="mb-2 flex flex-wrap gap-1.5">
            {REASONS.map((r) => {
              const on = chips.includes(r);
              return (
                <button
                  key={r}
                  type="button"
                  aria-pressed={on}
                  onClick={() => setChips(on ? chips.filter((x) => x !== r) : [...chips, r])}
                  className={clsx("rounded-full border px-2.5 py-1 text-xs", on ? "border-brand-600 bg-brand-600 text-white" : "border-slate-300 text-slate-700")}
                >
                  {r}
                </button>
              );
            })}
          </div>
          <Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Optional note" />
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <Button onClick={send} disabled={busy}>
            {busy ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />} Approve & send to Photon
          </Button>
          <span className="text-xs text-slate-500">Prices are NADAC averages (what pharmacies pay), not the patient&apos;s copay.</span>
          {err && <span className="text-sm text-red-600">{err}</span>}
        </div>
      </div>
    </Card>
  );
}
