"use client";

import clsx from "clsx";
import { CONDITIONS, ETHNICITIES, patientName, type Encounter, type Patient } from "@/lib/types";

function age(dob: string | null) {
  if (!dob) return null;
  const d = new Date(dob);
  const n = new Date();
  let a = n.getFullYear() - d.getFullYear();
  if (n.getMonth() < d.getMonth() || (n.getMonth() === d.getMonth() && n.getDate() < d.getDate())) a--;
  return a;
}

function Field({ label, value, wide }: { label: string; value: React.ReactNode; wide?: boolean }) {
  const empty = value === null || value === undefined || value === "";
  return (
    <div className={clsx(wide && "col-span-2")}>
      <dt className="text-[11px] uppercase tracking-wide text-slate-400">{label}</dt>
      <dd className={clsx("text-sm transition-colors duration-500", empty ? "text-slate-300" : "font-medium text-ink")}>{empty ? "—" : value}</dd>
    </div>
  );
}

function Chips({ items, tone }: { items: string[]; tone: "brand" | "amber" | "red" }) {
  if (!items.length) return <p className="text-sm text-slate-300">—</p>;
  return (
    <div className="flex flex-wrap gap-1">
      {items.map((x) => (
        <span
          key={x}
          className={clsx(
            "rounded-full px-2 py-0.5 text-xs",
            tone === "brand" && "bg-brand-50 text-brand-700",
            tone === "amber" && "bg-amber-50 text-amber-800",
            tone === "red" && "bg-red-50 text-red-700",
          )}
        >
          {x}
        </span>
      ))}
    </div>
  );
}

/** Read-only chart that fills itself in from the visit audio. */
export function LiveChart({ patient: p, encounter: e }: { patient: Patient; encounter: Encounter }) {
  const a = age(p.date_of_birth);
  const bmi = p.height_cm && p.weight_kg ? (p.weight_kg / (p.height_cm / 100) ** 2).toFixed(1) : null;
  const conditions = p.conditions.map((k) => CONDITIONS.find((c) => c.key === k)?.label ?? k);
  const bp = e.vitals.bp_systolic ? `${e.vitals.bp_systolic}/${e.vitals.bp_diastolic ?? "?"}` : null;
  return (
    <div className="space-y-4">
      <dl className="grid grid-cols-2 gap-x-4 gap-y-3">
        <Field label="Name" value={p.first_name || p.last_name ? patientName(p) : null} wide />
        <Field label="Age" value={a !== null ? `${a}${p.dob_is_estimate ? " (approx.)" : ""}` : null} />
        <Field label="Sex" value={p.sex ? p.sex.toLowerCase() : null} />
        <Field label="Ethnicity" value={ETHNICITIES.find((x) => x.key === p.ethnicity)?.label ?? null} wide />
        <Field label="Height" value={p.height_cm ? `${Math.round(p.height_cm)} cm` : null} />
        <Field label="Weight" value={p.weight_kg ? `${Math.round(p.weight_kg)} kg${bmi ? ` · BMI ${bmi}` : ""}` : null} />
        <Field label="Blood pressure" value={bp} />
        <Field label="Heart rate" value={e.vitals.heart_rate ? `${e.vitals.heart_rate} bpm` : null} />
        <Field label="eGFR" value={e.labs.egfr ?? null} />
        <Field label="Potassium" value={e.labs.potassium ?? null} />
        {p.sex !== "MALE" && <Field label="Pregnancy" value={p.pregnancy_status !== "not_applicable" ? p.pregnancy_status.replace(/_/g, " ") : null} wide />}
        <Field label="Phone" value={p.phone} wide />
      </dl>
      <div>
        <p className="mb-1 text-[11px] uppercase tracking-wide text-slate-400">Conditions</p>
        <Chips items={conditions} tone="brand" />
      </div>
      <div>
        <p className="mb-1 text-[11px] uppercase tracking-wide text-slate-400">Current medications</p>
        <Chips items={p.current_medications} tone="amber" />
      </div>
      <div>
        <p className="mb-1 text-[11px] uppercase tracking-wide text-slate-400">Allergies / intolerances</p>
        <Chips items={p.allergies} tone="red" />
      </div>
      {e.live_state?.notes && (
        <div>
          <p className="mb-1 text-[11px] uppercase tracking-wide text-slate-400">Noted in conversation</p>
          <p className="text-sm text-slate-700">{e.live_state.notes}</p>
        </div>
      )}
    </div>
  );
}
