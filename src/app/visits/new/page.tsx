"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Mic, Search, UserRound } from "lucide-react";
import { Card, Input } from "@/components/ui";
import { patientName } from "@/lib/types";

type Row = { id: string; first_name: string | null; last_name: string | null; date_of_birth: string | null; sex: string | null; conditions: string[] };

export default function NewVisit() {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [rows, setRows] = useState<Row[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    const t = setTimeout(async () => {
      const r = await fetch(`/api/patients?q=${encodeURIComponent(q)}`);
      if (r.ok) setRows(await r.json());
    }, 200);
    return () => clearTimeout(t);
  }, [q]);

  async function start(patientId?: string) {
    setBusy(patientId ?? "new");
    setErr(null);
    const r = await fetch("/api/encounters", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(patientId ? { patient_id: patientId } : {}),
    });
    const j = await r.json();
    if (!r.ok) {
      setErr(j.error ?? "Could not start the visit");
      setBusy(null);
      return;
    }
    router.push(`/visits/${j.id}?autostart=1`);
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6 px-4 py-10">
      <button
        onClick={() => start()}
        disabled={busy !== null}
        className="flex w-full items-center gap-5 rounded-2xl bg-brand-600 p-6 text-left text-white shadow-sm transition-colors hover:bg-brand-700 disabled:opacity-60"
      >
        <span className="grid h-14 w-14 shrink-0 place-items-center rounded-full bg-white/15">
          {busy === "new" ? <Loader2 className="animate-spin" /> : <Mic size={26} />}
        </span>
        <span>
          <span className="block text-lg font-semibold">New patient — start recording</span>
          <span className="block text-sm text-white/80">Ask their details out loud. The chart fills itself in from the conversation.</span>
        </span>
      </button>

      <Card>
        <div className="border-b border-slate-100 p-4">
          <p className="mb-2 text-sm font-medium">Returning patient</p>
          <div className="relative">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <Input className="pl-9" placeholder="Search by name" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search patients" />
          </div>
        </div>
        {rows.length === 0 ? (
          <p className="p-6 text-center text-sm text-slate-400">No patients found.</p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {rows.map((p) => (
              <li key={p.id}>
                <button onClick={() => start(p.id)} disabled={busy !== null} className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-slate-50">
                  <UserRound size={18} className="text-slate-400" />
                  <span className="flex-1">
                    <span className="block font-medium">{patientName(p)}</span>
                    <span className="block text-xs text-slate-500">
                      {[p.date_of_birth, p.sex?.toLowerCase(), p.conditions.slice(0, 3).join(", ").replace(/_/g, " ")].filter(Boolean).join(" · ")}
                    </span>
                  </span>
                  {busy === p.id ? <Loader2 size={16} className="animate-spin" /> : <span className="text-xs font-medium text-brand-700">Start visit →</span>}
                </button>
              </li>
            ))}
          </ul>
        )}
      </Card>
      {err && <p className="text-sm text-red-600">{err}</p>}
    </div>
  );
}
