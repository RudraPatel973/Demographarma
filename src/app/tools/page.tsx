import clsx from "clsx";
import { ArrowRight, Bot, Brain, Check, Database, ExternalLink, Plug, Plus } from "lucide-react";
import { Badge, Card } from "@/components/ui";
import { INTEGRATIONS, STAGES, STATUS_LABEL, type Integration, type Kind, type Status } from "@/lib/integrations";

export const metadata = { title: "AI tools & integrations · Volution" };

const KIND_ICON: Record<Kind, typeof Bot> = { "AI model": Brain, "AI agent": Bot, "Data source": Database, Service: Plug };
const STATUS_TONE: Record<Status, "brand" | "blue" | "slate"> = { integrated: "brand", available: "blue", planned: "slate" };
const STATUS_ORDER: Record<Status, number> = { integrated: 0, available: 1, planned: 2 };

const count = (s: Status) => INTEGRATIONS.filter((i) => i.status === s).length;

export default function ToolsPage() {
  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">AI tools & integrations</h1>
        <p className="mt-1 max-w-2xl text-sm text-slate-500">
          Every step of a visit is a slot. Volution already runs these tools in them, and a clinic can plug in more as it needs them.
        </p>
        <p className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-sm">
          <span>
            <span className="font-semibold text-brand-700">{count("integrated")}</span> integrated
          </span>
          <span>
            <span className="font-semibold text-sky-700">{count("available")}</span> available to add
          </span>
          <span>
            <span className="font-semibold text-slate-700">{count("planned")}</span> planned
          </span>
        </p>
      </div>

      {/* Pipeline: one chip per stage of the visit */}
      <nav aria-label="Visit stages" className="mb-8 flex flex-wrap items-center gap-2">
        {STAGES.map((s, i) => {
          const n = INTEGRATIONS.filter((x) => x.stage === s.key && x.status === "integrated").length;
          return (
            <span key={s.key} className="flex items-center gap-2">
              <a href={`#${s.key}`} className="flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-sm hover:border-brand-500">
                <span className="font-medium">{s.label}</span>
                <span className="rounded-full bg-brand-50 px-1.5 text-xs font-medium text-brand-700">{n}</span>
              </a>
              {i < STAGES.length - 1 && <ArrowRight size={14} className="text-slate-300" aria-hidden />}
            </span>
          );
        })}
      </nav>

      <div className="space-y-10">
        {STAGES.map((s) => {
          const items = INTEGRATIONS.filter((x) => x.stage === s.key).sort((a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status]);
          return (
            <section key={s.key} id={s.key} className="scroll-mt-20">
              <h2 className="text-lg font-semibold">{s.label}</h2>
              <p className="mb-3 text-sm text-slate-500">{s.blurb}</p>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {items.map((it) => (
                  <ToolCard key={it.id} it={it} />
                ))}
              </div>
            </section>
          );
        })}

        <AddATool />
      </div>
    </div>
  );
}

function ToolCard({ it }: { it: Integration }) {
  const Icon = KIND_ICON[it.kind];
  const muted = it.status !== "integrated";
  return (
    <Card className={clsx("flex flex-col p-5", it.featured && "sm:col-span-2 lg:col-span-3", muted && "bg-slate-50/60")}>
      <div className="flex items-start gap-3">
        <span className={clsx("grid h-9 w-9 shrink-0 place-items-center rounded-lg", muted ? "bg-slate-100 text-slate-500" : "bg-brand-50 text-brand-700")}>
          <Icon size={18} />
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="font-semibold leading-tight">{it.name}</h3>
          {it.vendor && <p className="text-xs text-slate-500">{it.vendor}</p>}
        </div>
        <Badge tone={STATUS_TONE[it.status]}>{STATUS_LABEL[it.status]}</Badge>
      </div>

      <p className="mt-3 text-sm text-slate-700">{it.summary}</p>

      <div className={clsx("mt-3", it.featured && "grid gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]")}>
        {it.capabilities && (
          <ul className="space-y-1.5 text-sm text-slate-700">
            {it.capabilities.map((c) => (
              <li key={c} className="flex gap-2">
                <Check size={15} className="mt-0.5 shrink-0 text-brand-600" /> {c}
              </li>
            ))}
          </ul>
        )}
        <dl className="space-y-1.5 text-xs">
          <div>
            <dt className="inline font-medium text-slate-500">Takes </dt>
            <dd className="inline text-slate-700">{it.inputs.join(", ")}</dd>
          </div>
          <div>
            <dt className="inline font-medium text-slate-500">Gives </dt>
            <dd className="inline text-slate-700">{it.outputs.join(", ")}</dd>
          </div>
          <div>
            <dt className="inline font-medium text-slate-500">Review </dt>
            <dd className="inline text-slate-700">{it.review}</dd>
          </div>
        </dl>
      </div>

      <div className="mt-auto flex items-center gap-2 pt-4 text-xs text-slate-400">
        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-slate-600">{it.kind}</span>
        {it.link && (
          <a href={it.link} target="_blank" rel="noreferrer" className="ml-auto inline-flex items-center gap-1 hover:text-ink hover:underline">
            Docs <ExternalLink size={12} />
          </a>
        )}
      </div>
    </Card>
  );
}

function AddATool() {
  const steps = [
    { title: "Implement the interface", body: "A tool takes a visit input and returns observations with a value, confidence and model version. Video (check-in) is wired today; audio, documents and chart data follow the same pattern." },
    { title: "Register it", body: "List it alongside the other models in the inference layer, next to the camera vitals model." },
    { title: "Choose how it's reviewed", body: "Add its output to the chart automatically with its source shown, or wait for the clinician to approve it." },
  ];
  return (
    <section aria-labelledby="add-tool" className="rounded-2xl border-2 border-dashed border-slate-300 p-6">
      <div className="flex items-center gap-3">
        <span className="grid h-9 w-9 place-items-center rounded-lg bg-slate-900 text-white">
          <Plus size={18} />
        </span>
        <div>
          <h2 id="add-tool" className="text-lg font-semibold">
            Add a tool
          </h2>
          <p className="text-sm text-slate-500">Any model or service your clinic uses can plug into a visit step in three steps.</p>
        </div>
      </div>
      <ol className="mt-5 grid gap-4 md:grid-cols-3">
        {steps.map((s, i) => (
          <li key={s.title} className="rounded-xl bg-white p-4 ring-1 ring-slate-200">
            <p className="text-xs font-semibold text-brand-700">Step {i + 1}</p>
            <p className="mt-1 font-medium">{s.title}</p>
            <p className="mt-1 text-sm text-slate-600">{s.body}</p>
          </li>
        ))}
      </ol>
      <p className="mt-4 text-xs text-slate-500">Every reading from a plugged-in model is stored with the model&apos;s name, version and confidence, so a value in the chart can be traced back to what produced it.</p>
    </section>
  );
}
