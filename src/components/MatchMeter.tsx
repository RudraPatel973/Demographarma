/** Circular percentage meter for a recommendation's match score. */
export function MatchMeter({ value, size = 88 }: { value: number; size?: number }) {
  const stroke = 8;
  const r = (size - stroke) / 2;
  const circ = 2 * Math.PI * r;
  const v = Math.max(0, Math.min(100, value));
  const color = v >= 80 ? "#0e8774" : v >= 60 ? "#d97706" : "#dc2626";
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }} role="meter" aria-valuenow={v} aria-valuemin={0} aria-valuemax={100} aria-label="Patient match">
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#e2e8f0" strokeWidth={stroke} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={color}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={circ}
          strokeDashoffset={circ * (1 - v / 100)}
          style={{ transition: "stroke-dashoffset 700ms ease" }}
        />
      </svg>
      <div className="absolute inset-0 grid place-items-center">
        <div className="text-center leading-none">
          <div className="text-xl font-semibold tabular-nums">{v}%</div>
          <div className="mt-1 text-[10px] uppercase tracking-wide text-slate-500">match</div>
        </div>
      </div>
    </div>
  );
}
