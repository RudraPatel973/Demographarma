"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import clsx from "clsx";
import { AlertCircle, ChevronDown, FileText, History, Loader2, Mic, Paperclip, Pencil, RefreshCw, Smartphone, Sparkles, Square, UserCog } from "lucide-react";
import { Badge, Button, Card, CardHeader } from "./ui";
import { LiveChart } from "./LiveChart";
import { ChartEditor } from "./ChartEditor";
import { DecisionPanel, Excluded, RecCard, RxTracker, type Fired, type MedOption } from "./Results";
import { useVisitRecorder } from "./useVisitRecorder";
import { TwoPillFlow } from "./TwoPill";
import { MissingInfo } from "./MissingInfo";
import { InsurancePanel, type PacketRow } from "./InsurancePanel";
import { missingRecommended, missingRequired, REQUIRED_LABELS, type RequiredKey } from "@/lib/requirements";
import { uploadFile } from "@/lib/upload";
import { patientName, type Diagnosis, type Encounter, type Medication, type Patient, type PatientMessage, type Prescription, type Recommendation, type TranscriptSegment, type MedicationTrial } from "@/lib/types";

export interface Bundle {
  encounter: Encounter;
  patient: Patient;
  recommendations: Recommendation[];
  second?: Recommendation[];
  run2?: Bundle["run"];
  run: {
    clinical_note: string | null;
    engine: string;
    model: string | null;
    candidates: { medication_id: string; line_of_therapy: string; fired: Fired[] }[];
    excluded: { medication_id: string; name: string; reasons: { matched: string; rationale: string }[] }[];
  } | null;
  prescriptions: Prescription[];
  medications: Medication[];
  messages: PatientMessage[];
  trials?: MedicationTrial[];
  priorAuths?: PacketRow[];
}

type Phase = "record" | "generating" | "results";

const SYNC_EVERY_MS = 15000; // safety net; normally every finished phrase triggers a sync
const CONFIRM_SECONDS = 3; // after the diagnosis is heard: time to say "keep recording" before it generates
// Phrases that suggest the doctor may be giving the diagnosis: sync immediately instead of waiting
const DX_HINT = /hypertension|high blood pressure|blood pressure is (too )?high|diagnos|you have|stage (one|two|1|2)/i;

const STEPS = [
  "Finishing the chart from the conversation…",
  "Looking up hypertension medications (Table 1)…",
  "Applying patient modifiers (Table 2)…",
  "Ruling out contraindicated drugs…",
  "Ranking the best 3 for this patient…",
];

function ageOf(dob: string | null) {
  if (!dob) return null;
  const d = new Date(dob);
  const n = new Date();
  let a = n.getFullYear() - d.getFullYear();
  if (n.getMonth() < d.getMonth() || (n.getMonth() === d.getMonth() && n.getDate() < d.getDate())) a--;
  return a;
}
const fmt = (t: number) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, "0")}`;

export function VisitWorkspace({
  initial,
  diagnoses,
  meds,
  aiOn,
  autostart,
  liveDebounceMs,
}: {
  initial: Bundle;
  diagnoses: Diagnosis[];
  meds: MedOption[];
  aiOn: boolean;
  autostart: boolean;
  liveDebounceMs: number;
}) {
  const [bundle, setBundle] = useState(initial);
  const [patient, setPatient] = useState(initial.patient);
  const [enc, setEnc] = useState(initial.encounter);
  const [phase, setPhase] = useState<Phase>(initial.recommendations.length ? "results" : "record");
  const [step, setStep] = useState(0);
  const [syncing, setSyncing] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [genError, setGenError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [choice, setChoice] = useState<{ rec: Recommendation | null; override: boolean } | null>(null);
  const [showTranscript, setShowTranscript] = useState(false);

  const encId = enc.id;
  const inFlight = useRef(false);
  const dirty = useRef(false);
  const again = useRef(false);
  const finishing = useRef(false);
  const transcriptRef = useRef<TranscriptSegment[]>(initial.encounter.transcript);
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);
  const heardRef = useRef(false);
  const dismissedQuote = useRef<string | null>(null);
  const [heard, setHeard] = useState<{ quote: string | null; left: number } | null>(null);
  // true when the doctor tried to finish but required chart items are missing
  const [waiting, setWaiting] = useState(false);
  // What the server said was missing on the last attempt (cleared whenever the chart changes)
  const [serverMissing, setServerMissing] = useState<string[]>([]);
  // The server reports a field this page doesn't track: the tab is running an older version of the app
  const [stale, setStale] = useState(false);


  const refresh = useCallback(async () => {
    const r = await fetch(`/api/encounters/${encId}`, { cache: "no-store" });
    if (!r.ok) return null;
    const b = (await r.json()) as Bundle;
    setBundle(b);
    setPatient(b.patient);
    setEnc(b.encounter);
    return b;
  }, [encId]);

  // ---------------- finish: stop → final sync → generate → results ----------
  const finishRef = useRef<() => void>(() => {});

  const {
    start: recStart,
    stop: recStop,
    recording,
    interim,
    elapsed,
    error: recError,
    videoStatus,
    videoRef,
  } = useVisitRecorder({
    encounterId: encId,
    initial: initial.encounter.transcript,
    onSegment: (all, latest) => {
      transcriptRef.current = all;
      setEnc((e) => ({ ...e, transcript: all }));
      dirty.current = true;
      // Update the chart as soon as the speaker pauses (immediately for diagnosis-like phrases)
      if (debounce.current) clearTimeout(debounce.current);
      debounce.current = setTimeout(() => void syncNow(), DX_HINT.test(latest.text) ? 0 : liveDebounceMs);
    },
    onVideoSaved: (path) => {
      fetch(`/api/encounters/${encId}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ video_path: path }) });
    },
  });

  const syncNow = useCallback(async () => {
    if (finishing.current) return;
    if (inFlight.current) {
      again.current = true;
      return;
    }
    if (!dirty.current) return;
    inFlight.current = true;
    dirty.current = false;
    setSyncing(true);
    try {
      const r = await fetch(`/api/encounters/${encId}/live`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ transcript: transcriptRef.current }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? "Live update failed");
      setSyncError(null);
      setServerMissing([]);
      setPatient(j.patient);
      setEnc((e) => ({ ...j.encounter, transcript: transcriptRef.current.length >= j.encounter.transcript.length ? transcriptRef.current : j.encounter.transcript, id: e.id }));
      const quote: string | null = j.encounter.live_state?.diagnosis_quote ?? null;
      if (j.diagnosisStated && !heardRef.current && quote !== dismissedQuote.current) {
        heardRef.current = true;
        if (missingRequired(j.patient, j.encounter).length) setWaiting(true);
        else setHeard({ quote, left: CONFIRM_SECONDS });
      }
    } catch (e) {
      setSyncError(e instanceof Error ? e.message : String(e));
      dirty.current = true;
    } finally {
      inFlight.current = false;
      setSyncing(false);
      if (again.current) {
        again.current = false;
        void syncNow();
      }
    }
  }, [encId]);

  const clientMissing = useMemo(() => missingRequired(patient, enc), [patient, enc]);
  const missing = useMemo(
    () => Array.from(new Set([...clientMissing, ...serverMissing])) as RequiredKey[],
    [clientMissing, serverMissing],
  );
  const recommended = useMemo(() => missingRecommended(enc), [enc]);
  const missingRef = useRef(missing);
  useEffect(() => {
    missingRef.current = missing;
  }, [missing]);

  const finish = useCallback(async () => {
    if (finishing.current) return;
    if (missingRef.current.length) {
      setWaiting(true); // keep recording; the panel lists what's needed
      return;
    }
    finishing.current = true;
    const segs = recording ? recStop() : transcriptRef.current;
    setPhase("generating");
    setStep(0);
    setGenError(null);
    const ticker = setInterval(() => setStep((s) => Math.min(s + 1, STEPS.length - 1)), 2500);
    try {
      await fetch(`/api/encounters/${encId}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ transcript: segs }) });
      const r = await fetch(`/api/encounters/${encId}/generate`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ sync: true }) });
      const j = await r.json();
      if (r.status === 422 && Array.isArray(j.missing)) {
        const known = j.missing.filter((k: string) => k in REQUIRED_LABELS);
        // Server wants something this version of the page can't collect -> ask for a reload instead of retrying
        if (known.length < j.missing.length) setStale(true);
        setServerMissing(j.missing);
        await refresh();
        setWaiting(true);
        setPhase("record");
        return;
      }
      if (!r.ok) throw new Error(j.error ?? "Could not generate recommendations");
      await refresh();
      setChoice(null);
      setPhase("results");
    } catch (e) {
      setGenError(e instanceof Error ? e.message : String(e));
      setPhase("record");
    } finally {
      clearInterval(ticker);
      finishing.current = false;
    }
  }, [encId, recording, recStop, refresh]);

  useEffect(() => {
    finishRef.current = finish;
  }, [finish]);

  // Was waiting on missing info and now everything is in: continue automatically
  useEffect(() => {
    if (!waiting || missing.length || stale) return;
    const t = setTimeout(() => {
      setWaiting(false);
      setHeard({ quote: enc.live_state?.diagnosis_quote ?? null, left: CONFIRM_SECONDS });
    }, 400);
    return () => clearTimeout(t);
  }, [waiting, missing.length, stale, enc.live_state?.diagnosis_quote]);

  // Diagnosis heard: short countdown (recording continues), then generate
  useEffect(() => {
    if (!heard) return;
    const t = setTimeout(() => {
      if (heard.left <= 1) {
        setHeard(null);
        void finishRef.current();
      } else setHeard({ ...heard, left: heard.left - 1 });
    }, 1000);
    return () => clearTimeout(t);
  }, [heard]);

  // periodic live sync while recording
  useEffect(() => {
    if (!recording || !aiOn) return;
    const t = setInterval(() => void syncNow(), SYNC_EVERY_MS);
    return () => clearInterval(t);
  }, [recording, aiOn, syncNow]);

  // start recording automatically for a new visit
  const started = useRef(false);
  useEffect(() => {
    if (autostart && phase === "record" && !started.current) {
      started.current = true;
      void recStart();
    }
  }, [autostart, phase, recStart]);

  // poll while a prescription is in flight
  const rx = bundle.prescriptions[0];
  useEffect(() => {
    if (!rx || ["picked_up", "canceled"].includes(rx.status)) return;
    const t = setInterval(refresh, 4000);
    return () => clearInterval(t);
  }, [rx, refresh]);

  async function attach(files: FileList | null) {
    if (!files?.length) return;
    const docs = [...enc.documents];
    for (const f of Array.from(files)) {
      const path = await uploadFile(encId, "document", f);
      docs.push({ name: f.name, path, mime: f.type || "application/octet-stream", size: f.size });
    }
    setEnc((e) => ({ ...e, documents: docs }));
    await fetch(`/api/encounters/${encId}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ documents: docs }) });
    dirty.current = true;
    void syncNow();
  }

  const medById = useMemo(() => new Map(bundle.medications.map((m) => [m.id, m])), [bundle.medications]);
  const candById = useMemo(() => new Map((bundle.run?.candidates ?? []).map((c) => [c.medication_id, c])), [bundle.run]);
  const dx = diagnoses.find((d) => d.id === enc.diagnosis_id);
  const age = ageOf(patient.date_of_birth);

  return (
    <div className="mx-auto max-w-7xl px-4 py-6">
      {/* Header */}
      <div className="mb-6 flex flex-wrap items-center gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">{patientName(patient)}</h1>
          <p className="text-sm text-slate-500">
            {[age !== null ? `${age} y` : null, patient.sex?.toLowerCase(), dx ? `${dx.icd10} ${dx.name}` : null].filter(Boolean).join(" · ") || "Details fill in as you talk"}
          </p>
        </div>
        {phase === "record" && recording && (
          <span className="flex items-center gap-2 rounded-full bg-red-50 px-3 py-1 text-xs font-medium text-red-700">
            <span className="rec-dot h-2 w-2 rounded-full bg-red-500" /> Recording {fmt(elapsed)}
          </span>
        )}
        {phase === "results" && <Badge tone="brand">{enc.status.replace("_", " ")}</Badge>}
        <div className="ml-auto flex items-center gap-2">
        {patient.first_name && (
          <Link href={`/patients/${patient.id}`} className="inline-flex items-center gap-1 rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50">
            <History size={14} /> Past visits
          </Link>
        )}
        {rx && (
          <Link href={`/visits/${encId}/summary`} className="inline-flex items-center gap-1 rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50">
            <FileText size={14} /> Visit summary
          </Link>
        )}
        <Link href={`/patient/${patient.id}`} target="_blank" className="inline-flex items-center gap-1 rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50">
          <Smartphone size={14} /> Patient&apos;s phone
        </Link>
        </div>
      </div>

      {/* ------------------------------------------------------------ RECORD */}
      {phase === "record" && !waiting && !stale && missing.length > 0 && (enc.transcript.length > 0 || recording) && (
        <div className="mb-4 flex flex-wrap items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-2.5 text-sm text-amber-950" role="status" aria-live="polite">
          <AlertCircle size={16} className="shrink-0 text-amber-700" />
          <span className="font-medium">Still needed before recommendations:</span>
          {missing.map((k) => (
            <span key={k} className="rounded-full bg-white px-2.5 py-0.5 text-xs font-medium ring-1 ring-amber-300">
              {REQUIRED_LABELS[k] ?? k}
            </span>
          ))}
          <span className="text-xs text-amber-800">Ask the patient — each item ticks off as it&apos;s said.</span>
        </div>
      )}
      {stale && (
        <div className="mb-4 flex flex-wrap items-center gap-3 rounded-xl border border-sky-300 bg-sky-50 px-4 py-3 text-sm" role="alert">
          <span>This page is out of date — the app was updated while it was open. Reload to continue; nothing from this visit is lost.</span>
          <Button className="ml-auto" onClick={() => window.location.reload()}>
            Reload
          </Button>
        </div>
      )}
      {phase === "record" && waiting && missing.length > 0 && !stale && (
        <MissingInfo
          missing={missing}
          recommended={recommended}
          patient={patient}
          encounter={enc}
          listening={recording}
          onPatient={(p) => {
            setServerMissing([]);
            setPatient(p);
          }}
          onEncounter={(e) => {
            setServerMissing([]);
            setEnc((cur) => ({ ...cur, ...e }));
          }}
          onCancel={() => setWaiting(false)}
        />
      )}
      {phase === "record" && heard && (
        <div className="mb-4 flex flex-wrap items-center gap-3 rounded-xl border border-brand-200 bg-brand-50 px-4 py-3 text-sm" role="status">
          <Sparkles size={16} className="text-brand-700" />
          <span>
            Diagnosis heard{heard.quote ? <>: <span className="italic">&ldquo;{heard.quote}&rdquo;</span></> : null}. Getting recommendations in {heard.left}s…
          </span>
          <Button
            variant="secondary"
            className="ml-auto"
            onClick={() => {
              // ignore this statement; a new, different one can trigger again
              dismissedQuote.current = heard.quote;
              heardRef.current = false;
              setHeard(null);
            }}
          >
            Keep recording
          </Button>
          <Button onClick={() => { setHeard(null); void finish(); }}>Now</Button>
        </div>
      )}
      {phase === "record" && (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
          <Card className="flex min-h-[560px] flex-col">
            <div className="flex items-center gap-3 border-b border-slate-100 px-5 py-3">
              {recording ? (
                <>
                  <span className="text-sm font-medium">Listening</span>
                  <span className="text-xs text-slate-500">Say the diagnosis out loud when you&apos;re ready, e.g. &ldquo;you have stage 2 hypertension&rdquo;.</span>
                </>
              ) : (
                <span className="text-sm text-slate-500">{enc.transcript.length ? "Paused" : "Ready"}</span>
              )}
              <div className="ml-auto flex items-center gap-2">
                <label className="cursor-pointer rounded-lg p-2 text-slate-500 hover:bg-slate-100" title="Attach a document (lab report, referral…)">
                  <Paperclip size={16} />
                  <input type="file" multiple className="sr-only" accept=".pdf,.png,.jpg,.jpeg,.txt" onChange={(e) => attach(e.target.files)} />
                </label>
                {!recording ? (
                  <Button onClick={() => void recStart()}>
                    <Mic size={16} /> {enc.transcript.length ? "Resume" : "Start recording"}
                  </Button>
                ) : (
                  <Button variant="secondary" onClick={() => recStop()}>
                    <Square size={14} /> Pause
                  </Button>
                )}
                <Button onClick={() => void finish()} disabled={!enc.transcript.length}>
                  <Sparkles size={16} /> End & get recommendations
                </Button>
              </div>
            </div>

            <TranscriptView segments={enc.transcript} interim={interim} />

            <div className="flex items-center gap-4 border-t border-slate-100 px-5 py-2.5 text-xs text-slate-500">
              {recording && (
                <video ref={videoRef} className="h-12 w-20 rounded bg-slate-900 object-cover" playsInline aria-label="Camera preview" />
              )}
              {enc.documents.length > 0 && (
                <span className="flex items-center gap-1">
                  <FileText size={13} /> {enc.documents.length} document{enc.documents.length > 1 ? "s" : ""}
                </span>
              )}
              {recError && <span className="text-red-600">{recError}</span>}
              {genError && <span className="text-red-600">{genError}</span>}
              {videoStatus && <span>{videoStatus}</span>}
              {!aiOn && <span className="text-amber-700">No AI model configured: the chart won&apos;t fill in automatically.</span>}
            </div>
          </Card>

          <Card className="lg:sticky lg:top-20 lg:self-start">
            <CardHeader
              title="Chart"
              subtitle={
                syncError
                  ? `Update failed: ${syncError}`
                  : missing.length
                    ? `Still needed: ${missing.map((k) => REQUIRED_LABELS[k] ?? k).join(", ")}`
                    : "✓ Ready for recommendations"
              }
              right={
                <div className="flex items-center gap-1">
                  {syncing && <Loader2 size={14} className="animate-spin text-slate-400" />}
                  <button className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100" onClick={() => setEditing(true)} aria-label="Edit chart">
                    <Pencil size={14} />
                  </button>
                </div>
              }
            />
            <div className="p-5">
              <LiveChart patient={patient} encounter={enc} trials={bundle.trials ?? []} />
            </div>
          </Card>
        </div>
      )}

      {/* -------------------------------------------------------- GENERATING */}
      {phase === "generating" && (
        <Card className="mx-auto max-w-xl p-10 text-center">
          <Loader2 size={28} className="mx-auto animate-spin text-brand-600" />
          <h2 className="mt-4 text-lg font-semibold">Finding the best medications for {patient.first_name ?? "this patient"}</h2>
          {enc.live_state?.diagnosis_quote && <p className="mt-2 text-sm italic text-slate-500">Heard: &ldquo;{enc.live_state.diagnosis_quote}&rdquo;</p>}
          <ol className="mx-auto mt-6 max-w-sm space-y-2 text-left text-sm">
            {STEPS.map((s, i) => (
              <li key={s} className={clsx("flex items-center gap-2", i < step ? "text-slate-400" : i === step ? "font-medium text-ink" : "text-slate-300")}>
                {i < step ? "✓" : i === step ? <Loader2 size={12} className="animate-spin" /> : "·"} {s}
              </li>
            ))}
          </ol>
        </Card>
      )}

      {/* ----------------------------------------------------------- RESULTS */}
      {phase === "results" && (
        <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_340px]">
          <div className="space-y-5">
            {!rx && (
              <>
                {enc.plan?.mode === "dual" ? (
                  <>
                    <div className="flex flex-wrap items-end gap-3">
                      <p className="text-sm text-slate-500">
                        {bundle.run?.engine === "ai" ? `Ranked by ${bundle.run.model} from the rule-engine shortlist` : "Ranked by the rule engine"}
                        {enc.live_state?.diagnosis_quote ? <> · diagnosis heard: &ldquo;{enc.live_state.diagnosis_quote}&rdquo;</> : null}
                      </p>
                      <Button variant="secondary" className="ml-auto" onClick={() => setChoice({ rec: null, override: true })}>
                        <UserCog size={16} /> Write my own prescription
                      </Button>
                    </div>
                    {choice?.override ? (
                      <DecisionPanel key="override" encounterId={encId} rec={null} override meds={meds} onCancel={() => setChoice(null)} onDone={refresh} />
                    ) : (
                      <TwoPillFlow
                        encounterId={encId}
                        plan={enc.plan}
                        first={bundle.recommendations}
                        second={bundle.second ?? []}
                        run={bundle.run}
                        run2={bundle.run2 ?? null}
                        medById={medById}
                        onRefresh={refresh}
                      />
                    )}
                  </>
                ) : (
                <>
                {enc.plan?.mode === "add_on" && (
                  <Card className="border-brand-200 bg-brand-50/60 p-4 text-sm">
                    <p className="font-medium text-brand-700">Add-on to current medication</p>
                    <p className="mt-1 text-slate-700">{enc.plan.reason}</p>
                  </Card>
                )}
                <div className="flex flex-wrap items-end gap-3">
                  <div>
                    <h2 className="text-lg font-semibold">{enc.plan?.mode === "add_on" ? "Top 3 add-on options" : "Top 3 for this patient"}</h2>
                    <p className="text-sm text-slate-500">
                      {bundle.run?.engine === "ai" ? `Ranked by ${bundle.run.model} from the rule-engine shortlist` : "Ranked by the rule engine"}
                      {enc.live_state?.diagnosis_quote ? <> · diagnosis heard: &ldquo;{enc.live_state.diagnosis_quote}&rdquo;</> : null}
                    </p>
                  </div>
                  <Button variant="secondary" className="ml-auto" onClick={() => setChoice({ rec: null, override: true })}>
                    <UserCog size={16} /> Write my own prescription
                  </Button>
                </div>
                {bundle.run?.clinical_note && (
                  <Card className="border-sky-200 bg-sky-50/60 p-4 text-sm leading-relaxed text-slate-700">
                    <p className="whitespace-pre-line">{bundle.run.clinical_note}</p>
                  </Card>
                )}
                <div className="grid gap-4 lg:grid-cols-3">
                  {bundle.recommendations.map((r) => (
                    <RecCard
                      key={r.id}
                      rec={r}
                      med={medById.get(r.medication_id)}
                      evidence={candById.get(r.medication_id)?.fired ?? []}
                      line={candById.get(r.medication_id)?.line_of_therapy}
                      selected={choice?.rec?.id === r.id}
                      onChoose={() => {
                        setChoice({ rec: r, override: false });
                        setTimeout(() => document.getElementById("decision")?.scrollIntoView({ behavior: "smooth" }), 50);
                      }}
                    />
                  ))}
                </div>
                {choice && (
                  <DecisionPanel
                    key={choice.override ? "override" : choice.rec?.id}
                    encounterId={encId}
                    rec={choice.rec}
                    med={choice.rec ? medById.get(choice.rec.medication_id) : undefined}
                    override={choice.override}
                    meds={meds}
                    onCancel={() => setChoice(null)}
                    onDone={refresh}
                  />
                )}
                {bundle.run && <Excluded items={bundle.run.excluded} />}
                </>
                )}
              </>
            )}
            {rx && (
              <RxTracker
                rx={rx}
                group={rx.order_group ? bundle.prescriptions.filter((x) => x.order_group === rx.order_group) : [rx]}
                medById={medById}
                med={rx.medication_id ? medById.get(rx.medication_id) : undefined}
                patient={patient}
                messages={bundle.messages.filter((m) => (rx.order_group ? bundle.prescriptions.some((x) => x.order_group === rx.order_group && x.id === m.prescription_id) : m.prescription_id === rx.id))}
                onChanged={refresh}
              />
            )}
          </div>

          <aside className="space-y-5">
            <Card>
              <CardHeader
                title="Chart from this visit"
                right={
                  !rx && (
                    <Button variant="ghost" onClick={() => setEditing(true)}>
                      <Pencil size={14} /> Edit
                    </Button>
                  )
                }
              />
              <div className="p-5">
                <LiveChart patient={patient} encounter={enc} trials={bundle.trials ?? []} />
              </div>
            </Card>
            <InsurancePanel
              encounterId={encId}
              patient={patient}
              packets={bundle.priorAuths ?? []}
              prescriptions={bundle.prescriptions}
              medById={medById}
              onChanged={refresh}
            />
            <Card>
              <button className="flex w-full items-center gap-2 px-5 py-3 text-left text-sm font-medium" onClick={() => setShowTranscript((s) => !s)} aria-expanded={showTranscript}>
                Transcript ({enc.transcript.length} lines)
                <ChevronDown size={16} className={clsx("ml-auto transition-transform", showTranscript && "rotate-180")} />
              </button>
              {showTranscript && (
                <div className="max-h-96 space-y-1.5 overflow-y-auto border-t border-slate-100 px-5 py-3 text-sm text-slate-700">
                  {enc.transcript.map((s, i) => (
                    <p key={i}>{s.text}</p>
                  ))}
                  {enc.video_path && (
                    <video src={`/api/encounters/${encId}/media?path=${encodeURIComponent(enc.video_path)}`} controls className="mt-3 w-full rounded-lg" />
                  )}
                </div>
              )}
            </Card>
          </aside>
        </div>
      )}

      {editing && (
        <ChartEditor
          patient={patient}
          encounter={enc}
          onClose={() => setEditing(false)}
          saveLabel={phase === "results" && !rx ? "Save & regenerate" : "Save chart"}
          onSaved={async (p, e) => {
            // Only re-rank when something that affects drug choice changed (not name/phone/address)
            const clinical = (x: Patient, v: Pick<Encounter, "vitals" | "labs">) =>
              JSON.stringify([x.date_of_birth, x.sex, x.ethnicity, x.height_cm, x.weight_kg, x.pregnancy_status, [...x.conditions].sort(), x.current_medications, x.allergies, v.vitals, v.labs]);
            const changed = clinical(patient, enc) !== clinical(p, e);
            setPatient(p);
            setEnc((cur) => ({ ...cur, ...e }));
            setEditing(false);
            if (phase === "results" && !rx && changed) {
              setPhase("generating");
              const r = await fetch(`/api/encounters/${encId}/generate`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
              if (!r.ok) setGenError((await r.json()).error ?? "Regenerate failed");
              await refresh();
              setChoice(null);
              setPhase("results");
            }
          }}
        />
      )}
      {phase === "results" && !rx && genError && (
        <p className="mt-4 flex items-center gap-2 text-sm text-red-600">
          <RefreshCw size={14} /> {genError}
        </p>
      )}
    </div>
  );
}

function TranscriptView({ segments, interim }: { segments: TranscriptSegment[]; interim: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.scrollTo({ top: ref.current.scrollHeight, behavior: "smooth" });
  }, [segments.length, interim]);
  return (
    <div ref={ref} className="flex-1 space-y-3 overflow-y-auto px-6 py-5 text-[15px] leading-relaxed" aria-live="polite">
      {segments.length === 0 && !interim && <p className="pt-24 text-center text-slate-400">The conversation will appear here as you talk.</p>}
      {segments.map((s, i) => (
        <p key={i} className="text-slate-800">
          <span className="mr-2 font-mono text-[11px] text-slate-400">{fmt(s.t)}</span>
          {s.text}
        </p>
      ))}
      {interim && <p className="italic text-slate-400">{interim}</p>}
    </div>
  );
}
