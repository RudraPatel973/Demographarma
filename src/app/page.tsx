import Link from "next/link";
import clsx from "clsx";
import { Plus, Search } from "lucide-react";
import { listDiagnoses, listVisits } from "@/lib/data";
import { supabaseConfigured } from "@/lib/config";
import { SetupNotice } from "@/components/SetupNotice";
import { Card } from "@/components/ui";
import { VisitTable, type VisitRowLite } from "@/components/History";

export const dynamic = "force-dynamic";

const TABS = [
  { key: "", label: "All" },
  { key: "in_progress", label: "In progress" },
  { key: "prescribed", label: "Prescribed" },
  { key: "completed", label: "Completed" },
];

export default async function Home({ searchParams }: PageProps<"/">) {
  if (!supabaseConfigured()) return <SetupNotice />;
  const sp = await searchParams;
  const status = typeof sp.status === "string" ? sp.status : "";
  const q = typeof sp.q === "string" ? sp.q : "";
  const [rows, diagnoses] = await Promise.all([listVisits({ status, q }) as unknown as Promise<VisitRowLite[]>, listDiagnoses()]);

  const href = (s: string) => `/?${new URLSearchParams({ ...(s ? { status: s } : {}), ...(q ? { q } : {}) })}`;

  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      <div className="mb-6 flex flex-wrap items-center gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Visits</h1>
          <p className="text-sm text-slate-500">Every visit, newest first. Open one to see what was said, recommended and prescribed.</p>
        </div>
        <Link href="/visits/new" className="ml-auto inline-flex items-center gap-2 rounded-lg bg-brand-600 px-3.5 py-2 text-sm font-medium text-white hover:bg-brand-700">
          <Plus size={16} /> New visit
        </Link>
      </div>

      <Card>
        <div className="flex flex-wrap items-center gap-3 border-b border-slate-100 px-4 py-3">
          <nav className="flex gap-1" aria-label="Filter visits">
            {TABS.map((t) => (
              <Link
                key={t.key}
                href={href(t.key)}
                className={clsx("rounded-lg px-3 py-1.5 text-sm", status === t.key ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-100")}
                aria-current={status === t.key ? "page" : undefined}
              >
                {t.label}
              </Link>
            ))}
          </nav>
          <form className="relative ml-auto w-full sm:w-64" action="/">
            {status && <input type="hidden" name="status" value={status} />}
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              name="q"
              defaultValue={q}
              placeholder="Search patient name"
              aria-label="Search patient name"
              className="w-full rounded-lg border border-slate-300 py-1.5 pl-9 pr-3 text-sm outline-none focus:border-brand-500"
            />
          </form>
        </div>
        <VisitTable rows={rows} diagnoses={diagnoses} />
      </Card>
    </div>
  );
}
