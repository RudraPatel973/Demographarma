import Link from "next/link";
import { notFound } from "next/navigation";
import { AlertTriangle, CheckCircle2, ExternalLink, FileText, MessageSquare, Pill, ShieldAlert, UserCog } from "lucide-react";
import { getEncounterBundle, listDiagnoses } from "@/lib/data";
import { supabaseConfigured } from "@/lib/config";
import { SetupNotice } from "@/components/SetupNotice";
import { Badge, Card, CardHeader } from "@/components/ui";
import { MatchMeter } from "@/components/MatchMeter";
import { LiveChart } from "@/components/LiveChart";
import { LocalTime, VisitStatus } from "@/components/History";
import { patientName, type Encounter, type Medication, type PatientMessage, type Prescription, type Recommendation, type Patient } from "@/lib/types";

export const dynamic = "force-dynamic";

const RX_STEPS: Prescription["status"][] = ["sent_to_photon", "patient_notified", "pharmacy_selected", "filled", "picked_up"];
const RX_LABEL: Record<string, string> = {
  draft: "Draft",
  sent_to_photon: "Sent to Photon",
  patient_notified: "Patient notified",
  pharmacy_selected: "Pharmacy selected",
  filled: "Ready at pharmacy",
  picked_up: "Picked up",
  canceled: "Canceled",
  error: "Error",
};

type Run = {
  clinical_note: string | null;
  engine: string;
  model: string | null;
  excluded: { medication_id: string; name: string; reasons: { rationale: string }[] }[];
} | null;

function fmt(t: number) {
  return `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, "0")}`;
}

/** Read-only record of a past visit. */
export default async function VisitSummary({ params }: PageProps<"/visits/[id]/summary">) {
  if (!supabaseConfigured()) return <SetupNotice />;
  const { id } = await params;
  let b;
  try {
    b = await getEncounterBundle(id);
  } catch {
    notFound();
  }
  const { encounter: enc, patient, recommendations, prescriptions, medications, messages } = b as {
    encounter: Encounter;
    patient: Patient;
    recommendations: Recommendation[];
    prescriptions: Prescription[];
    medications: Medication[];
    messages: PatientMessage[];
  };
  const run = b.run as unknown as Run;
  const dx = (await listDiagnoses()).find((d) => d.id === enc.diagnosis_id);
  const medById = new Map(medications.map((m) => [m.id, m]));
  const rx = prescriptions[0];
  const rxMed = rx?.medication_id ? medById.get(rx.medication_id) : undefined;
  const chosenRec = recommendations.find((r) => r.id === rx?.recommendation_id);
  const rxMessages = messages.filter((m) => rx && m.prescription_id === rx.id);
  const stepIdx = rx ? RX_STEPS.indexOf(rx.status) : -1;

  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      {/* Header */}
      <div className="mb-6 flex flex-wrap items-center gap-3">
        <div>
          <p className="text-sm text-slate-500">
            <Link href={`/patients/${patient.id}`} className="hover:underline">
              {patientName(patient)}
            </Link>{" "}
            / Visit
          </p>
          <h1 className="text-2xl font-semibold tracking-tight">
            <LocalTime iso={enc.created_at} />
          </h1>
        </div>
        <VisitStatus status={enc.status} />
        <Link href={`/visits/${enc.id}`} className="ml-auto rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50">
          Open in workspace
        </Link>
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="space-y-6">
          {/* Diagnosis */}
          <Card>
            <CardHeader title="Diagnosis" />
            <div className="space-y-2 p-5 text-sm">
              <p className="text-base font-medium">{dx ? `${dx.icd10} · ${dx.name}` : "Not recorded"}</p>
              {enc.live_state?.diagnosis_quote && <p className="italic text-slate-600">Doctor said: &ldquo;{enc.live_state.diagnosis_quote}&rdquo;</p>}
              {enc.diagnosis_notes && <p className="text-slate-600">{enc.diagnosis_notes}</p>}
              {enc.live_state?.notes && <p className="text-slate-600">Noted in conversation: {enc.live_state.notes}</p>}
            </div>
          </Card>

          {/* Prescribed */}
          <Card>
            <CardHeader
              title="Prescribed"
              right={rx ? <Badge tone={rx.status === "error" ? "red" : "green"}>{RX_LABEL[rx.status] ?? rx.status}</Badge> : null}
            />
            {rx ? (
              <div className="space-y-4 p-5 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <Pill size={16} className="text-brand-600" />
                  <span className="text-base font-semibold capitalize">{rxMed?.generic_name ?? rx.custom_medication}</span>
                  {rx.dose_mg ? <span className="text-base">{rx.dose_mg} mg</span> : null}
                  {rx.is_override ? (
                    <Badge tone="amber">
                      <UserCog size={12} /> Doctor override
                    </Badge>
                  ) : chosenRec ? (
                    <Badge tone="brand">
                      Recommendation #{chosenRec.rank} · {chosenRec.match_percent}% match
                    </Badge>
                  ) : null}
                </div>
                <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-2">
                  <div>
                    <dt className="text-xs text-slate-500">Directions</dt>
                    <dd>{rx.sig}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-slate-500">Quantity</dt>
                    <dd>
                      #{rx.dispense_quantity} {rx.dispense_unit} · {rx.days_supply} days · {rx.fills_allowed} fills
                    </dd>
                  </div>
                  {rx.selection_reason && (
                    <div className="sm:col-span-2">
                      <dt className="text-xs text-slate-500">Doctor&apos;s reason</dt>
                      <dd>{rx.selection_reason}</dd>
                    </div>
                  )}
                  <div>
                    <dt className="text-xs text-slate-500">Sent via</dt>
                    <dd>{rx.photon_mode === "live" ? "Photon Health (sandbox)" : "Photon mock mode"}</dd>
                  </div>
                  {rx.photon_order_id && (
                    <div>
                      <dt className="text-xs text-slate-500">Photon order</dt>
                      <dd className="font-mono text-xs">{rx.photon_order_id}</dd>
                    </div>
                  )}
                </dl>
                <ol className="flex flex-wrap items-center gap-2">
                  {RX_STEPS.map((s, i) => (
                    <li key={s} className={`flex items-center gap-1 rounded-full px-2.5 py-1 text-xs ${i <= stepIdx ? "bg-brand-600 text-white" : "bg-slate-100 text-slate-500"}`}>
                      {i <= stepIdx && <CheckCircle2 size={12} />} {RX_LABEL[s]}
                    </li>
                  ))}
                </ol>
                {rxMessages.length > 0 && (
                  <div>
                    <p className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-slate-500">
                      <MessageSquare size={13} /> Texts to the patient
                    </p>
                    <ul className="space-y-1.5">
                      {rxMessages.map((m) => (
                        <li key={m.id} className="rounded-lg bg-orange-50 px-3 py-2 text-orange-950">
                          <span className="mr-2 text-[11px] text-orange-700">
                            <LocalTime iso={m.created_at} mode="time" />
                          </span>
                          {m.body}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            ) : (
              <p className="p-5 text-sm text-slate-500">Nothing was prescribed at this visit.</p>
            )}
          </Card>

          {/* Recommendations */}
          {recommendations.length > 0 && (
            <Card>
              <CardHeader
                title="What was recommended"
                subtitle={run?.engine === "ai" ? `Ranked by ${run.model} from the rule-engine shortlist` : "Ranked by the rule engine"}
              />
              <ul className="divide-y divide-slate-100">
                {recommendations.map((r) => {
                  const m = medById.get(r.medication_id);
                  const chosen = rx?.recommendation_id === r.id;
                  return (
                    <li key={r.id} className={`flex flex-wrap gap-4 p-5 ${chosen ? "bg-brand-50/60" : ""}`}>
                      <MatchMeter value={r.match_percent} size={64} />
                      <div className="min-w-0 flex-1 text-sm">
                        <p className="flex flex-wrap items-center gap-2">
                          <span className="text-base font-semibold capitalize">
                            #{r.rank} {m?.generic_name ?? r.medication_id}
                          </span>
                          <span className="text-slate-500">{m?.drug_class}</span>
                          {chosen && <Badge tone="brand">Prescribed</Badge>}
                        </p>
                        <p className="mt-1 text-slate-700">{r.summary}</p>
                        <p className="mt-1 text-slate-500">
                          Suggested: {r.dose_mg} mg — {r.sig}
                        </p>
                        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
                          {r.factors_for.map((f, i) => (
                            <span key={`f${i}`} className="flex items-center gap-1 text-emerald-800">
                              <CheckCircle2 size={13} /> {f}
                            </span>
                          ))}
                          {r.factors_against.map((f, i) => (
                            <span key={`a${i}`} className="flex items-center gap-1 text-amber-800">
                              <AlertTriangle size={13} /> {f}
                            </span>
                          ))}
                        </div>
                        {m?.dailymed_url && (
                          <a href={m.dailymed_url} target="_blank" rel="noreferrer" className="mt-2 inline-flex items-center gap-1 text-xs text-sky-700 hover:underline">
                            FDA label <ExternalLink size={11} />
                          </a>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
              {run?.clinical_note && <p className="whitespace-pre-line border-t border-slate-100 bg-sky-50/50 p-5 text-sm text-slate-700">{run.clinical_note}</p>}
              {run && run.excluded.length > 0 && (
                <div className="border-t border-slate-100 p-5 text-sm">
                  <p className="mb-1 flex items-center gap-1.5 font-medium">
                    <ShieldAlert size={14} className="text-red-600" /> Excluded as contraindicated
                  </p>
                  {run.excluded.map((x) => (
                    <p key={x.medication_id} className="text-slate-600">
                      <span className="capitalize">{x.name}</span>: {x.reasons.map((r) => r.rationale).join(" ")}
                    </p>
                  ))}
                </div>
              )}
            </Card>
          )}

          {/* Transcript */}
          <Card>
            <CardHeader title="Conversation" subtitle={`${enc.transcript.length} lines`} />
            <div className="space-y-4 p-5">
              {enc.video_path && (
                <video src={`/api/encounters/${enc.id}/media?path=${encodeURIComponent(enc.video_path)}`} controls className="w-full max-w-xl rounded-lg bg-slate-900" />
              )}
              {enc.documents.length > 0 && (
                <ul className="flex flex-wrap gap-2">
                  {enc.documents.map((d) => (
                    <li key={d.path}>
                      <a
                        href={`/api/encounters/${enc.id}/media?path=${encodeURIComponent(d.path)}`}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-2.5 py-1.5 text-sm hover:bg-slate-50"
                      >
                        <FileText size={14} /> {d.name}
                      </a>
                    </li>
                  ))}
                </ul>
              )}
              <div className="max-h-[480px] space-y-1.5 overflow-y-auto text-sm leading-relaxed">
                {enc.transcript.length === 0 && <p className="text-slate-400">No transcript.</p>}
                {enc.transcript.map((s, i) => (
                  <p key={i}>
                    <span className="mr-2 font-mono text-[11px] text-slate-400">{fmt(s.t)}</span>
                    {s.text}
                  </p>
                ))}
              </div>
            </div>
          </Card>
        </div>

        <Card className="lg:self-start">
          <CardHeader title="Chart at this visit" subtitle="Vitals and labs from this visit; other fields are the current chart" />
          <div className="p-5">
            <LiveChart patient={patient} encounter={enc} />
          </div>
        </Card>
      </div>
    </div>
  );
}
