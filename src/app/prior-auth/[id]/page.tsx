import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/supabase";
import { supabaseConfigured } from "@/lib/config";
import { SetupNotice } from "@/components/SetupNotice";
import { PriorAuthControls } from "@/components/PriorAuthControls";
import { LocalTime } from "@/components/History";
import { CompletePacket } from "@/components/CompletePacket";

export const dynamic = "force-dynamic";

type Form = {
  request_type: string;
  patient: { name: string; date_of_birth: string | null; sex: string | null; phone: string | null; address: string | null };
  insurance: { plan: string | null; payer?: string | null; plan_id: string | null; member_id: string | null; group_number: string | null };
  prescriber?: { name: string | null; npi: string | null; practice: string | null; phone: string | null; fax: string | null; address: string | null; email: string | null };
  adherence?: string | null;
  lifestyle?: string | null;
  medication: { name: string; strength_mg: number | null; directions: string | null; quantity: number; days_supply: number; formulary_status: string };
  diagnosis: { icd10: string; name: string };
  blood_pressure_readings: { date: string; bp: string; heart_rate: number | null }[];
  labs: Record<string, number | null>;
  medications_tried: { trial_id?: string; drug: string; dose_mg: number | null; start: string | null; end: string | null; outcome: string; detail: string | null }[];
  contraindicated_alternatives: { drug: string; class: string; reason: string }[];
  other_alternatives_unsuitable: { drug: string; reason: string }[];
  allergies: string[];
  criteria: string[];
  missing_items?: string[];
};

const TITLE: Record<string, string> = {
  prior_authorization: "Prior Authorization Request",
  step_therapy_exception: "Step Therapy Exception Request",
  formulary_exception: "Formulary Exception Request",
};

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[160px_1fr] gap-3 border-b border-slate-100 py-1.5 text-sm">
      <span className="text-slate-500">{label}</span>
      <span>{value || <span className="text-amber-700">[missing]</span>}</span>
    </div>
  );
}

export default async function PriorAuthPage({ params }: PageProps<"/prior-auth/[id]">) {
  if (!supabaseConfigured()) return <SetupNotice />;
  const { id } = await params;
  const { data: pa } = await db().from("prior_auths").select("*").eq("id", id).maybeSingle();
  if (!pa) notFound();
  const f = pa.form as Form;

  return (
    <div className="mx-auto max-w-4xl px-4 py-8 print:max-w-none print:p-0">
      <div className="mb-6 flex flex-wrap items-center gap-3 print:hidden">
        <Link href={`/visits/${pa.encounter_id}`} className="text-sm text-sky-700 hover:underline">
          ← Back to visit
        </Link>
        <PriorAuthControls id={pa.id} status={pa.status} letter={pa.letter ?? ""} />
      </div>

      <article className="space-y-6 rounded-xl border border-slate-200 bg-white p-8 shadow-sm print:border-0 print:shadow-none">
        <header className="border-b border-slate-200 pb-4">
          <p className="text-xs uppercase tracking-wide text-slate-500">{f.insurance.plan ?? "Insurance plan"}</p>
          <h1 className="text-2xl font-semibold">{TITLE[pa.request_type] ?? "Coverage Request"}</h1>
          <p className="text-sm text-slate-500">
            {pa.drug_label} · prepared <LocalTime iso={pa.created_at} mode="date" />
          </p>
        </header>

        {f.missing_items && f.missing_items.length > 0 ? (
          <CompletePacket
            id={pa.id}
            missing={f.missing_items}
            trials={f.medications_tried}
            needMember={!f.insurance.member_id}
            needAdherence={!f.adherence}
          />
        ) : (
          <p className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm font-medium text-emerald-800 print:hidden">✓ Packet complete — ready to submit.</p>
        )}

        <section>
          <h2 className="mb-2 font-semibold">Patient</h2>
          <Row label="Name" value={f.patient.name} />
          <Row label="Date of birth" value={f.patient.date_of_birth} />
          <Row label="Sex" value={f.patient.sex?.toLowerCase()} />
          <Row label="Phone" value={f.patient.phone} />
          <Row label="Address" value={f.patient.address} />
        </section>

        <section>
          <h2 className="mb-2 font-semibold">Insurance</h2>
          <Row label="Payer" value={f.insurance.payer} />
          <Row label="Plan" value={f.insurance.plan} />
          <Row label="Plan ID" value={f.insurance.plan_id} />
          <Row label="Member ID" value={f.insurance.member_id} />
          <Row label="Group #" value={f.insurance.group_number} />
        </section>

        <section>
          <h2 className="mb-2 font-semibold">Prescriber</h2>
          <Row label="Name" value={f.prescriber?.name} />
          <Row label="NPI" value={f.prescriber?.npi} />
          <Row label="Practice" value={f.prescriber?.practice} />
          <Row label="Address" value={f.prescriber?.address} />
          <Row label="Phone" value={f.prescriber?.phone} />
          <Row label="Fax" value={f.prescriber?.fax} />
        </section>

        <section>
          <h2 className="mb-2 font-semibold">Medication requested</h2>
          <Row label="Drug" value={<span className="capitalize">{f.medication.name}</span>} />
          <Row label="Directions" value={f.medication.directions} />
          <Row label="Quantity / days" value={`${f.medication.quantity} / ${f.medication.days_supply} days`} />
          <Row label="Formulary status" value={f.medication.formulary_status} />
        </section>

        <section>
          <h2 className="mb-2 font-semibold">Clinical information</h2>
          <Row label="Diagnosis" value={`${f.diagnosis.icd10} — ${f.diagnosis.name}`} />
          <Row label="BP readings" value={f.blood_pressure_readings.map((r) => `${r.date}: ${r.bp}`).join(" · ")} />
          <Row
            label="Labs"
            value={Object.entries(f.labs ?? {})
              .filter(([, v]) => v != null)
              .map(([k, v]) => `${k.toUpperCase()} ${v}`)
              .join(" · ")}
          />
          <Row label="Allergies" value={f.allergies.join("; ") || "None reported"} />
          <Row label="Adherence" value={f.adherence} />
          <Row label="Lifestyle measures" value={f.lifestyle ?? "Not discussed"} />
        </section>

        <section>
          <h2 className="mb-2 font-semibold">Medications tried</h2>
          {f.medications_tried.length ? (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-slate-500">
                  <th className="py-1">Drug</th>
                  <th>Dates</th>
                  <th>Outcome</th>
                  <th>Detail</th>
                </tr>
              </thead>
              <tbody>
                {f.medications_tried.map((t, i) => (
                  <tr key={i} className="border-t border-slate-100">
                    <td className="py-1.5 capitalize">{t.drug}</td>
                    <td>{[t.start, t.end].filter(Boolean).join(" – ") || <span className="text-amber-700">[start date]</span>}</td>
                    <td className="capitalize">{t.outcome}</td>
                    <td>{t.detail}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="text-sm text-amber-700">No prior medications documented.</p>
          )}
        </section>

        {(f.contraindicated_alternatives.length > 0 || f.other_alternatives_unsuitable.length > 0) && (
          <section>
            <h2 className="mb-2 font-semibold">Why preferred alternatives can&apos;t be used</h2>
            <ul className="ml-4 list-disc space-y-1 text-sm">
              {f.contraindicated_alternatives.map((c, i) => (
                <li key={`c${i}`}>
                  <span className="capitalize">{c.drug}</span> ({c.class}): contraindicated — {c.reason}
                </li>
              ))}
              {f.other_alternatives_unsuitable.map((c, i) => (
                <li key={`u${i}`}>
                  <span className="capitalize">{c.drug}</span>: {c.reason}
                </li>
              ))}
            </ul>
          </section>
        )}

        <section>
          <h2 className="mb-2 font-semibold">Letter of medical necessity</h2>
          <div className="whitespace-pre-wrap rounded-lg bg-slate-50 p-4 text-sm leading-relaxed print:bg-white print:p-0">
            {pa.letter ?? "No AI model configured — write the letter here before submitting."}
          </div>
        </section>
      </article>
    </div>
  );
}
