"use client";
import { displayName } from "@/lib/text";
import { ProductImage } from "./ProductImage";

export type ConsumedRow = {
  id: string;
  code: string;
  name: string;
  scanned_at: string;
  status: string;
};

type Group = {
  code: string;
  name: string;
  count: number;
  last: string;
  isNew: boolean;
};

function ago(iso: string, now: number): string {
  const h = Math.round((now - new Date(iso).getTime()) / 3600000);
  if (h < 1) return "הרגע";
  if (h < 24) return `לפני ${h} שע׳`;
  const d = Math.round(h / 24);
  return d === 1 ? "אתמול" : `לפני ${d} ימים`;
}

/**
 * "Ran out": the log from the scanner by the bin. Nothing is added to the list automatically -
 * whoever looks here decides what is worth buying (a child who scanned a candy doesn't put it on the list).
 */
export function RanOutView({
  rows,
  onList,
  now,
  onAdd,
  onHide,
}: {
  rows: ConsumedRow[];
  onList: Set<string>;
  now: number;
  onAdd: (g: { code: string; name: string }) => void;
  onHide: (code: string) => void;
}) {
  const groups = new Map<string, Group>();
  for (const r of rows) {
    if (r.status === "dismissed") continue;
    const g = groups.get(r.code);
    if (g) {
      g.count++;
      g.isNew ||= r.status === "new";
    } else {
      groups.set(r.code, {
        code: r.code,
        name: r.name,
        count: 1,
        last: r.scanned_at,
        isNew: r.status === "new",
      });
    }
  }
  const list = [...groups.values()];
  const fresh = list.filter((g) => g.isNew && !onList.has(g.code));
  const handled = list.filter((g) => !g.isNew || onList.has(g.code));

  return (
    <div className="space-y-5">
      <p className="text-sm text-muted">
        מה שנסרק בסורק ליד הפח ב-30 הימים האחרונים. שום דבר לא נכנס לרשימה לבד -
        מוסיפים רק מה שבאמת צריך.
      </p>

      {list.length === 0 && (
        <div className="py-16 text-center">
          <div className="text-5xl">🗑️</div>
          <p className="mt-3 text-muted">עוד לא נסרק כלום ליד הפח.</p>
        </div>
      )}

      {fresh.length > 0 && (
        <section className="space-y-2">
          <h3 className="flex items-center gap-2 px-1 text-sm font-bold text-muted">
            חדש
            <span className="rounded-full bg-surface-2 px-2 text-xs font-semibold">
              {fresh.length}
            </span>
          </h3>
          <ul className="space-y-2">
            {fresh.map((g) => (
              <Row key={g.code} g={g} now={now}>
                <button
                  onClick={() => onHide(g.code)}
                  className="flex h-10 w-10 shrink-0 items-center justify-center text-xl text-faint"
                  aria-label="לא צריך"
                  title="לא צריך"
                >
                  ×
                </button>
                <button
                  onClick={() => onAdd(g)}
                  className="h-10 shrink-0 rounded-2xl bg-brand px-3 text-sm font-bold text-brand-fg active:bg-brand-strong"
                >
                  + לרשימה
                </button>
              </Row>
            ))}
          </ul>
        </section>
      )}

      {handled.length > 0 && (
        <section className="space-y-2">
          <h3 className="px-1 text-sm font-bold text-muted">טופל</h3>
          <ul className="space-y-2 opacity-70">
            {handled.map((g) => (
              <Row key={g.code} g={g} now={now}>
                {onList.has(g.code) ? (
                  <span className="shrink-0 text-xs font-semibold text-brand">
                    ✓ ברשימה
                  </span>
                ) : (
                  <button
                    onClick={() => onAdd(g)}
                    className="h-10 shrink-0 rounded-2xl bg-surface-2 px-3 text-sm font-medium text-fg"
                  >
                    + שוב
                  </button>
                )}
              </Row>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function Row({
  g,
  now,
  children,
}: {
  g: Group;
  now: number;
  children: React.ReactNode;
}) {
  return (
    <li className="flex items-center gap-3 rounded-2xl border border-line bg-surface p-3 shadow-card">
      <ProductImage code={g.code} size={44} />
      <div className="min-w-0 flex-1">
        <div className="line-clamp-2 font-semibold leading-snug text-fg">
          {displayName(g.name)}
        </div>
        <div className="text-xs text-muted">
          נגמר {ago(g.last, now)}
          {g.count > 1 ? ` · ${g.count} פעמים ב-30 יום` : ""}
        </div>
      </div>
      {children}
    </li>
  );
}
