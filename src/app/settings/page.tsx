"use client";

import { useEffect, useState } from "react";
import { CheckCircle2, Loader2 } from "lucide-react";
import { Button, Card, CardHeader, Input, Label, Select } from "@/components/ui";

type Profile = {
  practice_name: string;
  prescriber_name: string;
  credentials: string;
  npi: string;
  phone: string;
  fax: string;
  email: string;
  address: string;
  from_photon?: string[];
};

const FIELDS: { key: keyof Profile; label: string; hint?: string; placeholder?: string }[] = [
  { key: "practice_name", label: "Practice name" },
  { key: "prescriber_name", label: "Prescriber name" },
  { key: "npi", label: "Prescriber NPI", hint: "10 digits", placeholder: "1234567890" },
  { key: "phone", label: "Practice phone" },
  { key: "fax", label: "Practice fax", hint: "insurers fax PA decisions here" },
  { key: "email", label: "Email" },
  { key: "address", label: "Practice address", placeholder: "123 Main St, Suite 200, New York, NY 10001" },
];

export default function SettingsPage() {
  const [p, setP] = useState<Profile | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/settings")
      .then(async (r) => (r.ok ? setP(await r.json()) : setErr("Could not load settings — refresh the page.")))
      .catch(() => setErr("Could not load settings — refresh the page."));
  }, []);

  async function save() {
    if (!p) return;
    setSaving(true);
    setErr(null);
    const r = await fetch("/api/settings", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(p) });
    setSaving(false);
    if (!r.ok) return setErr((await r.json()).error ?? "Could not save");
    setP({ ...(await r.json()), from_photon: [] });
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
  }

  return (
    <div className="mx-auto max-w-2xl px-4 py-8">
      <Card>
        <CardHeader title="Practice & prescriber" subtitle="Filled into every prior-authorization packet. Enter once." />
        {!p ? (
          <div className="flex items-center gap-2 p-6 text-sm text-slate-500">
            {err ? <span className="text-red-600">{err}</span> : <><Loader2 size={16} className="animate-spin" /> Loading…</>}
          </div>
        ) : (
          <form
            className="grid gap-4 p-5 sm:grid-cols-2"
            onSubmit={(e) => {
              e.preventDefault();
              void save();
            }}
          >
            {FIELDS.map((f) => (
              <label key={f.key} className={f.key === "address" || f.key === "practice_name" ? "sm:col-span-2" : ""}>
                <Label hint={p.from_photon?.includes(f.key) ? "from Photon" : f.hint}>{f.label}</Label>
                <Input value={(p[f.key] as string) ?? ""} placeholder={f.placeholder} onChange={(e) => setP({ ...p, [f.key]: e.target.value })} />
              </label>
            ))}
            <label>
              <Label>Credentials</Label>
              <Select value={p.credentials} onChange={(e) => setP({ ...p, credentials: e.target.value })}>
                {["MD", "DO", "NP", "PA-C"].map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </Select>
            </label>
            <div className="flex items-center gap-3 sm:col-span-2">
              <Button type="submit" disabled={saving}>
                {saving ? <Loader2 size={14} className="animate-spin" /> : saved ? <CheckCircle2 size={14} /> : null} {saved ? "Saved" : "Save"}
              </Button>
              {p.npi && !/^\d{10}$/.test(p.npi) && <span className="text-sm text-amber-700">An NPI is 10 digits.</span>}
              {err && <span className="text-sm text-red-600">{err}</span>}
            </div>
          </form>
        )}
      </Card>
    </div>
  );
}
