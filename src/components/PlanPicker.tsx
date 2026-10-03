"use client";

import { useEffect, useState } from "react";
import { Search, X } from "lucide-react";
import { Input } from "./ui";

type Plan = { id: string; name: string; payer?: string | null; plan_type?: string; formulary_id?: string | null };

/** Search the insurance plan list (Medicare Part D from CMS + commercial/cash). */
export function PlanPicker({ value, said, onChange }: { value: { id: string; name: string } | null; said: string | null; onChange: (p: Plan | null) => void }) {
  const [q, setQ] = useState(said ?? "");
  const [open, setOpen] = useState(false);
  const [results, setResults] = useState<Plan[]>([]);
  useEffect(() => {
    if (!open) return;
    const t = setTimeout(async () => {
      const r = await fetch(`/api/plans?q=${encodeURIComponent(q)}`);
      if (r.ok) setResults(await r.json());
    }, 200);
    return () => clearTimeout(t);
  }, [q, open]);

  if (value) {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-slate-300 bg-slate-50 px-3 py-2 text-sm">
        <span className="flex-1 truncate">{value.name}</span>
        <button type="button" aria-label="Remove plan" onClick={() => onChange(null)}>
          <X size={14} className="text-slate-400 hover:text-red-600" />
        </button>
      </div>
    );
  }
  return (
    <div className="relative">
      <Search size={14} className="absolute left-3 top-2.5 text-slate-400" />
      <Input className="pl-8" placeholder="Search plan (e.g. Humana, AARP, Wellcare)" value={q} onFocus={() => setOpen(true)} onChange={(e) => setQ(e.target.value)} aria-label="Insurance plan" />
      {said && <p className="mt-1 text-xs text-slate-500">Patient said: &ldquo;{said}&rdquo; — pick the matching plan.</p>}
      {open && results.length > 0 && (
        <ul className="absolute z-10 mt-1 max-h-64 w-full overflow-y-auto rounded-lg border border-slate-200 bg-white shadow-lg">
          {results.map((p) => (
            <li key={p.id}>
              <button
                type="button"
                className="w-full px-3 py-2 text-left text-sm hover:bg-slate-50"
                onClick={() => {
                  onChange(p);
                  setOpen(false);
                }}
              >
                <span className="block">{p.name}</span>
                <span className="text-xs text-slate-500">
                  {p.plan_type} · {p.id}
                  {p.formulary_id ? "" : " · drug list unknown"}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
