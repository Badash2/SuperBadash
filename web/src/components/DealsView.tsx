"use client";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { ils, VERDICT } from "@/lib/pricing";
import { storeColor, storeShort } from "@/lib/stores";
import type { Store } from "@/lib/types";
import { ProductImage } from "./ProductImage";
import { displayName } from "@/lib/text";

type PriceMove = {
  code: string;
  store_key: string;
  old: number;
  now: number;
  pct: number;
  name?: string;
  barcode?: string | null;
};

type DealRow = {
  store_key: string;
  code: string;
  description: string | null;
  regular_price: number;
  promo_unit_price: number;
  min_qty: number | null;
  market_saving_pct: number;
  verdict: string;
  end_at: string | null;
  name?: string;
  barcode?: string | null;
};

/** Real deals: first on products you actually buy, then the best in the area. Filterable by store. */
export function DealsView({
  myCodes,
  stores,
  initialStore,
  onAdd,
  onOpen,
}: {
  myCodes: string[];
  stores: Store[];
  initialStore: string;
  onAdd: (i: { code: string; name: string }) => void;
  onOpen: (code: string) => void;
}) {
  const [store, setStore] = useState(initialStore); // "" = all stores
  // View: list or gallery (large images). Remembered on the device.
  const [view, setViewState] = useState<"list" | "grid">(() => {
    try {
      return localStorage.getItem("dealsView") === "grid" ? "grid" : "list";
    } catch {
      return "list";
    }
  });
  const renderDeals = (rows: DealRow[]) =>
    view === "grid" ? (
      <div className="grid grid-cols-2 gap-3">
        {rows.map((d) => (
          <DealTile
            key={d.store_key + d.code}
            d={d}
            showStore={!store}
            onOpen={onOpen}
            onAdd={onAdd}
          />
        ))}
      </div>
    ) : (
      rows.map((d) => (
        <DealCard
          key={d.store_key + d.code}
          d={d}
          now={now}
          showStore={!store}
          onOpen={onOpen}
          onAdd={onAdd}
        />
      ))
    );
  const setView = (v: "list" | "grid") => {
    setViewState(v);
    try {
      localStorage.setItem("dealsView", v);
    } catch {}
  };
  // The results are stored together with the key they were loaded for; a different key = still loading
  const [data, setData] = useState<{
    key: string;
    mine: DealRow[];
    top: DealRow[];
  } | null>(null);
  const [now] = useState(() => Date.now());
  // "Price changes for you": real changes in the last 7 days on products you buy (up and down)
  const [changes, setChanges] = useState<{
    key: string;
    rows: PriceMove[];
  } | null>(null);
  const codesKey = myCodes.join(",");
  const loadKey = `${store}|${codesKey}`;
  const ready = data?.key === loadKey;
  const mine = ready ? data.mine : null;
  const top = ready ? data.top : null;

  useEffect(() => {
    let cancelled = false;
    async function withNames(rows: DealRow[]): Promise<DealRow[]> {
      const codes = [...new Set(rows.map((r) => r.code))];
      if (codes.length === 0) return rows;
      const { data } = await supabase
        .from("products")
        .select("code,name,barcode")
        .in("code", codes);
      const m = new Map((data ?? []).map((p) => [p.code as string, p]));
      return rows.map((r) => ({
        ...r,
        name: m.get(r.code)?.name,
        barcode: m.get(r.code)?.barcode,
      }));
    }
    (async () => {
      const cols =
        "store_key,code,description,regular_price,promo_unit_price,min_qty,market_saving_pct,verdict,end_at";
      const codes = codesKey ? codesKey.split(",") : [];
      let mineQ = supabase
        .from("deals")
        .select(cols)
        .in("code", codes)
        .in("verdict", ["real", "conditional", "fake"]);
      let topQ = supabase
        .from("deals")
        .select(cols)
        .eq("verdict", "real")
        .gte("market_saving_pct", 15)
        .lte("market_saving_pct", 70);
      if (store) {
        mineQ = mineQ.eq("store_key", store);
        topQ = topQ.eq("store_key", store);
      }
      const [a, b] = await Promise.all([
        codes.length ? mineQ : Promise.resolve({ data: [] }),
        topQ.order("market_saving_pct", { ascending: false }).limit(60),
      ]);
      const [m, t] = await Promise.all([
        withNames((a.data as DealRow[]) ?? []),
        withNames((b.data as DealRow[]) ?? []),
      ]);
      if (!cancelled) {
        setData({
          key: `${store}|${codesKey}`,
          mine: m.sort((x, y) => y.market_saving_pct - x.market_saving_pct),
          top: t,
        });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [codesKey, store]);

  const chips: [string, string][] = [
    ["", "כל הסניפים"],
    ...stores.map(
      (s) => [s.store_key, storeShort(s.store_key, s.name)] as [string, string],
    ),
  ];

  useEffect(() => {
    const codes = codesKey ? codesKey.split(",") : [];
    if (!codes.length) return;
    let cancelled = false;
    (async () => {
      const { data } = await supabase.rpc("recent_changes", {
        codes,
        p_days: 7,
      });
      const raw =
        (data as {
          code: string;
          store_key: string;
          changed_at: string;
          old_price: number;
          new_price: number;
        }[]) ?? [];
      // The latest change per product and store; the strongest first
      const latest = new Map<string, PriceMove>();
      for (const r of raw) {
        const k = `${r.code}|${r.store_key}`;
        if (!latest.has(k))
          latest.set(k, {
            code: r.code,
            store_key: r.store_key,
            old: r.old_price,
            now: r.new_price,
            pct: r.new_price / r.old_price - 1,
          });
      }
      let moves = [...latest.values()].filter((m) => Math.abs(m.pct) >= 0.02);
      if (store) moves = moves.filter((m) => m.store_key === store);
      moves = moves
        .sort((a, b) => Math.abs(b.pct) - Math.abs(a.pct))
        .slice(0, 8);
      const ids = [...new Set(moves.map((m) => m.code))];
      if (ids.length) {
        const { data: p } = await supabase
          .from("products")
          .select("code,name,barcode")
          .in("code", ids);
        const m = new Map(
          (
            (p ?? []) as {
              code: string;
              name: string;
              barcode: string | null;
            }[]
          ).map((x) => [x.code, x]),
        );
        moves = moves.map((x) => ({
          ...x,
          name: m.get(x.code)?.name,
          barcode: m.get(x.code)?.barcode,
        }));
      }
      if (!cancelled) setChanges({ key: `${store}|${codesKey}`, rows: moves });
    })();
    return () => {
      cancelled = true;
    };
  }, [codesKey, store]);
  const moves = changes?.key === `${store}|${codesKey}` ? changes.rows : [];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <span className="text-sm text-muted">תצוגה</span>
        <div
          className="flex shrink-0 rounded-full bg-surface-2 p-1"
          role="tablist"
          aria-label="תצוגה"
        >
          {(
            [
              ["list", "☰", "רשימה"],
              ["grid", "▦", "גלריה"],
            ] as const
          ).map(([v, icon, label]) => (
            <button
              key={v}
              role="tab"
              aria-selected={view === v}
              aria-label={label}
              title={label}
              onClick={() => setView(v)}
              className={`flex h-9 w-10 items-center justify-center rounded-full text-base ${view === v ? "bg-surface text-fg shadow-card" : "text-muted"}`}
            >
              {icon}
            </button>
          ))}
        </div>
      </div>
      <div
        className="no-scrollbar -mx-4 flex gap-2 overflow-x-auto px-4 pb-1"
        role="tablist"
        aria-label="סינון לפי סופר"
      >
        {chips.map(([key, label]) => {
          const active = store === key;
          return (
            <button
              key={key || "all"}
              role="tab"
              aria-selected={active}
              onClick={() => setStore(key)}
              className={`flex shrink-0 items-center gap-1.5 rounded-full border px-3.5 py-1.5 text-sm font-medium shadow-card transition-colors ${
                active
                  ? "border-brand bg-brand text-brand-fg"
                  : "border-line bg-surface text-fg"
              }`}
            >
              {key && (
                <span
                  className="h-2 w-2 rounded-full"
                  style={{ background: storeColor(key) }}
                />
              )}
              {label}
            </button>
          );
        })}
      </div>

      {moves.length > 0 && (
        <section className="space-y-2">
          <h3 className="font-semibold">📈 שינויי מחיר אצלכם השבוע</h3>
          <ul className="divide-y divide-line rounded-2xl border border-line bg-surface px-3 shadow-card">
            {moves.map((m) => (
              <li key={m.code + m.store_key}>
                <button
                  onClick={() => onOpen(m.code)}
                  className="flex min-h-12 w-full items-center gap-3 py-2 text-start"
                >
                  <span
                    className={`w-12 shrink-0 text-sm font-bold ${m.pct > 0 ? "text-warn" : "text-brand"}`}
                  >
                    {m.pct > 0 ? "▲" : "▼"}
                    <bdi dir="ltr">{Math.round(Math.abs(m.pct) * 100)}%</bdi>
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold text-fg">
                      {displayName(m.name ?? m.code)}
                    </span>
                    <span className="block text-xs text-muted">
                      {storeShort(m.store_key)} · <s>{ils(m.old)}</s> ←{" "}
                      {ils(m.now)}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="space-y-2">
        <h3 className="font-semibold">🎯 על מה שאתם קונים</h3>
        {mine == null ? (
          <p className="text-sm text-muted">טוען...</p>
        ) : mine.length === 0 ? (
          <p className="text-sm text-muted">
            עוד אין מבצעים על מה שאתם קונים{store ? " בסניף הזה" : ""}.
          </p>
        ) : (
          renderDeals(mine)
        )}
      </section>
      <section className="space-y-2">
        <h3 className="font-semibold">
          🔥 המבצעים האמיתיים הכי טובים{" "}
          {store ? `ב${storeShort(store)}` : "באזור"}
        </h3>
        <p className="text-xs text-muted">
          רק מבצעים שנבדקו: זולים באמת מול שאר הסניפים, פתוחים לכולם, ולא
          &quot;קבועים&quot;.
        </p>
        {top == null ? (
          <p className="text-sm text-muted">טוען...</p>
        ) : (
          renderDeals(top)
        )}
      </section>
    </div>
  );
}

function DealCard({
  d,
  now,
  showStore,
  onAdd,
  onOpen,
}: {
  d: DealRow;
  now: number;
  showStore: boolean;
  onOpen: (code: string) => void;
  onAdd: (i: { code: string; name: string }) => void;
}) {
  const v = VERDICT[d.verdict] ?? VERDICT.meh;
  const end = d.end_at ? new Date(d.end_at) : null;
  const daysLeft = end ? Math.ceil((end.getTime() - now) / 86400000) : null;
  return (
    <div className="flex items-center gap-3 rounded-2xl border border-line bg-surface p-3 shadow-card">
      <button
        onClick={() => onOpen(d.code)}
        className="shrink-0"
        aria-label={`כרטיס מוצר: ${d.name ?? d.code}`}
      >
        <ProductImage code={d.barcode ?? null} size={48} />
      </button>
      <div className="min-w-0 flex-1 space-y-1">
        <button
          onClick={() => onOpen(d.code)}
          className="line-clamp-2 text-start font-semibold leading-snug text-fg"
        >
          {displayName(d.name ?? d.code)}
        </button>
        <div className="line-clamp-2 text-xs text-muted">
          {displayName(d.description ?? "")}
        </div>
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
          <span className={`rounded-full px-2 py-0.5 font-bold ${v.cls}`}>
            {v.label}
          </span>
          {showStore && (
            <span className="text-muted">{storeShort(d.store_key)}</span>
          )}
          <span>
            <s className="text-faint">{ils(d.regular_price)}</s>{" "}
            <b>{ils(d.promo_unit_price)}</b>
            {d.min_qty && d.min_qty > 1 ? ` (בקניית ${d.min_qty})` : ""}
          </span>
          <span className="text-brand">
            <bdi dir="ltr">−{Math.round(d.market_saving_pct)}%</bdi> מול השוק
          </span>
          {daysLeft != null && daysLeft <= 7 && daysLeft >= 0 && (
            <span className="text-warn">נגמר בעוד {daysLeft} ימים</span>
          )}
        </div>
      </div>
      <button
        onClick={() => onAdd({ code: d.code, name: d.name ?? d.code })}
        className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-brand text-xl font-bold text-brand-fg shadow-card active:bg-brand-strong"
        aria-label="הוסף לרשימה"
      >
        +
      </button>
    </div>
  );
}

/** A large image: Rami Levy's image server at high resolution (1024px), otherwise an icon. */
function BigImage({ code, alt }: { code: string | null; alt: string }) {
  const [failed, setFailed] = useState(false);
  if (!code || !/^\d{8,14}$/.test(code) || failed)
    return (
      <div className="flex aspect-square w-full items-center justify-center rounded-xl bg-surface-2 text-5xl">
        🛒
      </div>
    );
  return (
    // eslint-disable-next-line @next/next/no-img-element -- an external CDN
    <img
      src={`https://img.rami-levy.co.il/product/${code}/medium.jpg`}
      srcSet={`https://img.rami-levy.co.il/product/${code}/medium.jpg 1x, https://img.rami-levy.co.il/product/${code}/large.jpg 2x`}
      alt={alt}
      loading="lazy"
      onError={() => setFailed(true)}
      className="aspect-square w-full rounded-xl bg-img object-contain p-2"
    />
  );
}

/** Gallery card: a large image on top, name, price, verdict, and an add button. */
function DealTile({
  d,
  showStore,
  onOpen,
  onAdd,
}: {
  d: DealRow;
  showStore: boolean;
  onOpen: (code: string) => void;
  onAdd: (i: { code: string; name: string }) => void;
}) {
  const v = VERDICT[d.verdict] ?? VERDICT.meh;
  return (
    <div className="flex flex-col gap-2 rounded-2xl border border-line bg-surface p-2.5 shadow-card">
      <button
        onClick={() => onOpen(d.code)}
        className="relative"
        aria-label={`כרטיס מוצר: ${d.name ?? d.code}`}
      >
        <BigImage code={d.barcode ?? null} alt={d.name ?? ""} />
        <span
          className={`absolute end-1.5 top-1.5 rounded-full px-2 py-0.5 text-[11px] font-bold ${v.cls}`}
        >
          <bdi dir="ltr">−{Math.round(d.market_saving_pct)}%</bdi>
        </span>
      </button>
      <button
        onClick={() => onOpen(d.code)}
        className="line-clamp-2 min-h-10 text-start text-sm font-semibold leading-snug text-fg"
      >
        {displayName(d.name ?? d.code)}
      </button>
      <div className="flex flex-wrap items-baseline gap-x-1.5 text-sm">
        <b className="text-fg">{ils(d.promo_unit_price)}</b>
        <s className="text-xs text-faint">{ils(d.regular_price)}</s>
        {d.min_qty && d.min_qty > 1 ? (
          <span className="text-[11px] text-muted">(בקניית {d.min_qty})</span>
        ) : null}
      </div>
      <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
        <span className={`rounded-full px-2 py-0.5 font-bold ${v.cls}`}>
          {v.label}
        </span>
        {showStore && (
          <span className="text-muted">{storeShort(d.store_key)}</span>
        )}
      </div>
      <button
        onClick={() => onAdd({ code: d.code, name: d.name ?? d.code })}
        className="mt-auto h-10 rounded-xl bg-brand text-sm font-bold text-brand-fg active:bg-brand-strong"
      >
        + לרשימה
      </button>
    </div>
  );
}
