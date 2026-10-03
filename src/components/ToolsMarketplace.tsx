"use client";

import { useState } from "react";
import clsx from "clsx";
import {
  Activity,
  BellRing,
  Bot,
  Check,
  ClipboardList,
  Dna,
  ExternalLink,
  FileSignature,
  FileText,
  Gauge,
  HeartPulse,
  Layers,
  ListChecks,
  MapPin,
  MessageSquareText,
  Mic,
  Plug,
  Plus,
  Send,
  ShieldCheck,
  Sparkles,
  Store,
  X,
  type LucideIcon,
} from "lucide-react";
import { Button } from "./ui";
import { INTEGRATIONS, STAGES, type Integration, type Stage, type Status } from "@/lib/integrations";

const ICON: Record<string, LucideIcon> = {
  camera_vitals: HeartPulse,
  bp_cuff: Gauge,
  intake_agent: ClipboardList,
  ambient_scribe: Mic,
  document_reader: FileText,
  medical_scribe: Bot,
  rule_engine: ListChecks,
  ai_ranking: Sparkles,
  coverage: ShieldCheck,
  combinations: Layers,
  interactions: Activity,
  pgx: Dna,
  photon: Send,
  prior_auth: FileSignature,
  geocoder: MapPin,
  price_compare: Store,
  patient_updates: MessageSquareText,
  remote_bp: Gauge,
  adherence: BellRing,
};

// One colour per visit step, used for icon tiles and slot headers
const STAGE_TONE: Record<Stage, { tile: string; ring: string; dot: string }> = {
  check_in: { tile: "bg-rose-100 text-rose-700", ring: "ring-rose-200", dot: "bg-rose-500" },
  visit: { tile: "bg-violet-100 text-violet-700", ring: "ring-violet-200", dot: "bg-violet-500" },
  decision: { tile: "bg-amber-100 text-amber-700", ring: "ring-amber-200", dot: "bg-amber-500" },
  prescribe: { tile: "bg-brand-100 text-brand-700", ring: "ring-brand-200", dot: "bg-brand-500" },
  follow_up: { tile: "bg-sky-100 text-sky-700", ring: "ring-sky-200", dot: "bg-sky-500" },
};

const FILTERS: { key: "all" | Status; label: string }[] = [
  { key: "all", label: "All" },
  { key: "integrated", label: "Integrated" },
  { key: "available", label: "Ready to plug in" },
  { key: "planned", label: "Coming soon" },
];

const CONNECT_STEPS = [
  "Wrap the tool in the inference-layer interface: visit input in, observations out.",
  "Register it next to the other models; it appears in its visit step.",
  "Pick its review rule: into the chart with its source shown, or clinician approves first.",
];

const count = (s: Status) => INTEGRATIONS.filter((i) => i.status === s).length;

function ToolIcon({ it, size = "md" }: { it: Integration; size?: "sm" | "md" | "lg" }) {
  const Icon = ICON[it.id] ?? Plug;
  return (
    <span
      className={clsx(
        "grid shrink-0 place-items-center rounded-xl",
        STAGE_TONE[it.stage].tile,
        it.status === "planned" && "opacity-60",
        size === "sm" && "h-7 w-7 rounded-lg",
        size === "md" && "h-11 w-11",
        size === "lg" && "h-14 w-14 rounded-2xl",
      )}
    >
      <Icon size={size === "sm" ? 14 : size === "md" ? 20 : 26} />
    </span>
  );
}

function StatusPill({ status }: { status: Status }) {
  if (status === "integrated")
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-700">
        <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" /> Integrated
      </span>
    );
  if (status === "planned") return <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-500">Coming soon</span>;
  return null;
}

/** App-store style view of the tools that plug into each step of a visit. */
export function ToolsMarketplace() {
  const [filter, setFilter] = useState<"all" | Status>("all");
  const [stage, setStage] = useState<"all" | Stage>("all");
  // Available tools the viewer has plugged into the preview stack (not saved anywhere)
  const [plugged, setPlugged] = useState<Set<string>>(new Set());
  const [open, setOpen] = useState<Integration | null>(null);

  const toggle = (id: string) =>
    setPlugged((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  const featured = INTEGRATIONS.find((i) => i.featured);
  const library = INTEGRATIONS.filter((i) => (filter === "all" || i.status === filter) && (stage === "all" || i.stage === stage) && !(i.featured && filter === "all" && stage === "all"));

  function browse(s: Stage) {
    setStage(s);
    setFilter("available");
    document.getElementById("library")?.scrollIntoView({ behavior: "smooth" });
  }

  return (
    <div className="mx-auto max-w-7xl px-4 py-8">
      {/* ------------------------------------------------------------ STACK */}
      <div className="mb-6 flex flex-wrap items-end gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Your clinic&apos;s stack</h1>
          <p className="mt-1 max-w-2xl text-sm text-slate-500">Every step of a visit is a slot. Plug in the tools your clinic needs; they work together from check-in to pickup.</p>
        </div>
        <div className="ml-auto flex gap-2 text-xs">
          <span className="rounded-full bg-emerald-50 px-3 py-1.5 font-medium text-emerald-700">{count("integrated")} integrated</span>
          <span className="rounded-full bg-white px-3 py-1.5 font-medium text-slate-700 ring-1 ring-slate-200">{count("available")} ready to plug in</span>
          <span className="rounded-full bg-white px-3 py-1.5 font-medium text-slate-500 ring-1 ring-slate-200">{count("planned")} coming soon</span>
        </div>
      </div>

      <div className="relative grid grid-cols-1 gap-3 lg:grid-cols-5">
        {/* the "wire" the slots hang off */}
        <div className="pointer-events-none absolute left-8 right-8 top-[22px] hidden h-0.5 bg-slate-200 lg:block" aria-hidden />
        {STAGES.map((s, i) => {
          const tools = INTEGRATIONS.filter((x) => x.stage === s.key && (x.status === "integrated" || plugged.has(x.id)));
          return (
            <section key={s.key} className="relative flex min-w-0 flex-col" aria-label={`${s.label} slot`}>
              <div className="mb-2 flex items-center gap-2">
                <span className={clsx("relative z-10 grid h-11 w-11 place-items-center rounded-full bg-white text-sm font-semibold ring-4 ring-slate-50", STAGE_TONE[s.key].tile)}>{i + 1}</span>
                <span className="font-semibold">{s.label}</span>
              </div>
              <div className={clsx("flex flex-1 flex-col gap-2 rounded-2xl bg-white p-2.5 ring-1", STAGE_TONE[s.key].ring)}>
                {tools.map((t) => {
                  const preview = t.status !== "integrated";
                  return (
                    <div
                      key={t.id}
                      className={clsx(
                        "flex items-center rounded-xl transition",
                        preview ? "border border-dashed border-slate-300 bg-slate-50" : "bg-slate-50 hover:bg-slate-100",
                      )}
                    >
                      <button onClick={() => setOpen(t)} className="flex min-w-0 flex-1 items-center gap-2.5 p-2 text-left">
                        <ToolIcon it={t} size="sm" />
                        <span className="min-w-0 flex-1">
                          <span className="block text-sm font-medium leading-snug">{t.name}</span>
                          <span className="block truncate text-[11px] text-slate-500">{preview ? "Preview · not connected" : t.vendor ?? t.kind}</span>
                        </span>
                      </button>
                      {preview ? (
                        <button onClick={() => toggle(t.id)} aria-label={`Unplug ${t.name}`} className="mr-1.5 rounded-md p-1 text-slate-400 hover:bg-white hover:text-ink">
                          <X size={13} />
                        </button>
                      ) : (
                        <span className="mr-3 h-2 w-2 shrink-0 rounded-full bg-emerald-500" title="Integrated" />
                      )}
                    </div>
                  );
                })}
                <button
                  onClick={() => browse(s.key)}
                  className="mt-auto flex items-center justify-center gap-1.5 rounded-xl border border-dashed border-slate-300 py-2.5 text-xs font-medium text-slate-500 transition hover:border-brand-500 hover:text-brand-700"
                >
                  <Plus size={14} /> Plug in a tool
                </button>
              </div>
            </section>
          );
        })}
      </div>

      {/* ---------------------------------------------------------- LIBRARY */}
      <div id="library" className="mt-12 scroll-mt-20">
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <h2 className="text-lg font-semibold">Tool library</h2>
          <div className="flex max-w-full overflow-x-auto rounded-lg bg-slate-100 p-0.5 text-sm" role="tablist" aria-label="Filter by status">
            {FILTERS.map((f) => (
              <button
                key={f.key}
                role="tab"
                aria-selected={filter === f.key}
                onClick={() => setFilter(f.key)}
                className={clsx("whitespace-nowrap rounded-md px-3 py-1", filter === f.key ? "bg-white font-medium shadow-sm" : "text-slate-600 hover:text-ink")}
              >
                {f.label}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap gap-1.5 text-xs" aria-label="Filter by visit step">
            {[{ key: "all" as const, label: "Every step" }, ...STAGES].map((s) => (
              <button
                key={s.key}
                onClick={() => setStage(s.key)}
                className={clsx("rounded-full px-2.5 py-1 ring-1", stage === s.key ? "bg-slate-900 text-white ring-slate-900" : "bg-white text-slate-600 ring-slate-200 hover:ring-slate-400")}
              >
                {s.label}
              </button>
            ))}
          </div>
        </div>

        {featured && filter === "all" && stage === "all" && (
          <button
            onClick={() => setOpen(featured)}
            className="mb-4 grid w-full gap-5 overflow-hidden rounded-2xl bg-linear-to-br from-brand-700 to-brand-500 p-6 text-left text-white shadow-sm md:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]"
          >
            <div>
              <span className="text-[11px] font-semibold uppercase tracking-wider text-white/70">Featured integration</span>
              <div className="mt-2 flex items-center gap-3">
                <span className="grid h-12 w-12 place-items-center rounded-2xl bg-white/15">
                  <Send size={22} />
                </span>
                <div>
                  <p className="text-xl font-semibold">{featured.vendor}</p>
                  <p className="text-sm text-white/80">{featured.name}</p>
                </div>
              </div>
              <p className="mt-3 text-sm text-white/90">{featured.summary}</p>
              <span className="mt-4 inline-flex items-center gap-1.5 rounded-full bg-white/15 px-2.5 py-1 text-xs font-medium">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-300" /> Integrated
              </span>
            </div>
            <ul className="space-y-2 self-center text-sm">
              {featured.capabilities?.map((c) => (
                <li key={c} className="flex gap-2">
                  <Check size={16} className="mt-0.5 shrink-0 text-emerald-200" /> {c}
                </li>
              ))}
            </ul>
          </button>
        )}

        {library.length === 0 ? (
          <p className="rounded-2xl bg-white p-10 text-center text-sm text-slate-500 ring-1 ring-slate-200">Nothing here for this filter yet.</p>
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {library.map((it) => (
              <div key={it.id} className="group flex min-w-0 flex-col rounded-2xl bg-white p-4 ring-1 ring-slate-200 transition hover:-translate-y-0.5 hover:shadow-md hover:ring-slate-300">
                <button onClick={() => setOpen(it)} className="flex flex-1 flex-col text-left">
                  <div className="flex items-start gap-3">
                    <ToolIcon it={it} />
                    <div className="min-w-0">
                      <p className="font-semibold leading-tight">{it.name}</p>
                      <p className="mt-0.5 truncate text-xs text-slate-500">{it.vendor ?? it.kind}</p>
                    </div>
                  </div>
                  <p className="mt-3 line-clamp-3 text-sm text-slate-600">{it.summary}</p>
                </button>
                <div className="mt-4 flex items-center gap-2">
                  <span className="text-[11px] text-slate-400">{STAGES.find((s) => s.key === it.stage)?.label}</span>
                  <span className="ml-auto">
                    {it.status === "available" ? (
                      <PlugButton on={plugged.has(it.id)} onClick={() => toggle(it.id)} />
                    ) : (
                      <StatusPill status={it.status} />
                    )}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}

        <div className="mt-6 flex flex-wrap items-center gap-4 rounded-2xl border-2 border-dashed border-slate-300 p-5">
          <span className="grid h-11 w-11 place-items-center rounded-xl bg-slate-900 text-white">
            <Plug size={20} />
          </span>
          <div className="min-w-0 flex-1">
            <p className="font-semibold">Don&apos;t see your tool?</p>
            <p className="text-sm text-slate-500">Any model or service can plug into a visit step. Video tools (check-in) are wired today; audio, documents and chart data follow the same pattern.</p>
          </div>
          <ol className="grid w-full gap-2 text-xs text-slate-600 md:grid-cols-3">
            {CONNECT_STEPS.map((s, i) => (
              <li key={s} className="flex gap-2 rounded-xl bg-white p-3 ring-1 ring-slate-200">
                <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-brand-50 text-[11px] font-semibold text-brand-700">{i + 1}</span>
                {s}
              </li>
            ))}
          </ol>
        </div>
      </div>

      {open && <ToolDrawer it={open} plugged={plugged.has(open.id)} onToggle={() => toggle(open.id)} onClose={() => setOpen(null)} />}
    </div>
  );
}

function PlugButton({ on, onClick }: { on: boolean; onClick: () => void }) {
  return on ? (
    <Button variant="secondary" className="px-2.5 py-1 text-xs" onClick={onClick} aria-label="Unplug from preview">
      <Check size={13} /> Plugged in
    </Button>
  ) : (
    <Button className="px-2.5 py-1 text-xs" onClick={onClick}>
      <Plug size={13} /> Plug in
    </Button>
  );
}

function ToolDrawer({ it, plugged, onToggle, onClose }: { it: Integration; plugged: boolean; onToggle: () => void; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-40 flex justify-end bg-slate-900/30" onClick={onClose}>
      <div className="flex h-full w-full max-w-md flex-col bg-white shadow-xl" onClick={(e) => e.stopPropagation()} role="dialog" aria-label={it.name}>
        <div className="flex items-start gap-3 border-b border-slate-200 p-5">
          <ToolIcon it={it} size="lg" />
          <div className="min-w-0 flex-1">
            <h2 className="text-lg font-semibold leading-tight">{it.name}</h2>
            <p className="text-sm text-slate-500">{it.vendor ?? it.kind}</p>
            <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
              {it.status === "available" ? <span className="rounded-full bg-sky-50 px-2.5 py-1 font-medium text-sky-700">Ready to plug in</span> : <StatusPill status={it.status} />}
              <span className="rounded-full bg-slate-100 px-2.5 py-1 text-slate-600">{it.kind}</span>
              <span className="rounded-full bg-slate-100 px-2.5 py-1 text-slate-600">{STAGES.find((s) => s.key === it.stage)?.label}</span>
            </div>
          </div>
          <button onClick={onClose} aria-label="Close">
            <X size={18} />
          </button>
        </div>
        <div className="flex-1 space-y-5 overflow-y-auto p-5 text-sm">
          <p className="text-slate-700">{it.summary}</p>
          {it.capabilities && (
            <ul className="space-y-2">
              {it.capabilities.map((c) => (
                <li key={c} className="flex gap-2">
                  <Check size={16} className="mt-0.5 shrink-0 text-brand-600" /> {c}
                </li>
              ))}
            </ul>
          )}
          <div className="grid grid-cols-[auto_1fr] items-center gap-x-3 gap-y-2 rounded-xl bg-slate-50 p-4">
            <span className="text-xs font-medium text-slate-500">Takes</span>
            <div className="flex flex-wrap gap-1">
              {it.inputs.map((x) => (
                <span key={x} className="rounded-md bg-white px-2 py-0.5 text-xs ring-1 ring-slate-200">
                  {x}
                </span>
              ))}
            </div>
            <span className="text-xs font-medium text-slate-500">Gives back</span>
            <div className="flex flex-wrap gap-1">
              {it.outputs.map((x) => (
                <span key={x} className="rounded-md bg-white px-2 py-0.5 text-xs ring-1 ring-slate-200">
                  {x}
                </span>
              ))}
            </div>
          </div>
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-slate-400">Review</p>
            <p className="mt-1 text-slate-700">{it.review}</p>
          </div>
          {it.status === "available" && (
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-slate-400">How it connects</p>
              <ol className="mt-2 space-y-2">
                {CONNECT_STEPS.map((s, i) => (
                  <li key={s} className="flex gap-2 text-slate-700">
                    <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-brand-50 text-[11px] font-semibold text-brand-700">{i + 1}</span>
                    {s}
                  </li>
                ))}
              </ol>
            </div>
          )}
          {it.link && (
            <a href={it.link} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-sm text-brand-700 hover:underline">
              Vendor docs <ExternalLink size={13} />
            </a>
          )}
        </div>
        {it.status === "available" && (
          <div className="flex items-center gap-3 border-t border-slate-200 p-4">
            <span className="text-xs text-slate-500">{plugged ? "Shown in your stack as a preview." : "Adds it to the stack above as a preview."}</span>
            <span className="ml-auto">
              <PlugButton on={plugged} onClick={onToggle} />
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
