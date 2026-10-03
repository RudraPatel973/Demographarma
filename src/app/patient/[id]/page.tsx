import { notFound } from "next/navigation";
import { db } from "@/lib/supabase";
import { supabaseConfigured } from "@/lib/config";
import { SetupNotice } from "@/components/SetupNotice";
import { AutoRefresh } from "@/components/AutoRefresh";
import type { PatientMessage } from "@/lib/types";

export const dynamic = "force-dynamic";

/** What the patient sees: the texts Photon sends them (orange in the diagram). */
export default async function PatientPhone({ params }: PageProps<"/patient/[id]">) {
  if (!supabaseConfigured()) return <SetupNotice />;
  const { id } = await params;
  const { data: patient } = await db().from("patients").select("first_name,phone").eq("id", id).maybeSingle();
  if (!patient) notFound();
  const { data } = await db().from("patient_messages").select("*").eq("patient_id", id).order("created_at");
  const messages = (data ?? []) as PatientMessage[];

  return (
    <div className="flex min-h-[calc(100vh-3.5rem)] items-center justify-center bg-slate-100 px-4 py-10">
      <AutoRefresh seconds={4} />
      <div className="w-full max-w-[360px] rounded-[2.5rem] border-[10px] border-slate-900 bg-white shadow-2xl">
        <div className="mx-auto mt-2 h-5 w-28 rounded-full bg-slate-900" />
        <div className="border-b border-slate-100 px-4 pb-3 pt-4 text-center">
          <div className="mx-auto grid h-10 w-10 place-items-center rounded-full bg-orange-500 text-sm font-semibold text-white">Rx</div>
          <p className="mt-1 text-sm font-medium">Photon Health</p>
          <p className="text-[11px] text-slate-500">to {patient.first_name ?? "patient"} · {patient.phone ?? "no phone on file"}</p>
        </div>
        <div className="h-[460px] space-y-2 overflow-y-auto bg-slate-50 px-3 py-4">
          {messages.length === 0 && <p className="pt-20 text-center text-sm text-slate-400">No messages yet</p>}
          {messages.map((m) => (
            <div key={m.id}>
              <p className="mb-0.5 text-center text-[10px] text-slate-400">{new Date(m.created_at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</p>
              <div className="max-w-[85%] rounded-2xl rounded-bl-sm bg-white px-3 py-2 text-sm text-slate-800 shadow-sm ring-1 ring-slate-200">{m.body}</div>
            </div>
          ))}
        </div>
        <div className="flex items-center gap-2 rounded-b-[1.8rem] border-t border-slate-100 px-3 py-3">
          <div className="flex-1 rounded-full bg-slate-100 px-3 py-1.5 text-xs text-slate-400">Text message</div>
        </div>
      </div>
    </div>
  );
}
