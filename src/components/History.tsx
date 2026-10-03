"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Pencil, Trash2, UserCog } from "lucide-react";
import { Badge, Button } from "./ui";
import { DeleteVisitsDialog, EditVisitDialog, STATUS_OPTIONS } from "./VisitActions";
import { patientName, type Diagnosis, type Vitals } from "@/lib/types";
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

const STATUS_TONE: Record<string, "slate" | "brand" | "green" | "amber"> = {
  in_progress: "slate",
  recommended: "amber",
  med_chosen: "amber",
  prescribed: "brand",
  completed: "green",
};

export function VisitStatus({ status }: { status: string }) {
  const label = STATUS_OPTIONS.find((o) => o.value === status)?.label ?? status;
  return <Badge tone={STATUS_TONE[status] ?? "slate"}>{label}</Badge>;
}

export type VisitRowLite = {
  id: string;
  status: string;
  created_at: string;
  diagnosis_id: string | null;
  diagnosis_notes: string | null;
  vitals: Vitals;
  patients: { id: string; first_name: string | null; last_name: string | null } | null;
  diagnoses: { name: string; icd10: string } | null;
  prescriptions: { status: string; dose_mg: number | null; is_override: boolean; custom_medication: string | null; medications: { generic_name: string } | null }[];
};


/** Visit list with edit / delete per row and bulk delete. */
export function VisitTable({ rows, diagnoses, showPatient = true }: { rows: VisitRowLite[]; diagnoses: Diagnosis[]; showPatient?: boolean }) {
  const router = useRouter();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [editing, setEditing] = useState<VisitRowLite | null>(null);
  const [deleting, setDeleting] = useState<VisitRowLite[] | null>(null);
  // Only rows still on screen count (others were deleted or filtered out)
  const chosen = rows.filter((r) => selected.has(r.id));
  const allOn = rows.length > 0 && chosen.length === rows.length;

  const toggle = (id: string) =>
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  if (!rows.length) return <p className="p-10 text-center text-sm text-slate-500">No visits found.</p>;
  return (
    <div className="overflow-x-auto">
      {chosen.length > 0 && (
        <div className="flex items-center gap-3 border-b border-slate-100 bg-slate-50 px-5 py-2 text-sm" role="toolbar" aria-label="Selected visits">
          <span className="font-medium">{chosen.length} selected</span>
          <Button variant="danger" className="px-2.5 py-1 text-xs" onClick={() => setDeleting(chosen)}>
            <Trash2 size={13} /> Delete
          </Button>
          <button className="text-xs text-slate-500 hover:underline" onClick={() => setSelected(new Set())}>
            Clear
          </button>
        </div>
      )}
      <table className="w-full min-w-[720px] text-sm">
        <thead>
          <tr className="border-b border-slate-100 text-left text-xs uppercase tracking-wide text-slate-500">
            <th className="w-10 py-2.5 pl-5">
              <input
                type="checkbox"
                aria-label="Select all visits"
                checked={allOn}
                onChange={() => setSelected(allOn ? new Set() : new Set(rows.map((r) => r.id)))}
                className="h-4 w-4 accent-brand-600"
              />
            </th>
            <th className="px-3 py-2.5 font-medium">Date</th>
            {showPatient && <th className="px-3 py-2.5 font-medium">Patient</th>}
            <th className="px-3 py-2.5 font-medium">Diagnosis</th>
            <th className="px-3 py-2.5 font-medium">BP</th>
            <th className="px-3 py-2.5 font-medium">Prescribed</th>
            <th className="px-3 py-2.5 font-medium">Status</th>
            <th className="px-5 py-2.5">
              <span className="sr-only">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {rows.map((v) => {
            const rx = v.prescriptions[0];
            const drug = rx ? rx.medications?.generic_name ?? rx.custom_medication : null;
            return (
              <tr key={v.id} className={selected.has(v.id) ? "bg-brand-50/50" : "group hover:bg-slate-50"}>
                <td className="py-3 pl-5">
                  <input type="checkbox" aria-label="Select visit" checked={selected.has(v.id)} onChange={() => toggle(v.id)} className="h-4 w-4 accent-brand-600" />
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
                <td className="whitespace-nowrap px-5 py-3 text-right">
                  <button className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 hover:text-ink" onClick={() => setEditing(v)} aria-label="Edit visit" title="Edit">
                    <Pencil size={15} />
                  </button>
                  <button className="rounded-lg p-1.5 text-slate-500 hover:bg-red-50 hover:text-red-600" onClick={() => setDeleting([v])} aria-label="Delete visit" title="Delete">
                    <Trash2 size={15} />
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {editing && (
        <EditVisitDialog
          visit={editing}
          diagnoses={diagnoses}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            router.refresh();
          }}
        />
      )}
      {deleting && (
        <DeleteVisitsDialog
          visits={deleting}
          onClose={() => setDeleting(null)}
          onDeleted={() => {
            setDeleting(null);
            setSelected(new Set());
            router.refresh();
          }}
        />
      )}
    </div>
  );
}
