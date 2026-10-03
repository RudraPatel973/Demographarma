"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, Loader2 } from "lucide-react";
import { Button, Input, Label } from "./ui";

type Trial = { trial_id?: string; drug: string; start: string | null };

/** Inline fields for whatever the packet still needs; saves, then rebuilds the form and letter. */
export function CompletePacket({
  id, missing, trials, needMember, needAdherence,
}: {
  id: string;
  missing: string[];
  trials: Trial[];
  needMember: boolean;
  needAdherence: boolean;
}) {
  const router = useRouter();
  const needs = (k: string) => missing.some((m) => m.startsWith(k));
  const [clinic, setClinic] = useState({ npi: "", fax: "", address: "" });
  const [dates, setDates] = useState<Record<string, string>>({});
  const [adherence, setAdherence] = useState("");
  const [member, setMember] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const undated = trials.filter((t) => !t.start && t.trial_id);

  async function submit() {
    setBusy(true);
    setErr(null);
    const r = await fetch(`/api/prior-auth/${id}/complete`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        clinic,
        trials: Object.entries(dates).map(([trial_id, started_when]) => ({ trial_id, started_when })),
        adherence,
        member_id: member,
      }),
    });
    setBusy(false);
    if (!r.ok) return setErr((await r.json()).error ?? "Could not complete the packet");
    router.refresh();
  }

  return (
    <div className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm print:hidden">
      <p className="font-medium text-amber-950">Complete the packet</p>
      <p className="mb-3 text-amber-900">Fill these in and the form and letter are rebuilt. Practice details are saved for every future packet.</p>
      <div className="grid gap-3 sm:grid-cols-2">
        {needs("Prescriber NPI") && (
          <label>
            <Label>Prescriber NPI</Label>
            <Input inputMode="numeric" maxLength={10} placeholder="10 digits" value={clinic.npi} onChange={(e) => setClinic({ ...clinic, npi: e.target.value.replace(/\D/g, "") })} />
          </label>
        )}
        {needs("Practice fax") && (
          <label>
            <Label>Practice fax</Label>
            <Input value={clinic.fax} onChange={(e) => setClinic({ ...clinic, fax: e.target.value })} />
          </label>
        )}
        {needs("Practice address") && (
          <label className="sm:col-span-2">
            <Label>Practice address</Label>
            <Input value={clinic.address} placeholder="123 Main St, Suite 200, New York, NY 10001" onChange={(e) => setClinic({ ...clinic, address: e.target.value })} />
          </label>
        )}
        {needMember && (
          <label>
            <Label>Member ID</Label>
            <Input value={member} onChange={(e) => setMember(e.target.value)} />
          </label>
        )}
        {needAdherence && (
          <label className="sm:col-span-2">
            <Label>Adherence</Label>
            <Input value={adherence} placeholder="e.g. Takes all doses daily, uses a pill organizer" onChange={(e) => setAdherence(e.target.value)} />
          </label>
        )}
        {undated.map((t) => (
          <label key={t.trial_id}>
            <Label hint="e.g. 2 years ago, 2023, March 2024">When was {t.drug} started?</Label>
            <Input value={dates[t.trial_id!] ?? ""} onChange={(e) => setDates({ ...dates, [t.trial_id!]: e.target.value })} />
          </label>
        ))}
      </div>
      <div className="mt-3 flex items-center gap-3">
        <Button onClick={submit} disabled={busy}>
          {busy ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />} Complete packet
        </Button>
        {busy && <span className="text-xs text-amber-900">Rebuilding the form and letter…</span>}
        {err && <span className="text-xs text-red-600">{err}</span>}
      </div>
    </div>
  );
}
