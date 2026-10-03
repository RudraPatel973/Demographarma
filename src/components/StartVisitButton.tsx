"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Mic } from "lucide-react";
import { Button } from "./ui";

export function StartVisitButton({ patientId }: { patientId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  return (
    <Button
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        const r = await fetch("/api/encounters", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ patient_id: patientId }) });
        const j = await r.json();
        if (r.ok) router.push(`/visits/${j.id}?autostart=1`);
        else setBusy(false);
      }}
    >
      {busy ? <Loader2 size={16} className="animate-spin" /> : <Mic size={16} />} Start new visit
    </Button>
  );
}
