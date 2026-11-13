"use client";
import { useEffect, useState } from "react";
import { signedUrls } from "@/lib/photos";
import { displayName } from "@/lib/text";
import { ProductImage } from "./ProductImage";

export type PhotoReminder = {
  id: string;
  photo_path: string;
  created_at: string;
  scanned_as: string | null;
  status: string;
};

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
  photos,
  onPhotoAdd,
  onPhotoHide,
  onList,
  now,
  onAdd,
  onHide,
  onOpen,
}: {
  rows: ConsumedRow[];
  photos: PhotoReminder[];
  onPhotoAdd: (p: PhotoReminder, name: string) => void;
  onPhotoHide: (p: PhotoReminder) => void;
  onList: Set<string>;
  now: number;
  onAdd: (g: { code: string; name: string }) => void;
  onHide: (code: string) => void;
  onOpen: (code: string) => void;
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

      {photos.length > 0 && (
        <PhotoReminders
          photos={photos}
          now={now}
          onAdd={onPhotoAdd}
          onHide={onPhotoHide}
        />
      )}

      {list.length === 0 && photos.length === 0 && (
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
              <Row key={g.code} g={g} now={now} onOpen={onOpen}>
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
              <Row key={g.code} g={g} now={now} onOpen={onOpen}>
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
  onOpen,
  children,
}: {
  onOpen: (code: string) => void;
  g: Group;
  now: number;
  children: React.ReactNode;
}) {
  return (
    <li className="flex items-center gap-3 rounded-2xl border border-line bg-surface p-3 shadow-card">
      <button
        onClick={() => onOpen(g.code)}
        className="shrink-0"
        aria-label={`כרטיס מוצר: ${g.name}`}
      >
        <ProductImage code={g.code} size={44} />
      </button>
      <div className="min-w-0 flex-1">
        <button
          onClick={() => onOpen(g.code)}
          className="line-clamp-2 text-start font-semibold leading-snug text-fg"
        >
          {displayName(g.name)}
        </button>
        <div className="text-xs text-muted">
          נגמר {ago(g.last, now)}
          {g.count > 1 ? ` · ${g.count} פעמים ב-30 יום` : ""}
        </div>
      </div>
      {children}
    </li>
  );
}

/** "Photo reminders": what was photographed by the bin (an open hand) - with a name and to the list, or hide. */
function PhotoReminders({
  photos,
  now,
  onAdd,
  onHide,
}: {
  photos: PhotoReminder[];
  now: number;
  onAdd: (p: PhotoReminder, name: string) => void;
  onHide: (p: PhotoReminder) => void;
}) {
  const [urls, setUrls] = useState<Map<string, string>>(new Map());
  const [names, setNames] = useState<Record<string, string>>({});
  const key = photos.map((p) => p.photo_path).join(",");
  useEffect(() => {
    const paths = key ? key.split(",") : [];
    if (paths.length) signedUrls(paths).then(setUrls);
  }, [key]);
  return (
    <section className="space-y-2">
      <h3 className="flex items-center gap-2 px-1 text-sm font-bold text-muted">
        📷 תזכורות מצולמות
        <span className="rounded-full bg-surface-2 px-2 text-xs font-semibold">
          {photos.length}
        </span>
      </h3>
      <ul className="grid grid-cols-2 gap-3">
        {photos.map((p) => (
          <li
            key={p.id}
            className="flex flex-col gap-2 rounded-2xl border border-line bg-surface p-2.5 shadow-card"
          >
            {urls.get(p.photo_path) ? (
              // eslint-disable-next-line @next/next/no-img-element -- a signed link to a private photo
              <img
                src={urls.get(p.photo_path)}
                alt="תזכורת מצולמת"
                className="aspect-square w-full rounded-xl bg-surface-2 object-cover"
              />
            ) : (
              <div className="flex aspect-square w-full items-center justify-center rounded-xl bg-surface-2 text-3xl">
                📷
              </div>
            )}
            <div className="text-[11px] text-muted">
              צולם {ago(p.created_at, now)}
            </div>
            <input
              value={names[p.id] ?? ""}
              onChange={(e) =>
                setNames((prev) => ({ ...prev, [p.id]: e.target.value }))
              }
              placeholder="מה זה? (לא חובה)"
              className="h-10 w-full rounded-xl border border-line bg-surface px-2 text-base text-fg outline-none focus:border-brand"
            />
            <div className="flex gap-1.5">
              <button
                onClick={() => onHide(p)}
                className="h-10 w-10 shrink-0 rounded-xl text-xl text-faint"
                aria-label="לא צריך"
                title="לא צריך"
              >
                ×
              </button>
              <button
                onClick={() => onAdd(p, names[p.id] ?? "")}
                className="h-10 flex-1 rounded-xl bg-brand text-sm font-bold text-brand-fg active:bg-brand-strong"
              >
                + לרשימה
              </button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
