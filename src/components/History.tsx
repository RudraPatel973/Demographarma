"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Loader2, Trash2, UserCog } from "lucide-react";
import { Badge, Button } from "./ui";
import { patientName } from "@/lib/types";
import { visitHref } from "@/lib/visits";

/** Formats in the viewer's timezone (server components would use the server's). */
export function LocalTime({ iso, mode = "datetime" }: { iso: string; mode?: "datetime" | "date" | "time" }) {
  const d = new Date(iso);
  const text =
    mode === "date"
      ? d.toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" })
      : mode === "time"
        ? d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
        : d.toLocaleString([], { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });
  return (
    <time dateTime={iso} suppressHydrationWarning>
      {text}
    </time>
  );
}

const VISIT_STATUS: Record<string, { label: string; tone: "slate" | "brand" | "green" | "amber" }> = {
  in_progress: { label: "In progress", tone: "slate" },
  recommended: { label: "Awaiting choice", tone: "amber" },
  med_chosen: { label: "Awaiting Photon", tone: "amber" },
  prescribed: { label: "Prescribed", tone: "brand" },
  completed: { label: "Completed", tone: "green" },
};

export function VisitStatus({ status }: { status: string }) {
  const s = VISIT_STATUS[status] ?? { label: status, tone: "slate" as const };
  return <Badge tone={s.tone}>{s.label}</Badge>;
}

export type VisitRowLite = {
  id: string;
  status: string;
  created_at: string;
  vitals: { bp_systolic?: number | null; bp_diastolic?: number | null };
  patients: { id: string; first_name: string | null; last_name: string | null } | null;
  diagnoses: { name: string; icd10: string } | null;
  prescriptions: { dose_mg: number | null; is_override: boolean; custom_medication: string | null; medications: { generic_name: string } | null }[];
};


/** Abandoned intakes: nothing was captured, so nothing is lost by removing them. */
function isEmptyVisit(v: VisitRowLite) {
  return !v.diagnoses && !v.prescriptions.length && !v.vitals?.bp_systolic && !v.patients?.first_name && !v.patients?.last_name;
}

export function VisitTable({ rows, showPatient = true }: { rows: VisitRowLite[]; showPatient?: boolean }) {
  const router = useRouter();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  if (!rows.length) return <p className="p-10 text-center text-sm text-slate-500">No visits found.</p>;

  const ids = rows.map((r) => r.id);
  const picked = ids.filter((id) => selected.has(id));
  const empties = rows.filter(isEmptyVisit).map((r) => r.id);
  const allPicked = picked.length === ids.length;
  const pickedPrescribed = rows.filter((r) => selected.has(r.id) && r.prescriptions.length).length;

  const choose = (next: Iterable<string>) => {
    setSelected(new Set(next));
    setConfirming(false);
    setErr(null);
  };
  const toggle = (id: string) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    choose(next);
  };

  async function remove() {
    setBusy(true);
    setErr(null);
    const r = await fetch("/api/encounters", { method: "DELETE", headers: { "content-type": "application/json" }, body: JSON.stringify({ ids: picked }) });
    setBusy(false);
    if (!r.ok) return setErr((await r.json().catch(() => ({}))).error ?? "Could not remove visits");
    choose([]);
    router.refresh();
  }

  return (
    <div>
      <div className="flex min-h-12 flex-wrap items-center gap-2 border-b border-slate-100 px-4 py-2 text-sm">
        {picked.length === 0 ? (
          <>
            <span className="text-slate-500">Tick visits to remove them, or use the bin on a row.</span>
            {empties.length > 0 && (
              <Button variant="ghost" className="ml-auto py-1.5" onClick={() => choose(empties)}>
                Select {empties.length} empty visit{empties.length === 1 ? "" : "s"}
              </Button>
            )}
          </>
        ) : confirming ? (
          <>
            <span className="font-medium text-red-700">
              Remove {picked.length} visit{picked.length === 1 ? "" : "s"}? This can&apos;t be undone.
            </span>
            {pickedPrescribed > 0 && (
              <span className="text-xs text-amber-700">
                {pickedPrescribed} had a prescription — removing the visit doesn&apos;t cancel anything already sent to the pharmacy.
              </span>
            )}
            <div className="ml-auto flex gap-2">
              <Button variant="secondary" className="py-1.5" onClick={() => setConfirming(false)} disabled={busy}>
                Keep
              </Button>
              <Button variant="danger" className="py-1.5" onClick={() => void remove()} disabled={busy}>
                {busy ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />} Remove
              </Button>
            </div>
          </>
        ) : (
          <>
            <span className="font-medium">{picked.length} selected</span>
            <Button variant="ghost" className="py-1.5" onClick={() => choose([])}>
              Clear
            </Button>
            <Button variant="danger" className="ml-auto py-1.5" onClick={() => setConfirming(true)}>
              <Trash2 size={14} /> Remove {picked.length}
            </Button>
          </>
        )}
        {err && <span className="w-full text-red-600">{err}</span>}
      </div>
      <div className="overflow-x-auto">
      <table className="w-full min-w-[640px] text-sm">
        <thead>
          <tr className="border-b border-slate-100 text-left text-xs uppercase tracking-wide text-slate-500">
            <th className="w-10 py-2.5 pl-5">
              <input
                type="checkbox"
                aria-label="Select all visits"
                checked={allPicked}
                ref={(el) => {
                  if (el) el.indeterminate = picked.length > 0 && !allPicked;
                }}
                onChange={() => choose(allPicked ? [] : ids)}
                className="h-4 w-4 accent-brand-600"
              />
            </th>
            <th className="px-3 py-2.5 font-medium">Date</th>
            {showPatient && <th className="px-3 py-2.5 font-medium">Patient</th>}
            <th className="px-3 py-2.5 font-medium">Diagnosis</th>
            <th className="px-3 py-2.5 font-medium">BP</th>
            <th className="px-3 py-2.5 font-medium">Prescribed</th>
            <th className="px-3 py-2.5 font-medium">Status</th>
            <th className="w-12 pr-4" aria-label="Remove" />
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {rows.map((v) => {
            const rx = v.prescriptions[0];
            const drug = rx ? rx.medications?.generic_name ?? rx.custom_medication : null;
            return (
              <tr key={v.id} className={selected.has(v.id) ? "group bg-brand-50" : "group hover:bg-slate-50"}>
                <td className="py-3 pl-5">
                  <input
                    type="checkbox"
                    aria-label="Select visit"
                    checked={selected.has(v.id)}
                    onChange={() => toggle(v.id)}
                    className="h-4 w-4 accent-brand-600"
                  />
                </td>
                <td className="whitespace-nowrap px-3 py-3">
                  <Link href={visitHref(v)} className="font-medium text-ink group-hover:underline">
                    <LocalTime iso={v.created_at} />
                  </Link>
                </td>
                {showPatient && (
                  <td className="px-3 py-3">
                    {v.patients ? (
                      <Link href={`/patients/${v.patients.id}`} className="hover:underline">
                        {patientName(v.patients)}
                      </Link>
                    ) : (
                      "—"
                    )}
                  </td>
                )}
                <td className="px-3 py-3 text-slate-700">{v.diagnoses ? `${v.diagnoses.icd10} · ${v.diagnoses.name}` : <span className="text-slate-400">—</span>}</td>
                <td className="whitespace-nowrap px-3 py-3 tabular-nums text-slate-700">
                  {v.vitals?.bp_systolic ? `${v.vitals.bp_systolic}/${v.vitals.bp_diastolic ?? "?"}` : <span className="text-slate-400">—</span>}
                </td>
                <td className="px-3 py-3">
                  {drug ? (
                    <span className="flex flex-wrap items-center gap-1.5 capitalize">
                      {drug}
                      {rx.dose_mg ? ` ${rx.dose_mg} mg` : ""}
                      {v.prescriptions.length > 1 && <span className="text-xs text-slate-500">+{v.prescriptions.length - 1} more</span>}
                      {rx.is_override && (
                        <span title="Doctor override" className="text-amber-700">
                          <UserCog size={13} />
                        </span>
                      )}
                    </span>
                  ) : (
                    <span className="text-slate-400">—</span>
                  )}
                </td>
                <td className="px-3 py-3">
                  <VisitStatus status={v.status} />
                </td>
                <td className="pr-4 text-right">
                  <button
                    type="button"
                    title="Remove visit"
                    aria-label="Remove visit"
                    onClick={() => {
                      choose([v.id]);
                      setConfirming(true);
                    }}
                    className="rounded-md p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600 sm:opacity-0 sm:group-hover:opacity-100 sm:focus:opacity-100"
                  >
                    <Trash2 size={15} />
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      </div>
    </div>
  );
}
