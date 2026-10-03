import Link from "next/link";
import { Search } from "lucide-react";
import { listPatients } from "@/lib/data";
import { supabaseConfigured } from "@/lib/config";
import { SetupNotice } from "@/components/SetupNotice";
import { Card } from "@/components/ui";
import { LocalTime } from "@/components/History";
import { CONDITIONS, patientName } from "@/lib/types";

export const dynamic = "force-dynamic";

function age(dob: string | null) {
  if (!dob) return null;
  const d = new Date(dob);
  const n = new Date();
  let a = n.getFullYear() - d.getFullYear();
  if (n.getMonth() < d.getMonth() || (n.getMonth() === d.getMonth() && n.getDate() < d.getDate())) a--;
  return a;
}

export default async function PatientsPage({ searchParams }: PageProps<"/patients">) {
  if (!supabaseConfigured()) return <SetupNotice />;
  const sp = await searchParams;
  const q = typeof sp.q === "string" ? sp.q : "";
  const rows = await listPatients(q);

  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">Patients</h1>
        <p className="text-sm text-slate-500">Open a patient to see their chart, blood-pressure history and every past visit.</p>
      </div>
      <Card>
        <form className="border-b border-slate-100 p-3" action="/patients">
          <div className="relative sm:w-72">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              name="q"
              defaultValue={q}
              placeholder="Search by name"
              aria-label="Search patients"
              className="w-full rounded-lg border border-slate-300 py-1.5 pl-9 pr-3 text-sm outline-none focus:border-brand-500"
            />
          </div>
        </form>
        {rows.length === 0 ? (
          <p className="p-10 text-center text-sm text-slate-500">No patients found.</p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {rows.map((p) => {
              const last = p.encounters.map((e) => e.created_at).sort().at(-1);
              const a = age(p.date_of_birth);
              return (
                <li key={p.id}>
                  <Link href={`/patients/${p.id}`} className="flex flex-wrap items-center gap-x-6 gap-y-1 px-5 py-3.5 hover:bg-slate-50">
                    <div className="min-w-48 flex-1">
                      <p className="font-medium">{patientName(p)}</p>
                      <p className="text-xs text-slate-500">{[a !== null ? `${a} y` : null, p.sex?.toLowerCase()].filter(Boolean).join(" · ")}</p>
                    </div>
                    <p className="min-w-0 flex-[2] truncate text-sm text-slate-600">
                      {p.conditions.map((k) => CONDITIONS.find((c) => c.key === k)?.label ?? k).join(", ") || <span className="text-slate-400">No conditions recorded</span>}
                    </p>
                    <p className="w-40 text-right text-xs text-slate-500">
                      {p.encounters.length} visit{p.encounters.length === 1 ? "" : "s"}
                      {last && (
                        <>
                          <br />
                          last <LocalTime iso={last} mode="date" />
                        </>
                      )}
                    </p>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </div>
  );
}
