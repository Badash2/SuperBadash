"use client";
import type {
  ListItem,
  Member,
  PriceRow,
  ProductInfo,
  Store,
} from "@/lib/types";
import {
  cheapest,
  effectivePrice,
  ils,
  isGoodDeal,
  type PriceMap,
} from "@/lib/pricing";
import { storeShort } from "@/lib/stores";
import {
  classify,
  DEFAULT_ORDER,
  itemKey,
  SECTION_BY_ID,
  SECTIONS,
} from "@/lib/categories";
import { AddBar, type AddFn } from "./AddBar";
import { ProductImage } from "./ProductImage";
import { NutritionChip } from "./NutritionChip";
import { displayName } from "@/lib/text";
import { useState } from "react";

type Props = {
  items: ListItem[];
  prices: PriceMap;
  infos: Map<string, ProductInfo>;
  stores: Store[];
  members: Member[];
  currentStore: string;
  setCurrentStore: (s: string) => void;
  aisle: Map<string, number>;
  overrides: Map<string, string>;
  onAdd: AddFn;
  onScan: () => void;
  onToggle: (item: ListItem) => void;
  onQty: (item: ListItem, delta: number) => void;
  onDelete: (item: ListItem) => void;
  onSetCategory: (item: ListItem, category: string) => void;
  onFinish: () => void;
};

export function ListView(p: Props) {
  // A tip shown once per device (localStorage = a personal convenience; works without it too)
  const [tipSeen, setTipSeen] = useState(() => {
    try {
      return localStorage.getItem("aisleTipSeen") === "1";
    } catch {
      return false;
    }
  });
  const dismissTip = () => {
    setTipSeen(true);
    try {
      localStorage.setItem("aisleTipSeen", "1");
    } catch {}
  };
  const who = (email: string) => {
    const m = p.members.find(
      (x) => x.email.toLowerCase() === email.toLowerCase(),
    );
    return m?.display_name || email.split("@")[0];
  };
  const sectionOf = (i: ListItem) =>
    p.overrides.get(itemKey(i)) ?? classify(i.name);
  const open = p.items.filter((i) => !i.checked);
  const done = p.items
    .filter((i) => i.checked)
    .sort((a, b) => (a.checked_at ?? "").localeCompare(b.checked_at ?? ""));
  const pos = (i: ListItem) =>
    p.currentStore ? p.aisle.get(itemKey(i)) : undefined;

  // Group by section. In-store mode: sections ordered by the route learned in this branch
  const groups = new Map<string, ListItem[]>();
  for (const it of open) {
    const s = sectionOf(it);
    if (!groups.has(s)) groups.set(s, []);
    groups.get(s)!.push(it);
  }
  const sectionRank = (id: string) => {
    const learned = (groups.get(id) ?? [])
      .map(pos)
      .filter((x): x is number => x != null);
    return learned.length
      ? Math.min(...learned) * 100
      : 1000 + (DEFAULT_ORDER.get(id) ?? 99);
  };
  const ordered = [...groups.entries()].sort(
    ([a], [b]) => sectionRank(a) - sectionRank(b),
  );
  for (const [, list] of ordered) {
    list.sort(
      (a, b) =>
        (pos(a) ?? 2) - (pos(b) ?? 2) || a.added_at.localeCompare(b.added_at),
    );
  }

  return (
    <div className="space-y-5">
      <AddBar onAdd={p.onAdd} onScan={p.onScan} />

      <label className="flex items-center gap-3 rounded-2xl border border-line bg-surface px-3 py-2 shadow-card">
        <span className="text-sm text-muted">אני עכשיו ב</span>
        <select
          value={p.currentStore}
          onChange={(e) => p.setCurrentStore(e.target.value)}
          className="min-w-0 flex-1 bg-transparent py-1 font-semibold text-fg outline-none"
        >
          <option value="">לא בסופר (מתכנן)</option>
          {p.stores.map((s) => (
            <option key={s.store_key} value={s.store_key}>
              {storeShort(s.store_key, s.name)}
            </option>
          ))}
        </select>
      </label>
      {p.currentStore && p.aisle.size === 0 && open.length > 0 && !tipSeen && (
        <div className="flex items-start gap-2 rounded-2xl bg-info-soft p-3 text-sm text-info">
          <p className="flex-1">
            סמנו ✓ לפי סדר האיסוף. המחלקות יסתדרו לפי המסלול שלכם.
          </p>
          <button
            onClick={dismissTip}
            className="-m-2 flex h-10 w-10 shrink-0 items-center justify-center text-lg"
            aria-label="סגור"
          >
            ×
          </button>
        </div>
      )}

      {open.length === 0 && done.length === 0 && (
        <div className="py-16 text-center">
          <div className="text-5xl">🧺</div>
          <p className="mt-3 text-muted">הרשימה ריקה. מה חסר בבית?</p>
        </div>
      )}

      {ordered.map(([sid, list]) => {
        const sec = SECTION_BY_ID.get(sid) ?? SECTION_BY_ID.get("other")!;
        return (
          <section key={sid} className="space-y-2">
            <h3 className="flex items-center gap-2 px-1 text-sm font-bold text-muted">
              <span className="text-base">{sec.emoji}</span>
              {sec.label}
              <span className="rounded-full bg-surface-2 px-2 text-xs font-semibold">
                {list.length}
              </span>
            </h3>
            <ul className="space-y-2">
              {list.map((it) => (
                <Row key={it.id} it={it} section={sid} {...p} who={who} />
              ))}
            </ul>
          </section>
        );
      })}

      {done.length > 0 && (
        <section className="space-y-2 border-t border-line pt-4">
          <div className="flex items-center justify-between">
            <h3 className="px-1 text-sm font-bold text-muted">
              🛒 בעגלה ({done.length})
            </h3>
            <button
              onClick={p.onFinish}
              className="rounded-2xl bg-brand px-4 py-2 text-sm font-bold text-brand-fg shadow-card active:bg-brand-strong"
            >
              סיימתי קנייה ✓
            </button>
          </div>
          <ul className="space-y-2 opacity-60">
            {done.map((it) => (
              <Row
                key={it.id}
                it={it}
                section={sectionOf(it)}
                {...p}
                who={who}
              />
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function Row({
  it,
  section,
  prices,
  infos,
  currentStore,
  onToggle,
  onQty,
  onDelete,
  onSetCategory,
  who,
}: Props & { it: ListItem; section: string; who: (e: string) => string }) {
  const byStore = it.code ? prices.get(it.code) : undefined;
  const best = cheapest(byStore, it.quantity);
  const here: PriceRow | undefined = currentStore
    ? byStore?.get(currentStore)
    : undefined;
  const deals = byStore ? [...byStore.values()].filter(isGoodDeal) : [];
  const dealsHere = currentStore
    ? deals.filter((d) => d.store_key === currentStore)
    : deals;
  const dealsElsewhere = currentStore
    ? deals.filter((d) => d.store_key !== currentStore)
    : [];
  const hereIsBest =
    !!here && !!best && effectivePrice(here, it.quantity) <= best.price + 0.001;
  const info = it.code ? infos.get(it.code) : undefined;

  return (
    <li className="flex items-start gap-3 rounded-2xl border border-line bg-surface p-3 shadow-card">
      <button
        onClick={() => onToggle(it)}
        aria-label={it.checked ? "בטל סימון" : "סמן כנלקח"}
        className="-m-2 mt-0.5 flex h-11 w-11 shrink-0 items-center justify-center"
      >
        <span
          className={`flex h-7 w-7 items-center justify-center rounded-full border-2 text-sm font-bold transition-colors ${
            it.checked
              ? "border-brand bg-brand text-brand-fg"
              : "border-faint/60"
          }`}
        >
          {it.checked ? "✓" : ""}
        </span>
      </button>
      <ProductImage
        code={it.code}
        fallbackUrl={info?.image_url}
        size={48}
        emoji={SECTION_BY_ID.get(section)?.emoji}
      />
      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex items-start gap-2">
          <div
            className={`line-clamp-2 flex-1 font-semibold leading-snug text-fg ${it.checked ? "line-through" : ""}`}
          >
            {displayName(it.name)}
          </div>
          <button
            onClick={() => onDelete(it)}
            className="-me-2 -mt-2 flex h-10 w-10 shrink-0 items-center justify-center text-xl leading-none text-faint active:text-danger"
            aria-label="מחק"
          >
            ×
          </button>
        </div>
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted">
          {here && (
            <span className="font-bold text-fg">
              כאן{" "}
              <span className={hereIsBest ? "text-brand" : ""}>
                {ils(effectivePrice(here, it.quantity))}
              </span>
              {hereIsBest && <span className="ms-1 text-brand">✓ הכי זול</span>}
            </span>
          )}
          {best && !hereIsBest && (
            <span className="whitespace-nowrap">
              {currentStore ? "זול יותר" : "הכי זול"}{" "}
              <b className={currentStore ? "text-fg" : "text-brand"}>
                {ils(best.price)}
              </b>{" "}
              ב{storeShort(best.store)}
            </span>
          )}
          {it.code && !byStore && <span>אין מחיר כרגע</span>}
          {dealsHere.length > 0 && (
            <span className="rounded-full bg-accent-soft px-2 py-0.5 font-bold text-accent">
              🔥{" "}
              {currentStore
                ? "במבצע כאן"
                : `מבצע ב${dealsHere.map((d) => storeShort(d.store_key)).join(", ")}`}
            </span>
          )}
          {currentStore && dealsElsewhere.length > 0 && (
            <span>
              מבצע ב
              {dealsElsewhere.map((d) => storeShort(d.store_key)).join(", ")}
            </span>
          )}
        </div>
        <NutritionChip info={info} />
        <div className="flex items-center justify-between gap-2 pt-0.5">
          <div className="flex min-w-0 items-center gap-2 text-[11px] text-faint">
            <label
              className="relative flex min-h-8 items-center gap-0.5 rounded-full bg-surface-2 px-2.5 py-1.5 text-muted"
              title="שינוי מחלקה"
            >
              {SECTION_BY_ID.get(section)?.emoji ?? "📦"} ▾
              <select
                value={section}
                onChange={(e) => onSetCategory(it, e.target.value)}
                className="absolute inset-0 cursor-pointer opacity-0"
                aria-label="מחלקה"
              >
                {SECTIONS.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.emoji} {s.label}
                  </option>
                ))}
              </select>
            </label>
            <span className="truncate">
              {who(it.checked && it.checked_by ? it.checked_by : it.added_by)}
            </span>
          </div>
          <div className="flex shrink-0 items-center rounded-xl bg-surface-2">
            <button
              onClick={() => onQty(it, -1)}
              className="h-10 w-10 rounded-xl text-lg text-fg"
              aria-label="פחות"
            >
              −
            </button>
            <span className="w-6 text-center text-sm font-bold tabular-nums text-fg">
              {it.quantity}
            </span>
            <button
              onClick={() => onQty(it, 1)}
              className="h-10 w-10 rounded-xl text-lg text-fg"
              aria-label="עוד"
            >
              +
            </button>
          </div>
        </div>
      </div>
    </li>
  );
}
