"use client";

import clsx from "clsx";
import { CONDITIONS, ETHNICITIES, formatAddress, patientName, type Encounter, type MedicationTrial, type Patient } from "@/lib/types";

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
const OUTCOME: Record<string, { label: string; cls: string }> = {
  ongoing: { label: "taking", cls: "bg-slate-100 text-slate-700" },
  not_at_goal: { label: "didn't control BP", cls: "bg-amber-50 text-amber-800" },
  side_effect: { label: "side effect", cls: "bg-red-50 text-red-700" },
  allergy: { label: "allergy", cls: "bg-red-50 text-red-700" },
  contraindicated: { label: "contraindicated", cls: "bg-red-50 text-red-700" },
  stopped_other: { label: "stopped", cls: "bg-slate-100 text-slate-700" },
};

export function LiveChart({ patient: p, encounter: e, trials = [] }: { patient: Patient; encounter: Encounter; trials?: MedicationTrial[] }) {
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
        <Field
          label="Heart rate"
          value={
            e.vitals.heart_rate ? (
              <>
                {e.vitals.heart_rate} bpm
                {e.vitals.sources?.heart_rate && (
                  <span className="ml-1.5 rounded-full bg-sky-50 px-1.5 py-0.5 text-[10px] font-medium text-sky-700" title="Camera estimate from the check-in. Edit the chart to replace it.">
                    camera · {e.vitals.sources.heart_rate.model_name}
                  </span>
                )}
              </>
            ) : null
          }
        />
        <Field label="eGFR" value={e.labs.egfr ?? null} />
        <Field label="Potassium" value={e.labs.potassium ?? null} />
        {p.sex !== "MALE" && <Field label="Pregnancy" value={p.pregnancy_status !== "not_applicable" ? p.pregnancy_status.replace(/_/g, " ") : null} wide />}
        <Field label="Phone" value={p.phone} wide />
        <Field label="Address" value={formatAddress(p.address)} wide />
        <Field
          label="Insurance"
          value={
            p.insurance && (p.insurance.plan_name || p.insurance.payer)
              ? `${p.insurance.plan_name ?? p.insurance.payer}${p.insurance.member_id ? ` · ID ${p.insurance.member_id}` : ""}${p.insurance.plan_id ? "" : " (plan not linked)"}`
              : null
          }
          wide
        />
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
      {trials.length > 0 && (
        <div>
          <p className="mb-1 text-[11px] uppercase tracking-wide text-slate-400">BP medicines tried</p>
          <ul className="space-y-1">
            {trials.map((t) => (
              <li key={t.id} className="flex flex-wrap items-center gap-1.5 text-sm">
                <span className="capitalize">{t.drug_name}</span>
                <span className={clsx("rounded-full px-2 py-0.5 text-[11px]", OUTCOME[t.outcome]?.cls)}>{OUTCOME[t.outcome]?.label ?? t.outcome}</span>
                {t.detail && <span className="text-xs text-slate-500">{t.detail}</span>}
              </li>
            ))}
          </ul>
        </div>
      )}
      {e.live_state?.notes && (
        <div>
          <p className="mb-1 text-[11px] uppercase tracking-wide text-slate-400">Noted in conversation</p>
          <p className="text-sm text-slate-700">{e.live_state.notes}</p>
        </div>
      )}
    </div>
  );
}
