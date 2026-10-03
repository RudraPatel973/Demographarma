import Link from "next/link";
import { Plus } from "lucide-react";
import { db, must } from "@/lib/supabase";
import { supabaseConfigured } from "@/lib/config";
import { SetupNotice } from "@/components/SetupNotice";
import { Badge, Card } from "@/components/ui";
import { patientName } from "@/lib/types";

export const dynamic = "force-dynamic";

type Row = {
  id: string;
  status: string;
  created_at: string;
  diagnosis_id: string | null;
  patients: { first_name: string | null; last_name: string | null; date_of_birth: string | null; sex: string | null } | null;
};

export default async function Home() {
  if (!supabaseConfigured()) return <SetupNotice />;
  const rows = must(
    await db()
      .from("encounters")
      .select("id,status,created_at,diagnosis_id,patients(first_name,last_name,date_of_birth,sex)")
      .order("created_at", { ascending: false })
      .limit(50),
  ) as unknown as Row[];

  return (
    <div className="mx-auto max-w-5xl px-4 py-8">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Visits</h1>
          <p className="text-sm text-slate-500">Talk to the patient. Say the diagnosis. Pick from 3 matched medications.</p>
        </div>
        <Link href="/visits/new" className="inline-flex items-center gap-2 rounded-lg bg-brand-600 px-3.5 py-2 text-sm font-medium text-white hover:bg-brand-700">
          <Plus size={16} /> New visit
        </Link>
      </div>
      <Card>
        {rows.length === 0 ? (
          <div className="p-10 text-center text-sm text-slate-500">
            No visits yet.{" "}
            <Link href="/visits/new" className="text-brand-700 hover:underline">
              Start the first one
            </Link>
            .
          </div>
        ) : (
          <ul className="divide-y divide-slate-100">
            {rows.map((r) => (
              <li key={r.id}>
                <Link href={`/visits/${r.id}`} className="flex items-center gap-4 px-5 py-3.5 hover:bg-slate-50">
                  <div className="min-w-0 flex-1">
                    <p className="font-medium">
                      {r.patients ? patientName(r.patients) : "New patient"}
                    </p>
                    <p className="text-xs text-slate-500">
                      {new Date(r.created_at).toLocaleString()} {r.diagnosis_id ? `· ${r.diagnosis_id.replace(/_/g, " ")}` : ""}
                    </p>
                  </div>
                  <Badge tone={r.status === "completed" ? "green" : r.status === "in_progress" ? "slate" : "brand"}>{r.status.replace("_", " ")}</Badge>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
