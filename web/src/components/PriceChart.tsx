"use client";
import { useEffect, useRef, useState } from "react";
import { priceAt, type Series } from "@/lib/history";
import { ils } from "@/lib/pricing";
import { storeShort } from "@/lib/stores";

/**
 * A price-history chart: a step line per store ("emphasis" form - the chosen store in green, the rest grey context).
 * Steps, not a diagonal line: a price holds until it changes. Touch/hover = crosshair + all stores' prices on that day.
 * Time runs left to right (dir=ltr) as in any time axis, the text inside stays Hebrew.
 */
const H = 190;
const M = { top: 10, right: 10, bottom: 24, left: 46 };

export function PriceChart({
  series,
  from,
  to,
  focus,
}: {
  series: Series[];
  from: number;
  to: number;
  focus: string;
}) {
  const wrap = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(340);
  const [hoverT, setHoverT] = useState<number | null>(null);

  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) =>
      setW(Math.max(260, Math.round(e.contentRect.width))),
    );
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  if (!series.length) return null;
  const all = series.flatMap((s) => s.points.map((p) => p.price));
  let lo = Math.min(...all);
  let hi = Math.max(...all);
  const pad = Math.max((hi - lo) * 0.15, hi * 0.05, 0.2);
  lo = Math.max(0, lo - pad);
  hi = hi + pad;
  const x = (t: number) =>
    M.left + ((t - from) / Math.max(1, to - from)) * (w - M.left - M.right);
  const y = (p: number) =>
    M.top + (1 - (p - lo) / (hi - lo)) * (H - M.top - M.bottom);
  const path = (s: Series) =>
    s.points
      .map((p, i) =>
        i === 0 ? `M${x(p.t)},${y(p.price)}` : `H${x(p.t)}V${y(p.price)}`,
      )
      .join("");
  const ticksY = [lo + (hi - lo) * 0.15, (lo + hi) / 2, hi - (hi - lo) * 0.15];
  const fmtDate = (t: number) =>
    new Date(t).toLocaleDateString("he-IL", {
      day: "numeric",
      month: "numeric",
    });
  const focused = series.find((s) => s.store === focus) ?? series[0];
  const others = series.filter((s) => s !== focused);

  const onMove = (e: React.PointerEvent<SVGRectElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const frac = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
    setHoverT(from + frac * (to - from));
  };
  const at =
    hoverT != null
      ? series
          .map((s) => ({ store: s.store, price: priceAt(s, hoverT) }))
          .filter((r): r is { store: string; price: number } => r.price != null)
          .sort((a, b) => a.price - b.price)
      : [];
  const tipLeft =
    hoverT != null ? Math.min(Math.max(x(hoverT) - 80, 0), w - 160) : 0;

  return (
    <div ref={wrap} className="relative" dir="ltr">
      <svg
        width={w}
        height={H}
        role="img"
        aria-label={`היסטוריית מחיר, ${series.length} סניפים`}
        className="block"
      >
        {ticksY.map((v) => (
          <g key={v}>
            <line
              x1={M.left}
              x2={w - M.right}
              y1={y(v)}
              y2={y(v)}
              stroke="var(--line)"
              strokeWidth={1}
            />
            <text
              x={M.left - 6}
              y={y(v) + 3}
              textAnchor="end"
              fontSize={10}
              fill="var(--muted)"
            >
              {ils(v)}
            </text>
          </g>
        ))}
        {[from, (from + to) / 2, to].map((t, i) => (
          <text
            key={t}
            x={x(t)}
            y={H - 6}
            textAnchor={i === 0 ? "start" : i === 2 ? "end" : "middle"}
            fontSize={10}
            fill="var(--muted)"
          >
            {i === 2 ? "היום" : fmtDate(t)}
          </text>
        ))}
        {others.map((s) => (
          <path
            key={s.store}
            d={path(s)}
            fill="none"
            stroke="var(--faint)"
            strokeOpacity={0.7}
            strokeWidth={1.5}
            strokeLinejoin="round"
          />
        ))}
        {/* The chosen store: a surface "ring" underneath so it separates where it crosses others */}
        <path
          d={path(focused)}
          fill="none"
          stroke="var(--surface)"
          strokeWidth={6}
          strokeLinejoin="round"
        />
        <path
          d={path(focused)}
          fill="none"
          stroke="var(--brand)"
          strokeWidth={2.5}
          strokeLinejoin="round"
          strokeLinecap="round"
        />
        <circle
          cx={x(to)}
          cy={y(focused.current)}
          r={5}
          fill="var(--brand)"
          stroke="var(--surface)"
          strokeWidth={2}
        />

        {hoverT != null && (
          <g pointerEvents="none">
            <line
              x1={x(hoverT)}
              x2={x(hoverT)}
              y1={M.top}
              y2={H - M.bottom}
              stroke="var(--muted)"
              strokeWidth={1}
            />
            {series.map((s) => {
              const p = priceAt(s, hoverT);
              return p == null ? null : (
                <circle
                  key={s.store}
                  cx={x(hoverT)}
                  cy={y(p)}
                  r={s === focused ? 5 : 4}
                  fill={s === focused ? "var(--brand)" : "var(--faint)"}
                  stroke="var(--surface)"
                  strokeWidth={2}
                />
              );
            })}
          </g>
        )}
        <rect
          x={M.left}
          y={0}
          width={w - M.left - M.right}
          height={H}
          fill="transparent"
          style={{ touchAction: "pan-y" }}
          onPointerMove={onMove}
          onPointerDown={onMove}
          onPointerLeave={() => setHoverT(null)}
        />
      </svg>

      {hoverT != null && at.length > 0 && (
        <div
          dir="rtl"
          className="pointer-events-none absolute top-0 w-40 rounded-xl border border-line bg-surface p-2 text-xs shadow-card"
          style={{ left: tipLeft }}
        >
          <div className="mb-1 font-bold text-fg">
            {new Date(hoverT).toLocaleDateString("he-IL", {
              day: "numeric",
              month: "long",
            })}
          </div>
          {at.map((r) => (
            <div
              key={r.store}
              className={`flex justify-between gap-2 ${r.store === focused.store ? "font-bold text-fg" : "text-muted"}`}
            >
              <span className="flex items-center gap-1.5">
                <span
                  className="inline-block h-0.5 w-3 rounded-full"
                  style={{
                    background:
                      r.store === focused.store
                        ? "var(--brand)"
                        : "var(--faint)",
                  }}
                />
                {storeShort(r.store)}
              </span>
              <span className="tabular-nums">{ils(r.price)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
