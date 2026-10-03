"use client";

import { useState } from "react";
import clsx from "clsx";
import { Loader2, X } from "lucide-react";
import { Button, Input, Label, ListInput, Select } from "./ui";
import { CONDITIONS, ETHNICITIES, type Encounter, type Patient } from "@/lib/types";

/** Slide-over to correct anything the scribe got wrong. Saves, then the caller can regenerate. */
export function ChartEditor({
  patient,
  encounter,
  onClose,
  onSaved,
  saveLabel = "Save chart",
}: {
  patient: Patient;
  encounter: Encounter;
  onClose: () => void;
  onSaved: (p: Patient, e: Pick<Encounter, "vitals" | "labs">) => Promise<void> | void;
  saveLabel?: string;
}) {
  const [p, setP] = useState(patient);
  const [vitals, setVitals] = useState(encounter.vitals);
  const [labs, setLabs] = useState(encounter.labs);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const num = (v: string) => (v === "" ? null : Number(v));
  const groups = Array.from(new Set(CONDITIONS.map((c) => c.group)));

  async function save() {
    setBusy(true);
    setErr(null);
    try {
      const clean = { ...p, current_medications: p.current_medications.map((s) => s.trim()).filter(Boolean), allergies: p.allergies.map((s) => s.trim()).filter(Boolean) };
      const [r1, r2] = await Promise.all([
        fetch(`/api/patients/${p.id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(clean) }),
        fetch(`/api/encounters/${encounter.id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ vitals, labs }) }),
      ]);
      if (!r1.ok || !r2.ok) throw new Error("Save failed");
      await onSaved(await r1.json(), { vitals, labs });
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-40 flex justify-end bg-slate-900/30" onClick={onClose}>
      <div className="flex h-full w-full max-w-md flex-col bg-white shadow-xl" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Edit chart">
        <div className="flex items-center border-b border-slate-200 px-5 py-4">
          <h2 className="font-semibold">Edit chart</h2>
          <button className="ml-auto" onClick={onClose} aria-label="Close">
            <X size={18} />
          </button>
        </div>
        <div className="flex-1 space-y-4 overflow-y-auto p-5">
          <div className="grid grid-cols-2 gap-3">
            <label>
              <Label>First name</Label>
              <Input value={p.first_name ?? ""} onChange={(e) => setP({ ...p, first_name: e.target.value || null })} />
            </label>
            <label>
              <Label>Last name</Label>
              <Input value={p.last_name ?? ""} onChange={(e) => setP({ ...p, last_name: e.target.value || null })} />
            </label>
            <label>
              <Label>Date of birth</Label>
              <Input type="date" value={p.date_of_birth ?? ""} onChange={(e) => setP({ ...p, date_of_birth: e.target.value || null, dob_is_estimate: false })} />
            </label>
            <label>
              <Label>Sex at birth</Label>
              <Select value={p.sex ?? ""} onChange={(e) => setP({ ...p, sex: (e.target.value || null) as Patient["sex"] })}>
                <option value="">—</option>
                <option value="FEMALE">Female</option>
                <option value="MALE">Male</option>
              </Select>
            </label>
            <label className="col-span-2">
              <Label hint="self-reported">Ethnicity</Label>
              <Select value={p.ethnicity ?? ""} onChange={(e) => setP({ ...p, ethnicity: e.target.value || null })}>
                <option value="">—</option>
                {ETHNICITIES.map((x) => (
                  <option key={x.key} value={x.key}>
                    {x.label}
                  </option>
                ))}
              </Select>
            </label>
            <label>
              <Label>Height (cm)</Label>
              <Input type="number" value={p.height_cm ?? ""} onChange={(e) => setP({ ...p, height_cm: num(e.target.value) })} />
            </label>
            <label>
              <Label>Weight (kg)</Label>
              <Input type="number" value={p.weight_kg ?? ""} onChange={(e) => setP({ ...p, weight_kg: num(e.target.value) })} />
            </label>
            <label className="col-span-2">
              <Label>Mobile (Photon texts this)</Label>
              <Input value={p.phone ?? ""} onChange={(e) => setP({ ...p, phone: e.target.value || null })} />
            </label>
            <label className="col-span-2">
              <Label>Street address</Label>
              <Input value={p.address?.street1 ?? ""} onChange={(e) => setP({ ...p, address: { ...p.address, street1: e.target.value } })} placeholder="42 Oak St" />
            </label>
            <label>
              <Label>Apt / unit</Label>
              <Input value={p.address?.street2 ?? ""} onChange={(e) => setP({ ...p, address: { ...p.address, street2: e.target.value } })} />
            </label>
            <label>
              <Label>City</Label>
              <Input value={p.address?.city ?? ""} onChange={(e) => setP({ ...p, address: { ...p.address, city: e.target.value } })} />
            </label>
            <label>
              <Label>State</Label>
              <Input maxLength={2} value={p.address?.state ?? ""} onChange={(e) => setP({ ...p, address: { ...p.address, state: e.target.value.toUpperCase() } })} placeholder="NY" />
            </label>
            <label>
              <Label>ZIP</Label>
              <Input inputMode="numeric" value={p.address?.postalCode ?? ""} onChange={(e) => setP({ ...p, address: { ...p.address, postalCode: e.target.value } })} />
            </label>
            {p.sex !== "MALE" && (
              <label className="col-span-2">
                <Label>Pregnancy status</Label>
                <Select value={p.pregnancy_status} onChange={(e) => setP({ ...p, pregnancy_status: e.target.value as Patient["pregnancy_status"] })}>
                  <option value="not_applicable">Not applicable</option>
                  <option value="not_pregnant">Not pregnant</option>
                  <option value="childbearing_potential">Childbearing potential</option>
                  <option value="pregnant">Pregnant</option>
                  <option value="breastfeeding">Breastfeeding</option>
                </Select>
              </label>
            )}
          </div>
          <div>
            <Label>Vitals</Label>
            <div className="grid grid-cols-3 gap-2">
              <Input placeholder="SBP" aria-label="Systolic" type="number" value={vitals.bp_systolic ?? ""} onChange={(e) => setVitals({ ...vitals, bp_systolic: num(e.target.value) })} />
              <Input placeholder="DBP" aria-label="Diastolic" type="number" value={vitals.bp_diastolic ?? ""} onChange={(e) => setVitals({ ...vitals, bp_diastolic: num(e.target.value) })} />
              <Input placeholder="HR" aria-label="Heart rate" type="number" value={vitals.heart_rate ?? ""} onChange={(e) => {
                  // Typed by the clinician: no longer the model's value
                  const sources = { ...vitals.sources };
                  delete sources.heart_rate;
                  setVitals({ ...vitals, heart_rate: num(e.target.value), sources });
                }} />
            </div>
          </div>
          <div>
            <Label>Labs</Label>
            <div className="grid grid-cols-2 gap-2">
              {(
                [
                  ["egfr", "eGFR"],
                  ["potassium", "K⁺"],
                  ["sodium", "Na⁺"],
                  ["uacr", "UACR"],
                ] as const
              ).map(([k, l]) => (
                <Input key={k} placeholder={l} aria-label={l} type="number" step="0.1" value={labs[k] ?? ""} onChange={(e) => setLabs({ ...labs, [k]: num(e.target.value) })} />
              ))}
            </div>
          </div>
          <div>
            <Label>Conditions</Label>
            {groups.map((g) => (
              <div key={g} className="mb-2 flex flex-wrap gap-1.5">
                {CONDITIONS.filter((c) => c.group === g).map((c) => {
                  const on = p.conditions.includes(c.key);
                  return (
                    <button
                      key={c.key}
                      type="button"
                      aria-pressed={on}
                      onClick={() => setP({ ...p, conditions: on ? p.conditions.filter((x) => x !== c.key) : [...p.conditions, c.key] })}
                      className={clsx("rounded-full border px-2.5 py-1 text-xs", on ? "border-brand-600 bg-brand-600 text-white" : "border-slate-300 text-slate-700")}
                    >
                      {c.label}
                    </button>
                  );
                })}
              </div>
            ))}
          </div>
          <label className="block">
            <Label hint="one per line">Current medications</Label>
            <ListInput value={p.current_medications} onChange={(v) => setP({ ...p, current_medications: v })} />
          </label>
          <label className="block">
            <Label hint="one per line">Allergies / intolerances</Label>
            <ListInput value={p.allergies} onChange={(v) => setP({ ...p, allergies: v })} />
          </label>
        </div>
        <div className="flex items-center gap-3 border-t border-slate-200 p-4">
          {err && <span className="text-sm text-red-600">{err}</span>}
          <Button variant="secondary" className="ml-auto" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={save} disabled={busy}>
            {busy && <Loader2 size={14} className="animate-spin" />} {saveLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}
