import { notFound } from "next/navigation";
import { getEncounterBundle, listDiagnoses, listMedications } from "@/lib/data";
import { supabaseConfigured } from "@/lib/config";
import { llmProvider } from "@/lib/llm";
import { SetupNotice } from "@/components/SetupNotice";
import { VisitWorkspace, type Bundle } from "@/components/VisitWorkspace";

export const dynamic = "force-dynamic";

export default async function VisitPage({ params, searchParams }: PageProps<"/visits/[id]">) {
  if (!supabaseConfigured()) return <SetupNotice />;
  const { id } = await params;
  const sp = await searchParams;
  let bundle: Bundle;
  try {
    bundle = (await getEncounterBundle(id)) as unknown as Bundle;
  } catch {
    notFound();
  }
  const [diagnoses, meds] = await Promise.all([listDiagnoses(), listMedications()]);
  return (
    <VisitWorkspace
      initial={bundle}
      diagnoses={diagnoses}
      meds={meds}
      aiOn={Boolean(llmProvider())}
      autostart={sp.autostart === "1"}
      liveDebounceMs={Number(process.env.LIVE_SYNC_DEBOUNCE_MS ?? 1200)}
    />
  );
}
