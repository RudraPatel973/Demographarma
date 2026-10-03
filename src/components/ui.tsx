import clsx from "clsx";
import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from "react";

export function Card({ className, children, id }: { className?: string; children: ReactNode; id?: string }) {
  return <div id={id} className={clsx("rounded-xl border border-slate-200 bg-white shadow-sm", className)}>{children}</div>;
}

export function CardHeader({ title, subtitle, step, right }: { title: string; subtitle?: string; step?: number; right?: ReactNode }) {
  return (
    <div className="flex items-start gap-3 border-b border-slate-100 px-5 py-4">
      {step !== undefined && (
        <span className="mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full bg-slate-900 text-xs font-semibold text-white">{step}</span>
      )}
      <div className="min-w-0 flex-1">
        <h2 className="font-semibold leading-6">{title}</h2>
        {subtitle && <p className="text-sm text-slate-500">{subtitle}</p>}
      </div>
      {right}
    </div>
  );
}

type Variant = "primary" | "secondary" | "ghost" | "danger";
export function Button({ variant = "primary", className, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  return (
    <button
      {...props}
      className={clsx(
        "inline-flex items-center justify-center gap-2 rounded-lg px-3.5 py-2 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50",
        variant === "primary" && "bg-brand-600 text-white hover:bg-brand-700",
        variant === "secondary" && "border border-slate-300 bg-white text-slate-800 hover:bg-slate-50",
        variant === "ghost" && "text-slate-600 hover:bg-slate-100",
        variant === "danger" && "bg-red-600 text-white hover:bg-red-700",
        className,
      )}
    />
  );
}

export function Label({ children, hint }: { children: ReactNode; hint?: string }) {
  return (
    <span className="mb-1 flex items-baseline justify-between text-xs font-medium text-slate-600">
      {children}
      {hint && <span className="font-normal text-slate-400">{hint}</span>}
    </span>
  );
}

const field = "w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100";

export function Input(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={clsx(field, props.className)} />;
}
export function Textarea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} className={clsx(field, "min-h-20", props.className)} />;
}
export function Select(props: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} className={clsx(field, props.className)} />;
}

export function Badge({ tone = "slate", children }: { tone?: "slate" | "green" | "red" | "amber" | "blue" | "brand"; children: ReactNode }) {
  return (
    <span
      className={clsx(
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium",
        tone === "slate" && "bg-slate-100 text-slate-700",
        tone === "green" && "bg-emerald-50 text-emerald-700",
        tone === "red" && "bg-red-50 text-red-700",
        tone === "amber" && "bg-amber-50 text-amber-800",
        tone === "blue" && "bg-sky-50 text-sky-700",
        tone === "brand" && "bg-brand-50 text-brand-700",
      )}
    >
      {children}
    </span>
  );
}

/** Comma/newline separated list editor */
export function ListInput({ value, onChange, placeholder }: { value: string[]; onChange: (v: string[]) => void; placeholder?: string }) {
  return (
    <Textarea
      value={value.join("\n")}
      placeholder={placeholder}
      rows={3}
      onChange={(e) => onChange(e.target.value.split("\n"))}
      onBlur={(e) => onChange(e.target.value.split("\n").map((s) => s.trim()).filter(Boolean))}
    />
  );
}
