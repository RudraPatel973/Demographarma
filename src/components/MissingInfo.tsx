"use client";

import { useState } from "react";
import { AlertCircle, CheckCircle2, Loader2 } from "lucide-react";
import { Button, Input, Select } from "./ui";
import { REQUIRED_LABELS, type RequiredKey } from "@/lib/requirements";
import type { Encounter, Patient } from "@/lib/types";

/**
 * Shown when the doctor ends the visit (or says the diagnosis) but the chart is incomplete.
 * Items tick off live as they're said out loud; the doctor can also type them here.
 */
export function MissingInfo({
  missing,
  recommended,
  patient,
  encounter,
  listening,
  onPatient,
  onEncounter,
  onCancel,
}: {
  missing: RequiredKey[];
  recommended: string[];
  patient: Patient;
  encounter: Encounter;
  listening: boolean;
  onPatient: (p: Patient) => void;
  onEncounter: (e: Partial<Encounter>) => void;
  onCancel: () => void;
}) {
  const [f, setF] = useState({
    first_name: "",
    last_name: "",
    date_of_birth: "",
    sex: "",
    phone: "",
    ft: "",
    inch: "",
    lb: "",
    sbp: "",
    dbp: "",
    pregnancy_status: "",
    street1: patient.address?.street1 ?? "",
    street2: patient.address?.street2 ?? "",
    city: patient.address?.city ?? "",
    state: patient.address?.state ?? "",
    postalCode: patient.address?.postalCode ?? "",
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });

  async function save() {
    setBusy(true);
    setErr(null);
    try {
      const pu: Record<string, unknown> = {};
      if (f.first_name.trim()) pu.first_name = f.first_name.trim();
      if (f.last_name.trim()) pu.last_name = f.last_name.trim();
      if (f.date_of_birth) Object.assign(pu, { date_of_birth: f.date_of_birth, dob_is_estimate: false });
      if (f.sex) pu.sex = f.sex;
      if (f.phone.trim()) pu.phone = f.phone.trim();
      if (f.ft) pu.height_cm = Math.round((Number(f.ft) * 12 + Number(f.inch || 0)) * 2.54 * 10) / 10;
      if (f.lb) pu.weight_kg = Math.round(Number(f.lb) * 0.45359237 * 10) / 10;
      if (f.pregnancy_status) pu.pregnancy_status = f.pregnancy_status;
      if (missing.includes("address") && (f.street1 || f.city || f.state || f.postalCode)) {
        pu.address = {
          ...(patient.address ?? {}),
          street1: f.street1.trim(),
          street2: f.street2.trim() || null,
          city: f.city.trim(),
          state: f.state.trim().toUpperCase().slice(0, 2),
          postalCode: f.postalCode.trim(),
        };
      }
      if (Object.keys(pu).length) {
        const r = await fetch(`/api/patients/${patient.id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(pu) });
        if (!r.ok) throw new Error("Could not save");
        onPatient(await r.json());
      }
      if (f.sbp && f.dbp) {
        const vitals = { ...encounter.vitals, bp_systolic: Number(f.sbp), bp_diastolic: Number(f.dbp) };
        const r = await fetch(`/api/encounters/${encounter.id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ vitals }) });
        if (!r.ok) throw new Error("Could not save");
        onEncounter({ vitals });
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const has = (k: RequiredKey) => missing.includes(k);

  return (
    <div className="mb-4 rounded-xl border border-amber-300 bg-amber-50 p-4" role="alert">
      <div className="flex flex-wrap items-start gap-3">
        <AlertCircle size={18} className="mt-0.5 shrink-0 text-amber-700" />
        <div className="min-w-0 flex-1">
          <p className="font-medium text-amber-950">Key information missing before recommendations can be made</p>
          <p className="text-sm text-amber-900">
            {listening ? "Still listening — ask the patient and these will fill in automatically, or type them below." : "Type them below, or resume recording and ask the patient."}{" "}
            Recommendations start as soon as everything is in.
          </p>
        </div>
        <Button variant="ghost" onClick={onCancel}>
          Not now
        </Button>
      </div>

      <div className="mt-3 flex flex-wrap gap-1.5">
        {missing.map((k) => (
          <span key={k} className="rounded-full bg-white px-2.5 py-1 text-xs font-medium text-amber-900 ring-1 ring-amber-300">
            {REQUIRED_LABELS[k]}
          </span>
        ))}
        {recommended.map((k) => (
          <span key={k} className="rounded-full px-2.5 py-1 text-xs text-amber-800 ring-1 ring-dashed ring-amber-300" title="Recommended, not required">
            {k} (recommended)
          </span>
        ))}
      </div>

      <form
        className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        {has("first_name") && <Input aria-label="First name" placeholder="First name" value={f.first_name} onChange={set("first_name")} />}
        {has("last_name") && <Input aria-label="Last name" placeholder="Last name" value={f.last_name} onChange={set("last_name")} />}
        {has("date_of_birth") && <Input aria-label="Date of birth" type="date" value={f.date_of_birth} onChange={set("date_of_birth")} />}
        {has("sex") && (
          <Select aria-label="Sex" value={f.sex} onChange={set("sex")}>
            <option value="">Sex…</option>
            <option value="FEMALE">Female</option>
            <option value="MALE">Male</option>
          </Select>
        )}
        {has("phone") && <Input aria-label="Mobile number" type="tel" placeholder="Mobile number" value={f.phone} onChange={set("phone")} />}
        {has("address") && (
          <div className="grid grid-cols-6 gap-2 sm:col-span-2 lg:col-span-4">
            <Input className="col-span-6 sm:col-span-2" aria-label="Street address" placeholder="Street address" value={f.street1} onChange={set("street1")} />
            <Input className="col-span-2 sm:col-span-1" aria-label="Apartment or unit" placeholder="Apt" value={f.street2} onChange={set("street2")} />
            <Input className="col-span-4 sm:col-span-1" aria-label="City" placeholder="City" value={f.city} onChange={set("city")} />
            <Input className="col-span-2 sm:col-span-1" aria-label="State" placeholder="State" maxLength={2} value={f.state} onChange={set("state")} />
            <Input className="col-span-4 sm:col-span-1" aria-label="ZIP code" placeholder="ZIP" inputMode="numeric" value={f.postalCode} onChange={set("postalCode")} />
          </div>
        )}
        {has("height_cm") && (
          <div className="flex gap-2">
            <Input aria-label="Height feet" type="number" placeholder="ft" value={f.ft} onChange={set("ft")} />
            <Input aria-label="Height inches" type="number" placeholder="in" value={f.inch} onChange={set("inch")} />
          </div>
        )}
        {has("weight_kg") && <Input aria-label="Weight in pounds" type="number" placeholder="Weight (lb)" value={f.lb} onChange={set("lb")} />}
        {has("blood_pressure") && (
          <div className="flex gap-2">
            <Input aria-label="Systolic" type="number" placeholder="SBP" value={f.sbp} onChange={set("sbp")} />
            <Input aria-label="Diastolic" type="number" placeholder="DBP" value={f.dbp} onChange={set("dbp")} />
          </div>
        )}
        {has("pregnancy_status") && (
          <Select aria-label="Pregnancy status" value={f.pregnancy_status} onChange={set("pregnancy_status")}>
            <option value="">Pregnancy status…</option>
            <option value="not_pregnant">Not pregnant</option>
            <option value="childbearing_potential">Could become pregnant</option>
            <option value="pregnant">Pregnant</option>
            <option value="breastfeeding">Breastfeeding</option>
          </Select>
        )}
        <div className="flex items-center gap-2 sm:col-span-2 lg:col-span-4">
          <Button type="submit" disabled={busy}>
            {busy ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />} Save
          </Button>
          {err && <span className="text-sm text-red-600">{err}</span>}
        </div>
      </form>
    </div>
  );
}
