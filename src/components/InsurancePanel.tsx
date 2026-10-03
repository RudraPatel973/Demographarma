"use client";

import { useState } from "react";
import Link from "next/link";
import { FileText, Loader2, Pencil, ShieldCheck } from "lucide-react";
import { Badge, Button, Card, CardHeader, Input } from "./ui";
import { PlanPicker } from "./PlanPicker";
import type { Insurance, Medication, Patient, Prescription } from "@/lib/types";

export type PacketRow = {
  id: string;
  drug_label: string;
  request_type: string;
  status: string;
  plan_name: string | null;
  medication_id?: string | null;
  combination_id?: string | null;
};

/**
 * Always-on insurance card for a visit: the plan on file (add/change it here), the prior-auth packets, and a one-click
 * packet for anything already prescribed — filled from the chart, Settings and what Photon has for the prescription.
 */
export function InsurancePanel({
  encounterId,
  patient,
  packets,
  prescriptions,
  medById,
  onChanged,
}: {
  encounterId: string;
  patient: Patient;
  packets: PacketRow[];
  prescriptions: Prescription[];
  medById: Map<string, Medication>;
  onChanged: () => Promise<unknown>;
}) {
  const ins = patient.insurance;
  const hasPlan = Boolean(ins?.plan_id || ins?.plan_name || ins?.payer);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Insurance>(ins ?? {});
  const [saving, setSaving] = useState(false);
  const [building, setBuilding] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function save() {
    setSaving(true);
    setErr(null);
    const r = await fetch(`/api/patients/${patient.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ insurance: draft }),
    });
    if (r.ok) await fetch(`/api/encounters/${encounterId}/coverage`, { method: "POST" });
    setSaving(false);
    if (!r.ok) return setErr("Could not save the plan");
    setEditing(false);
    await onChanged();
  }

  async function packetFor(rx: Prescription) {
    setBuilding(rx.id);
    setErr(null);
    const r = await fetch(`/api/encounters/${encounterId}/prior-auth`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ prescription_id: rx.id }),
    });
    setBuilding(null);
    const j = await r.json().catch(() => ({}));
    if (!r.ok) return setErr(j.error ?? "Could not prepare the packet");
    window.open(`/prior-auth/${j.id}`, "_blank");
    await onChanged();
  }

  // one row per pill actually sent (a combination tablet is one row)
  const sent = prescriptions.filter((rx) => rx.status !== "canceled" && rx.status !== "error");
  const unpacketed = sent.filter(
    (rx) => !packets.some((p) => (rx.combination_id ? p.combination_id === rx.combination_id : rx.medication_id && p.medication_id === rx.medication_id)),
  );
  const rxLabel = (rx: Prescription) =>
    `${rx.medication_id ? medById.get(rx.medication_id)?.generic_name ?? rx.medication_id : rx.custom_medication ?? "medication"}${rx.dose_mg ? ` ${rx.dose_mg} mg` : ""}`;

  return (
    <Card>
      <CardHeader
        title="Insurance & prior auth"
        right={
          !editing && (
            <Button
              variant="ghost"
              onClick={() => {
                setDraft(ins ?? {});
                setEditing(true);
              }}
            >
              <Pencil size={14} /> {hasPlan ? "Change" : "Add"}
            </Button>
          )
        }
      />
      <div className="space-y-3 p-5 text-sm">
        {editing ? (
          <div className="space-y-2">
            <PlanPicker
              value={draft.plan_id ? { id: draft.plan_id, name: draft.plan_name ?? draft.plan_id } : null}
              said={!draft.plan_id ? draft.plan_name ?? draft.payer ?? null : null}
              onChange={(plan) =>
                setDraft({ ...draft, plan_id: plan?.id ?? null, plan_name: plan?.name ?? null, payer: plan?.payer ?? draft.payer ?? null })
              }
            />
            <div className="grid grid-cols-2 gap-2">
              <Input placeholder="Member ID" aria-label="Member ID" value={draft.member_id ?? ""} onChange={(e) => setDraft({ ...draft, member_id: e.target.value || null })} />
              <Input placeholder="Group #" aria-label="Group number" value={draft.group_number ?? ""} onChange={(e) => setDraft({ ...draft, group_number: e.target.value || null })} />
            </div>
            <div className="flex gap-2">
              <Button onClick={() => void save()} disabled={saving}>
                {saving && <Loader2 size={14} className="animate-spin" />} Save & re-check coverage
              </Button>
              <Button variant="ghost" onClick={() => setEditing(false)} disabled={saving}>
                Cancel
              </Button>
            </div>
          </div>
        ) : hasPlan ? (
          <div className="flex items-start gap-2">
            <ShieldCheck size={16} className="mt-0.5 shrink-0 text-brand-600" />
            <div>
              <p className="font-medium">{ins?.plan_name ?? ins?.payer}</p>
              <p className="text-xs text-slate-500">
                {ins?.member_id ? `Member ID ${ins.member_id}` : "No member ID yet"}
                {ins?.plan_id ? "" : " · plan not matched to a drug list — pick it to check coverage"}
              </p>
            </div>
          </div>
        ) : (
          <p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-amber-800">
            No insurance on file. Add the plan to check coverage and pre-fill prior-auth paperwork.
          </p>
        )}

        {packets.length > 0 && (
          <ul className="-mx-5 divide-y divide-slate-100 border-y border-slate-100">
            {packets.map((pa) => (
              <li key={pa.id}>
                <Link href={`/prior-auth/${pa.id}`} target="_blank" className="flex items-center gap-2 px-5 py-2.5 hover:bg-slate-50">
                  <FileText size={14} className="text-slate-400" />
                  <span className="flex-1 capitalize">
                    {pa.request_type.replace(/_/g, " ")} — {pa.drug_label}
                  </span>
                  <Badge tone={pa.status === "approved" ? "green" : pa.status === "denied" ? "red" : "amber"}>{pa.status}</Badge>
                </Link>
              </li>
            ))}
          </ul>
        )}

        {unpacketed.map((rx) => (
          <Button key={rx.id} variant="secondary" className="w-full justify-start" onClick={() => void packetFor(rx)} disabled={building !== null}>
            {building === rx.id ? <Loader2 size={14} className="animate-spin" /> : <FileText size={14} />}
            Prepare PA packet — <span className="capitalize">{rxLabel(rx)}</span>
          </Button>
        ))}

        <p className="text-xs text-slate-500">
          {sent.length
            ? "Packets are pre-filled from the chart, Settings and the prescription in Photon (sig, quantity, prescriber NPI, pharmacy)."
            : "When a prescription goes out through Photon and the plan restricts the drug, the packet is prepared automatically."}
        </p>
        {err && <p className="text-red-600">{err}</p>}
      </div>
    </Card>
  );
}
