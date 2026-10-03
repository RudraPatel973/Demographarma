import { notFound } from "next/navigation";
import { getPatient, listDiagnoses, listVisits } from "@/lib/data";
import { supabaseConfigured } from "@/lib/config";
import { SetupNotice } from "@/components/SetupNotice";
import { Card, CardHeader } from "@/components/ui";
import { LiveChart } from "@/components/LiveChart";
import { LocalTime, VisitTable, type VisitRowLite } from "@/components/History";
import { visitHref } from "@/lib/visits";
import { StartVisitButton } from "@/components/StartVisitButton";
import { patientName, type Encounter } from "@/lib/types";
import Link from "next/link";

export const dynamic = "force-dynamic";

export default async function PatientPage({ params }: PageProps<"/patients/[id]">) {
  if (!supabaseConfigured()) return <SetupNotice />;
  const { id } = await params;
  let patient;
  try {
    patient = await getPatient(id);
  } catch {
    notFound();
  }
  const [visits, diagnoses] = await Promise.all([listVisits({ patientId: id }), listDiagnoses()]);
  const latest = visits[0];
  // LiveChart shows vitals/labs from the most recent visit
  const latestEnc = {
    vitals: latest?.vitals ?? {},
    labs: latest?.labs ?? {},
    live_state: latest?.live_state ?? {},
  } as unknown as Encounter;
  const bp = visits.filter((v) => v.vitals?.bp_systolic).slice(0, 12);
  const maxSbp = Math.max(180, ...bp.map((v) => v.vitals.bp_systolic ?? 0));

  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      <div className="mb-6 flex flex-wrap items-center gap-4">
        <div>
          <p className="text-sm text-slate-500">
            <Link href="/patients" className="hover:underline">
              Patients
            </Link>{" "}
            /
          </p>
          <h1 className="text-2xl font-semibold tracking-tight">{patientName(patient)}</h1>
          <p className="text-sm text-slate-500">
            {visits.length} visit{visits.length === 1 ? "" : "s"}
            {latest && (
              <>
                {" "}
                · last <LocalTime iso={latest.created_at} mode="date" />
              </>
            )}
          </p>
        </div>
        <div className="ml-auto">
          <StartVisitButton patientId={patient.id} />
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="space-y-6">
          <Card>
            <CardHeader title="Visit history" subtitle="Click a visit to see what was said, recommended and prescribed" />
            <VisitTable rows={visits as unknown as VisitRowLite[]} diagnoses={diagnoses} showPatient={false} />
          </Card>

          {bp.length > 0 && (
            <Card>
              <CardHeader title="Blood pressure over time" subtitle="From each visit (systolic bar, diastolic marker). Goal <130/80." />
              <ul className="space-y-2 p-5">
                {bp.map((v) => {
                  const s = v.vitals.bp_systolic ?? 0;
                  const d = v.vitals.bp_diastolic ?? 0;
                  const high = s >= 140 || d >= 90;
                  const elevated = !high && (s >= 130 || d >= 80);
                  return (
                    <li key={v.id}>
                      <Link href={visitHref(v)} className="grid grid-cols-[110px_1fr_70px] items-center gap-3 text-sm hover:opacity-80">
                        <span className="text-slate-500">
                          <LocalTime iso={v.created_at} mode="date" />
                        </span>
                        <span className="relative h-3 rounded-full bg-slate-100">
                          <span
                            className={`absolute inset-y-0 left-0 rounded-full ${high ? "bg-red-400" : elevated ? "bg-amber-400" : "bg-emerald-400"}`}
                            style={{ width: `${(s / maxSbp) * 100}%` }}
                          />
                          <span className="absolute inset-y-[-3px] w-0.5 bg-slate-700" style={{ left: `${(d / maxSbp) * 100}%` }} aria-hidden />
                          <span className="absolute inset-y-[-3px] w-px bg-slate-400" style={{ left: `${(130 / maxSbp) * 100}%` }} aria-hidden />
                        </span>
                        <span className="text-right font-medium tabular-nums">
                          {s}/{d}
                        </span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </Card>
          )}
        </div>

        <Card className="lg:self-start">
          <CardHeader title="Current chart" subtitle="Vitals from the most recent visit" />
          <div className="p-5">
            <LiveChart patient={patient} encounter={latestEnc} />
          </div>
        </Card>
      </div>
    </div>
  );
}
