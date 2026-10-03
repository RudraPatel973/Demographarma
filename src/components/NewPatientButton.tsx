"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Mic, UserPlus, X } from "lucide-react";
import { Button, Input, Label, Select } from "./ui";
import type { Address, Patient } from "@/lib/types";

type Draft = { first_name: string; last_name: string; date_of_birth: string; sex: "" | Patient["sex"]; phone: string; email: string; address: Address };
const EMPTY: Draft = { first_name: "", last_name: "", date_of_birth: "", sex: "", phone: "", email: "", address: {} };

/** Register a patient before their first visit; anything left blank is picked up from the visit audio. */
export function NewPatientButton() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [d, setD] = useState<Draft>(EMPTY);
  const [busy, setBusy] = useState<"save" | "visit" | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const close = () => {
    setOpen(false);
    setD(EMPTY);
    setErr(null);
  };
  const addr = (k: keyof Address, v: string) => setD({ ...d, address: { ...d.address, [k]: v || null } });

  async function submit(then: "save" | "visit") {
    if (!d.first_name.trim() || !d.last_name.trim()) return setErr("First and last name are required.");
    setBusy(then);
    setErr(null);
    const r = await fetch("/api/patients", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        ...d,
        sex: d.sex || null,
        date_of_birth: d.date_of_birth || null,
        address: d.address.street1 ? d.address : null,
      }),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) {
      setBusy(null);
      return setErr(j.error ?? "Could not create the patient");
    }
    if (then === "visit") {
      const v = await fetch("/api/encounters", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ patient_id: j.id }) });
      const vj = await v.json().catch(() => ({}));
      if (v.ok) return router.push(`/visits/${vj.id}?autostart=1`);
    }
    router.push(`/patients/${j.id}`);
  }

  return (
    <>
      <Button onClick={() => setOpen(true)}>
        <UserPlus size={16} /> New patient
      </Button>
      {open && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-slate-900/40 p-4" onClick={close}>
          <form
            role="dialog"
            aria-modal="true"
            aria-labelledby="new-patient-title"
            className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-xl bg-white shadow-xl"
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => e.key === "Escape" && close()}
            onSubmit={(e) => {
              e.preventDefault();
              void submit("save");
            }}
          >
            <div className="flex items-center border-b border-slate-100 px-5 py-4">
              <h2 id="new-patient-title" className="font-semibold">
                New patient
              </h2>
              <button type="button" aria-label="Close" onClick={close} className="ml-auto rounded-md p-1 text-slate-400 hover:bg-slate-100">
                <X size={18} />
              </button>
            </div>
            <div className="grid gap-3 p-5 sm:grid-cols-2">
              <label>
                <Label>First name</Label>
                <Input autoFocus required value={d.first_name} onChange={(e) => setD({ ...d, first_name: e.target.value })} />
              </label>
              <label>
                <Label>Last name</Label>
                <Input required value={d.last_name} onChange={(e) => setD({ ...d, last_name: e.target.value })} />
              </label>
              <label>
                <Label>Date of birth</Label>
                <Input type="date" value={d.date_of_birth} onChange={(e) => setD({ ...d, date_of_birth: e.target.value })} />
              </label>
              <label>
                <Label>Sex</Label>
                <Select value={d.sex ?? ""} onChange={(e) => setD({ ...d, sex: e.target.value as Draft["sex"] })}>
                  <option value="">—</option>
                  <option value="FEMALE">Female</option>
                  <option value="MALE">Male</option>
                  <option value="UNKNOWN">Other / unknown</option>
                </Select>
              </label>
              <label>
                <Label hint="texts go here">Mobile phone</Label>
                <Input type="tel" value={d.phone} onChange={(e) => setD({ ...d, phone: e.target.value })} placeholder="(212) 555-0142" />
              </label>
              <label>
                <Label>Email</Label>
                <Input type="email" value={d.email} onChange={(e) => setD({ ...d, email: e.target.value })} />
              </label>
              <label className="sm:col-span-2">
                <Label hint="ZIP is looked up for you">Street address</Label>
                <Input value={d.address.street1 ?? ""} onChange={(e) => addr("street1", e.target.value)} placeholder="560 W 163rd St" />
              </label>
              <label>
                <Label>Apt / unit</Label>
                <Input value={d.address.street2 ?? ""} onChange={(e) => addr("street2", e.target.value)} />
              </label>
              <label>
                <Label>City</Label>
                <Input value={d.address.city ?? ""} onChange={(e) => addr("city", e.target.value)} />
              </label>
              <label>
                <Label>State</Label>
                <Input maxLength={2} value={d.address.state ?? ""} onChange={(e) => addr("state", e.target.value.toUpperCase())} placeholder="NY" />
              </label>
              <label>
                <Label>ZIP</Label>
                <Input inputMode="numeric" value={d.address.postalCode ?? ""} onChange={(e) => addr("postalCode", e.target.value)} />
              </label>
              <p className="text-xs text-slate-500 sm:col-span-2">Only the name is required — anything else can be said during the visit and is filled in automatically.</p>
              {err && <p className="text-sm text-red-600 sm:col-span-2">{err}</p>}
            </div>
            <div className="flex flex-wrap justify-end gap-2 border-t border-slate-100 px-5 py-3">
              <Button type="button" variant="ghost" onClick={close} disabled={busy !== null}>
                Cancel
              </Button>
              <Button type="submit" variant="secondary" disabled={busy !== null}>
                {busy === "save" && <Loader2 size={14} className="animate-spin" />} Save patient
              </Button>
              <Button type="button" onClick={() => void submit("visit")} disabled={busy !== null}>
                {busy === "visit" ? <Loader2 size={14} className="animate-spin" /> : <Mic size={14} />} Save & start visit
              </Button>
            </div>
          </form>
        </div>
      )}
    </>
  );
}
