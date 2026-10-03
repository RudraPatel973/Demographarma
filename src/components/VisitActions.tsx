"use client";

import { useState } from "react";
import { Loader2, X } from "lucide-react";
import { Button, Input, Label, Select, Textarea } from "./ui";
import { patientName, type Diagnosis, type Vitals } from "@/lib/types";

export type EditableVisit = {
  id: string;
  status: string;
  created_at: string;
  diagnosis_id: string | null;
  diagnosis_notes: string | null;
  vitals: Vitals;
  patients: { first_name: string | null; last_name: string | null } | null;
};

const num = (v: string) => (v.trim() === "" ? null : Number(v));
const when = (iso: string) => new Date(iso).toLocaleString([], { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });

/** Slide-over to correct a visit's status, diagnosis, vitals and notes from the visit list. */
export function EditVisitDialog({
  visit,
  diagnoses,
  statuses,
  onClose,
  onSaved,
}: {
  visit: EditableVisit;
  diagnoses: Diagnosis[];
  statuses: { value: string; label: string }[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [status, setStatus] = useState(visit.status);
  const [diagnosisId, setDiagnosisId] = useState(visit.diagnosis_id ?? "");
  const [notes, setNotes] = useState(visit.diagnosis_notes ?? "");
  const [sbp, setSbp] = useState(visit.vitals?.bp_systolic?.toString() ?? "");
  const [dbp, setDbp] = useState(visit.vitals?.bp_diastolic?.toString() ?? "");
  const [hr, setHr] = useState(visit.vitals?.heart_rate?.toString() ?? "");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function save() {
    setBusy(true);
    setErr(null);
    const heart = num(hr);
    const vitals: Vitals = { ...visit.vitals, bp_systolic: num(sbp), bp_diastolic: num(dbp), heart_rate: heart };
    // A heart rate typed here is the clinician's, not the camera's
    if (heart !== (visit.vitals?.heart_rate ?? null) && vitals.sources?.heart_rate) {
      vitals.sources = { ...vitals.sources };
      delete vitals.sources.heart_rate;
    }
    try {
      const r = await fetch(`/api/encounters/${visit.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ status, diagnosis_id: diagnosisId || null, diagnosis_notes: notes.trim() || null, vitals }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? "Could not save");
      onSaved();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  }

  const name = visit.patients ? patientName(visit.patients) : "Unnamed patient";
  return (
    <div className="fixed inset-0 z-40 flex justify-end bg-slate-900/30" onClick={onClose}>
      <div className="flex h-full w-full max-w-md flex-col bg-white shadow-xl" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Edit visit">
        <div className="flex items-center border-b border-slate-200 px-5 py-4">
          <div>
            <h2 className="font-semibold">Edit visit</h2>
            <p className="text-xs text-slate-500">
              {name} · {when(visit.created_at)}
            </p>
          </div>
          <button className="ml-auto" onClick={onClose} aria-label="Close">
            <X size={18} />
          </button>
        </div>
        <div className="flex-1 space-y-4 overflow-y-auto p-5">
          <label className="block">
            <Label>Status</Label>
            <Select value={status} onChange={(e) => setStatus(e.target.value)}>
              {statuses.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </Select>
          </label>
          <label className="block">
            <Label>Diagnosis</Label>
            <Select value={diagnosisId} onChange={(e) => setDiagnosisId(e.target.value)}>
              <option value="">—</option>
              {diagnoses.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.icd10} · {d.name}
                </option>
              ))}
            </Select>
          </label>
          <div>
            <Label>Vitals</Label>
            <div className="grid grid-cols-3 gap-2">
              <Input placeholder="SBP" aria-label="Systolic" type="number" value={sbp} onChange={(e) => setSbp(e.target.value)} />
              <Input placeholder="DBP" aria-label="Diastolic" type="number" value={dbp} onChange={(e) => setDbp(e.target.value)} />
              <Input placeholder="HR" aria-label="Heart rate" type="number" value={hr} onChange={(e) => setHr(e.target.value)} />
            </div>
          </div>
          <label className="block">
            <Label>Clinician notes</Label>
            <Textarea rows={4} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </label>
          {(diagnosisId !== (visit.diagnosis_id ?? "") || sbp !== (visit.vitals?.bp_systolic?.toString() ?? "") || dbp !== (visit.vitals?.bp_diastolic?.toString() ?? "") || hr !== (visit.vitals?.heart_rate?.toString() ?? "")) && (
            <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900">
              Existing recommendations aren&apos;t re-ranked from here. Open the visit and edit the chart there to regenerate them.
            </p>
          )}
        </div>
        <div className="flex items-center gap-3 border-t border-slate-200 p-4">
          {err && <span className="text-sm text-red-600">{err}</span>}
          <Button variant="secondary" className="ml-auto" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={save} disabled={busy}>
            {busy && <Loader2 size={14} className="animate-spin" />} Save
          </Button>
        </div>
      </div>
    </div>
  );
}
