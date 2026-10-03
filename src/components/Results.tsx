"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import clsx from "clsx";
import { AlertTriangle, CheckCircle2, ChevronDown, ExternalLink, Loader2, Pill, Send, ShieldAlert, UserCog } from "lucide-react";
import { Badge, Button, Card, CardHeader, Input, Label, Select, Textarea } from "./ui";
import { MatchMeter } from "./MatchMeter";
import { PhotonPrescribe, type PhotonConfig } from "./PhotonPrescribe";
import type { Medication, Patient, PatientMessage, Prescription, Recommendation } from "@/lib/types";

export type Fired = { effect: string; delta: number; rationale: string; matched: string; source: string; source_url: string | null };
export type MedOption = Pick<Medication, "id" | "generic_name" | "brand_names" | "drug_class" | "usual_dose_min_mg" | "usual_dose_max_mg" | "start_dose_mg" | "doses_per_day" | "available_strengths">;

// ---------------------------------------------------------------------------
export function RecCard({
  rec, med, evidence, line, selected, onChoose, disabled, chooseLabel = "Prescribe this", busy,
}: {
  rec: Recommendation;
  med?: Medication;
  evidence: Fired[];
  line?: string;
  selected: boolean;
  onChoose: () => void;
  disabled?: boolean;
  chooseLabel?: string;
  busy?: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Card className={clsx("flex flex-col transition-shadow", selected && "ring-2 ring-brand-500")}>
      <div className="flex items-start gap-4 p-5">
        <MatchMeter value={rec.match_percent} />
        <div className="min-w-0">
          <div className="text-xs font-medium text-slate-500">#{rec.rank}</div>
          <h3 className="text-lg font-semibold capitalize leading-tight">{med?.generic_name ?? rec.medication_id}</h3>
          {med?.brand_names.length ? <p className="text-xs text-slate-500">{med.brand_names.join(", ")}</p> : null}
          <div className="mt-1.5 flex flex-wrap gap-1">
            {med && <Badge>{med.drug_class}</Badge>}
            {line && <Badge tone={line === "first_line" ? "green" : "slate"}>{line.replace("_", " ")}</Badge>}
          </div>
        </div>
      </div>
      <div className="flex-1 space-y-3 px-5 pb-4 text-sm">
        <p className="text-slate-700">{rec.summary}</p>
        <div className="rounded-lg bg-slate-50 p-3">
          <div className="flex items-center gap-2 font-medium">
            <Pill size={14} className="text-brand-600" /> {rec.dose_mg} mg
          </div>
          <p className="mt-0.5 text-slate-600">{rec.sig}</p>
          {rec.monthly_cost != null && (
            <p className="mt-1 text-xs text-slate-500" title="NADAC: average price pharmacies pay (cash-price estimate, not the patient's copay)">
              ~${Number(rec.monthly_cost).toFixed(2)} / month (generic, NADAC)
            </p>
          )}
        </div>
        {rec.factors_for.length > 0 && (
          <ul className="space-y-1">
            {rec.factors_for.map((f, i) => (
              <li key={i} className="flex gap-1.5 text-emerald-800">
                <CheckCircle2 size={14} className="mt-0.5 shrink-0" /> {f}
              </li>
            ))}
          </ul>
        )}
        {rec.factors_against.length > 0 && (
          <ul className="space-y-1">
            {rec.factors_against.map((f, i) => (
              <li key={i} className="flex gap-1.5 text-amber-800">
                <AlertTriangle size={14} className="mt-0.5 shrink-0" /> {f}
              </li>
            ))}
          </ul>
        )}
        <button className="flex items-center gap-1 text-xs font-medium text-slate-500 hover:text-ink" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
          <ChevronDown size={14} className={clsx("transition-transform", open && "rotate-180")} /> Reasoning & evidence
        </button>
        {open && (
          <div className="space-y-3 text-xs text-slate-600">
            <p className="leading-relaxed">{rec.rationale}</p>
            {evidence.length > 0 && (
              <ul className="space-y-1">
                {evidence.map((f, i) => (
                  <li key={i} className="flex gap-2">
                    <span className={clsx("w-9 shrink-0 text-right font-mono tabular-nums", f.delta >= 0 ? "text-emerald-700" : "text-red-700")}>
                      {f.delta >= 0 ? "+" : ""}
                      {f.delta}
                    </span>
                    <span>
                      {f.rationale}{" "}
                      {f.source_url ? (
                        <a className="text-sky-700 hover:underline" href={f.source_url} target="_blank" rel="noreferrer">
                          {f.source}
                        </a>
                      ) : null}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            {med?.label_boxed_warning && (
              <p className="rounded-md border border-red-200 bg-red-50 p-2 text-red-800">
                <span className="font-semibold">Boxed warning: </span>
                {med.label_boxed_warning.slice(0, 280)}…
              </p>
            )}
            {rec.monitoring && <p><span className="font-medium text-slate-700">Monitoring: </span>{rec.monitoring}</p>}
            {med?.dailymed_url && (
              <a className="inline-flex items-center gap-1 text-sky-700 hover:underline" href={med.dailymed_url} target="_blank" rel="noreferrer">
                FDA label <ExternalLink size={12} />
              </a>
            )}
          </div>
        )}
      </div>
      <div className="border-t border-slate-100 p-4">
        <Button className="w-full" variant={selected ? "primary" : "secondary"} onClick={onChoose} disabled={disabled || busy}>
          {busy ? <Loader2 size={16} className="animate-spin" /> : selected ? <CheckCircle2 size={16} /> : null} {selected ? "Selected" : chooseLabel}
        </Button>
      </div>
    </Card>
  );
}

export function Excluded({ items }: { items: { medication_id: string; name: string; reasons: { matched: string; rationale: string }[] }[] }) {
  const [open, setOpen] = useState(false);
  if (!items.length) return null;
  return (
    <Card>
      <button className="flex w-full items-center gap-2 px-5 py-3 text-left text-sm" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <ShieldAlert size={16} className="text-red-600" />
        <span className="font-medium">{items.length} medication{items.length > 1 ? "s" : ""} excluded as contraindicated</span>
        <ChevronDown size={16} className={clsx("ml-auto transition-transform", open && "rotate-180")} />
      </button>
      {open && (
        <ul className="divide-y divide-slate-100 border-t border-slate-100 text-sm">
          {items.map((x) => (
            <li key={x.medication_id} className="px-5 py-2.5">
              <span className="font-medium capitalize">{x.name}</span>
              {x.reasons.map((r, i) => (
                <p key={i} className="text-xs text-slate-600">
                  {r.rationale} <span className="text-slate-400">({r.matched})</span>
                </p>
              ))}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------------------
const REASONS = ["Best overall match", "Patient preference", "Lower cost / generic", "Once-daily, simpler regimen", "Prior good response", "Fewer side effects for this patient"];

/** Doctor's decision: confirm one recommendation (with a reason) or override with their own prescription. */
export function DecisionPanel({
  encounterId, rec, med, override, meds, onDone, onCancel,
}: {
  encounterId: string;
  rec: Recommendation | null;
  med?: Medication;
  override: boolean;
  meds: MedOption[];
  onDone: () => Promise<unknown>;
  onCancel: () => void;
}) {
  const [drug, setDrug] = useState<string>(rec?.medication_id ?? "");
  const [custom, setCustom] = useState("");
  const picked = meds.find((m) => m.id === drug);
  const [form, setForm] = useState({
    dose_mg: rec?.dose_mg?.toString() ?? "",
    sig: rec?.sig ?? "",
    dispense_quantity: rec?.dispense_quantity ?? 30,
    dispense_unit: "Tablet",
    days_supply: rec?.days_supply ?? 30,
    fills_allowed: rec?.fills_allowed ?? 3,
    notes: "",
  });
  const [chips, setChips] = useState<string[]>([]);
  const [why, setWhy] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Prefill a sensible regimen when the doctor picks an override drug
  function pickDrug(id: string) {
    setDrug(id);
    const m = meds.find((x) => x.id === id);
    if (!m) return;
    const twice = m.doses_per_day?.startsWith("2");
    const dose = m.start_dose_mg ?? m.usual_dose_min_mg;
    setForm((f) => ({ ...f, dose_mg: String(dose ?? ""), sig: `Take ${dose} mg by mouth ${twice ? "twice daily" : "once daily"}.`, dispense_quantity: twice ? 60 : 30 }));
  }

  const reason = [...chips, why.trim()].filter(Boolean).join("; ");
  const usual = override ? picked : med;

  async function send() {
    setBusy(true);
    setErr(null);
    try {
      const r = await fetch(`/api/encounters/${encounterId}/prescribe`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          ...(override ? { override: true, medication_id: drug && drug !== "__other" ? drug : null, custom_medication: drug === "__other" ? custom : null } : { recommendation_id: rec!.id }),
          selection_reason: reason,
          ...form,
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

  return (
    <Card id="decision">
      <CardHeader
        title={override ? "Your own prescription" : `Prescribe ${med?.generic_name ?? ""}`}
        subtitle={override ? "Override the recommendations. A reason is required and saved with the prescription." : "Confirm the regimen and note why you chose it."}
        right={<Button variant="ghost" onClick={onCancel}>Cancel</Button>}
      />
      <div className="space-y-4 p-5">
        {override && (
          <div className="grid gap-3 sm:grid-cols-2">
            <label>
              <Label>Medication</Label>
              <Select value={drug} onChange={(e) => pickDrug(e.target.value)}>
                <option value="">Choose…</option>
                {meds.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.generic_name} — {m.drug_class}
                  </option>
                ))}
                <option value="__other">Other (type name)…</option>
              </Select>
            </label>
            {drug === "__other" && (
              <label>
                <Label>Drug name</Label>
                <Input value={custom} onChange={(e) => setCustom(e.target.value)} placeholder="e.g. amlodipine/benazepril 5/20 mg" />
              </label>
            )}
          </div>
        )}
        <div className="grid gap-3 sm:grid-cols-4">
          <label>
            <Label hint={usual ? `${usual.usual_dose_min_mg}–${usual.usual_dose_max_mg}/day` : undefined}>Dose (mg)</Label>
            <Input type="number" step="0.5" value={form.dose_mg} onChange={(e) => setForm({ ...form, dose_mg: e.target.value })} />
          </label>
          <label>
            <Label>Quantity</Label>
            <Input type="number" value={form.dispense_quantity} onChange={(e) => setForm({ ...form, dispense_quantity: Number(e.target.value) })} />
          </label>
          <label>
            <Label>Days</Label>
            <Input type="number" value={form.days_supply} onChange={(e) => setForm({ ...form, days_supply: Number(e.target.value) })} />
          </label>
          <label>
            <Label>Fills</Label>
            <Input type="number" value={form.fills_allowed} onChange={(e) => setForm({ ...form, fills_allowed: Number(e.target.value) })} />
          </label>
          <label className="sm:col-span-4">
            <Label>Directions</Label>
            <Input value={form.sig} onChange={(e) => setForm({ ...form, sig: e.target.value })} />
          </label>
        </div>
        <div>
          <Label>{override ? "Why are you overriding?" : "Why this one?"}</Label>
          {!override && (
            <div className="mb-2 flex flex-wrap gap-1.5">
              {REASONS.map((r) => {
                const on = chips.includes(r);
                return (
                  <button
                    key={r}
                    type="button"
                    aria-pressed={on}
                    onClick={() => setChips(on ? chips.filter((x) => x !== r) : [...chips, r])}
                    className={clsx("rounded-full border px-2.5 py-1 text-xs", on ? "border-brand-600 bg-brand-600 text-white" : "border-slate-300 text-slate-700 hover:border-slate-400")}
                  >
                    {r}
                  </button>
                );
              })}
            </div>
          )}
          <Textarea rows={2} value={why} onChange={(e) => setWhy(e.target.value)} placeholder={override ? "e.g. Patient did well on this before; needs a combination pill" : "Optional note"} />
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Button onClick={send} disabled={busy || !form.sig || (override && (!drug || (drug === "__other" && !custom.trim()) || !reason))}>
            {busy ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />} Approve & send to Photon
          </Button>
          <span className="text-xs text-slate-500">You are the prescriber of record.</span>
          {err && <span className="text-sm text-red-600">{err}</span>}
        </div>
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------------------
const STEPS: { key: Prescription["status"]; label: string }[] = [
  { key: "sent_to_photon", label: "Sent to Photon" },
  { key: "patient_notified", label: "Patient notified" },
  { key: "pharmacy_selected", label: "Pharmacy selected" },
  { key: "filled", label: "Ready at pharmacy" },
  { key: "picked_up", label: "Picked up" },
];

export function RxTracker({
  rx, med, patient, messages, onChanged, group = [rx], medById,
}: {
  rx: Prescription;
  group?: Prescription[];
  medById?: Map<string, Medication>;
  med?: Medication;
  patient: Patient;
  messages: PatientMessage[];
  onChanged: () => Promise<unknown>;
}) {
  const [photon, setPhoton] = useState<PhotonConfig | null>(() => {
    if (typeof window === "undefined") return null;
    const cached = sessionStorage.getItem(`photon:${rx.id}`);
    return cached ? (JSON.parse(cached) as PhotonConfig) : null;
  });
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (rx.photon_mode !== "live" || !["draft", "sent_to_photon"].includes(rx.status) || photon) return;
    fetch(`/api/prescriptions/${rx.id}`).then(async (r) => r.ok && setPhoton(await r.json()));
  }, [rx, photon]);

  async function photonEvent(e: Record<string, unknown>) {
    await fetch(`/api/prescriptions/${rx.id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(e) });
    await onChanged();
  }
  async function mock(step: "pharmacy" | "ready" | "picked_up") {
    setBusy(true);
    await fetch(`/api/prescriptions/${rx.id}/mock`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ step }) });
    await onChanged();
    setBusy(false);
  }

  const idx = STEPS.findIndex((s) => s.key === rx.status);
  const name = med?.generic_name ?? rx.custom_medication;
  return (
    <Card>
      <CardHeader
        title="Prescription"
        subtitle={rx.photon_mode === "live" ? "Photon Health (sandbox)" : "Photon mock mode (no credentials set)"}
        right={<Badge tone={rx.status === "error" ? "red" : "green"}>{rx.status.replace(/_/g, " ")}</Badge>}
      />
      <div className="space-y-5 p-5">
        <div className="text-sm">
          {group.length > 1 && (
            <ul className="mb-2 space-y-1">
              {group.map((g, i) => (
                <li key={g.id} className="flex flex-wrap items-center gap-2">
                  <Pill size={14} className="text-brand-600" />
                  <span className="font-medium capitalize">
                    Pill {i + 1}: {(g.medication_id && medById?.get(g.medication_id)?.generic_name) || g.custom_medication}
                  </span>
                  {g.dose_mg ? `${g.dose_mg} mg` : ""} — {g.sig}
                </li>
              ))}
            </ul>
          )}
          <p className={clsx("flex flex-wrap items-center gap-2", group.length > 1 && "hidden")}>
            <span className="font-medium capitalize">{name}</span> {rx.dose_mg ? `${rx.dose_mg} mg` : ""} — {rx.sig}
            {rx.is_override && (
              <Badge tone="amber">
                <UserCog size={12} /> Doctor override
              </Badge>
            )}
          </p>
          <p className="text-slate-500">
            #{rx.dispense_quantity} {rx.dispense_unit} · {rx.days_supply} days · {rx.fills_allowed} fills
          </p>
          {rx.selection_reason && <p className="mt-1 text-slate-600">Reason: {rx.selection_reason}</p>}
        </div>
        <ol className="flex flex-wrap items-center gap-2">
          {STEPS.map((s, i) => (
            <li key={s.key} className="flex items-center gap-2">
              <span className={clsx("flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium", i <= idx ? "bg-brand-600 text-white" : "bg-slate-100 text-slate-500")}>
                {i <= idx && <CheckCircle2 size={12} />} {s.label}
              </span>
              {i < STEPS.length - 1 && <span className="h-px w-4 bg-slate-300" />}
            </li>
          ))}
        </ol>
        {rx.photon_mode === "live" && ["draft", "sent_to_photon"].includes(rx.status) && photon && (
          <PhotonPrescribe
            config={photon}
            prescriptionId={rx.id}
            draft={{ dispenseQuantity: rx.dispense_quantity, dispenseUnit: rx.dispense_unit, fillsAllowed: rx.fills_allowed, daysSupply: rx.days_supply, instructions: rx.sig, notes: rx.notes ?? undefined }}
            extraDrafts={group
              .filter((g) => g.id !== rx.id)
              .map((g) => ({ externalId: g.id, treatmentId: g.photon_treatment_id, dispenseQuantity: g.dispense_quantity, dispenseUnit: g.dispense_unit, fillsAllowed: g.fills_allowed, daysSupply: g.days_supply, instructions: g.sig }))}
            onEvent={photonEvent}
          />
        )}
        {rx.photon_mode === "mock" && !["picked_up", "canceled"].includes(rx.status) && (
          <div className="rounded-lg border border-dashed border-slate-300 p-3">
            <p className="mb-2 text-xs text-slate-500">Mock mode: simulate what Photon and the pharmacy would report.</p>
            <div className="flex flex-wrap gap-2">
              <Button variant="secondary" disabled={busy || rx.status !== "patient_notified"} onClick={() => mock("pharmacy")}>Patient picks pharmacy</Button>
              <Button variant="secondary" disabled={busy || rx.status !== "pharmacy_selected"} onClick={() => mock("ready")}>Pharmacy fills</Button>
              <Button variant="secondary" disabled={busy || rx.status !== "filled"} onClick={() => mock("picked_up")}>Patient picks up</Button>
            </div>
          </div>
        )}
        <div>
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-sm font-medium">Messages to the patient</h3>
            <Link href={`/patient/${patient.id}`} target="_blank" className="text-xs text-sky-700 hover:underline">Open patient&apos;s phone</Link>
          </div>
          {messages.length === 0 ? (
            <p className="text-sm text-slate-400">No messages yet.</p>
          ) : (
            <ul className="space-y-2">
              {messages.map((m) => (
                <li key={m.id} className="rounded-lg bg-orange-50 px-3 py-2 text-sm text-orange-950">
                  <span className="mr-2 text-[11px] uppercase tracking-wide text-orange-700">
                    {m.source === "photon" ? "Photon" : "Photon (mock)"} · {new Date(m.created_at).toLocaleTimeString()}
                  </span>
                  {m.body}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </Card>
  );
}
