"use client";

import Link from "next/link";
import { UserCog } from "lucide-react";
import { Badge } from "./ui";
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


export function VisitTable({ rows, showPatient = true }: { rows: VisitRowLite[]; showPatient?: boolean }) {
  if (!rows.length) return <p className="p-10 text-center text-sm text-slate-500">No visits found.</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[640px] text-sm">
        <thead>
          <tr className="border-b border-slate-100 text-left text-xs uppercase tracking-wide text-slate-500">
            <th className="px-5 py-2.5 font-medium">Date</th>
            {showPatient && <th className="px-3 py-2.5 font-medium">Patient</th>}
            <th className="px-3 py-2.5 font-medium">Diagnosis</th>
            <th className="px-3 py-2.5 font-medium">BP</th>
            <th className="px-3 py-2.5 font-medium">Prescribed</th>
            <th className="px-5 py-2.5 font-medium">Status</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {rows.map((v) => {
            const rx = v.prescriptions[0];
            const drug = rx ? rx.medications?.generic_name ?? rx.custom_medication : null;
            return (
              <tr key={v.id} className="group hover:bg-slate-50">
                <td className="whitespace-nowrap px-5 py-3">
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
                <td className="px-5 py-3">
                  <VisitStatus status={v.status} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
