"use client";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import {
  assess,
  DEFAULT_HEALTH,
  PROCESSING_TEXT,
  RED_LABEL_TEXT,
  type HealthPrefs,
  type Nutrition,
} from "@/lib/health";
import type { ProductInfo } from "@/lib/types";

export const CLAUDE_CHAT_URL =
  "https://claude.ai/code/session_01TvqDNenvBYSffSXwss596H";

export type Research = {
  code: string;
  ingredients_text: string | null;
  ingredients_n: number | null;
  additives: string[] | null;
  processing: "minimal" | "processed" | "ultra" | null;
  nutrition: Nutrition | null;
  reviews_summary: string | null;
  reviews_score: number | null;
  reviews_count: number | null;
  review_sources: { title: string; url: string }[] | null;
  updated_at: string;
};

const fmt = (v: number | null | undefined, d = 1) =>
  v == null ? "—" : String(Math.round(v * 10 ** d) / 10 ** d);

/** Merge nutrition: what the scheduled round found (research) wins; otherwise Open Food Facts. */
export function mergedNutrition(
  info: ProductInfo | null,
  r: Research | null,
): Nutrition {
  const off: Nutrition = info
    ? {
        kcal: info.kcal_100g,
        protein: info.protein_100g,
        fat: info.fat_100g,
        sat_fat: info.sat_fat_100g,
        carbs: info.carbs_100g,
        sugars: info.sugar_100g,
        fiber: info.fiber_100g,
        sodium_mg: info.sodium_100g != null ? info.sodium_100g * 1000 : null,
      }
    : {};
  const res = r?.nutrition ?? {};
  const out: Nutrition = { ...off };
  for (const [k, v] of Object.entries(res))
    if (v != null) (out as Record<string, number>)[k] = Number(v);
  return out;
}

/** Health: red labels, calories, protein, processing level, nutrition table and ingredients. */
export function HealthSection({
  info,
  research,
  prefs,
  liquid,
}: {
  info: ProductInfo | null;
  research: Research | null;
  prefs: HealthPrefs;
  liquid: boolean;
}) {
  const [showIngr, setShowIngr] = useState(false);
  const n = mergedNutrition(info, research);
  const hasNutrition = Object.values(n).some((v) => v != null);
  const ingrText = research?.ingredients_text ?? info?.ingredients_text ?? null;
  const a = assess(
    n,
    {
      nova: research?.processing
        ? { minimal: 1, processed: 3, ultra: 4 }[research.processing]
        : info?.nova,
      ingredients_n: research?.ingredients_n ?? info?.ingredients_n,
      additives: research?.additives ?? info?.additives,
      ingredients_text: ingrText,
    },
    prefs,
    liquid,
  );
  const per = liquid ? "100 מ״ל" : "100 גרם";

  return (
    <section className="space-y-3 rounded-2xl border border-line bg-surface p-4 shadow-card">
      <h3 className="font-bold text-fg">🍎 בריאות וערכים תזונתיים</h3>

      <div className="flex flex-wrap gap-2">
        {a.red.map((r) => (
          <span
            key={r}
            className="inline-flex items-center gap-1.5 rounded-lg bg-[#d32f2f] px-2 py-1 text-xs font-bold text-[#ffffff]"
          >
            ● {RED_LABEL_TEXT[r]}
          </span>
        ))}
        {a.highKcal && (
          <span className="rounded-lg bg-warn-soft px-2 py-1 text-xs font-bold text-warn">
            ⚡ {fmt(n.kcal, 0)} קל׳ ל-{per}
          </span>
        )}
        {a.proteinRatio != null && (
          <span
            className={`rounded-lg px-2 py-1 text-xs font-bold ${a.proteinGood ? "bg-brand-soft text-brand" : "bg-surface-2 text-muted"}`}
          >
            💪 {fmt(a.proteinRatio)} ג׳ חלבון ל-100 קל׳
            {a.proteinGood ? " · חלבוני" : ""}
          </span>
        )}
        <span
          className={`rounded-lg px-2 py-1 text-xs font-bold ${
            a.processing.level === "ultra"
              ? "bg-danger/15 text-danger"
              : a.processing.level === "processed"
                ? "bg-warn-soft text-warn"
                : a.processing.level === "minimal"
                  ? "bg-brand-soft text-brand"
                  : "bg-surface-2 text-muted"
          }`}
        >
          🏭 {PROCESSING_TEXT[a.processing.level]}
          {a.processing.ingredients != null
            ? ` · ${a.processing.ingredients} רכיבים`
            : ""}
        </span>
      </div>
      {a.processing.additives.length > 0 && (
        <p className="text-xs text-muted">
          תוספים: {a.processing.additives.slice(0, 8).join(", ")}
        </p>
      )}

      {hasNutrition ? (
        <table className="w-full text-sm">
          <caption className="pb-1 text-start text-xs text-muted">
            ערכים ל-{per}
          </caption>
          <tbody className="divide-y divide-line">
            {(
              [
                ["אנרגיה", n.kcal, "קל׳", 0],
                ["חלבונים", n.protein, "ג׳", 1],
                ["פחמימות", n.carbs, "ג׳", 1],
                ["מתוכן סוכרים", n.sugars, "ג׳", 1],
                ["שומנים", n.fat, "ג׳", 1],
                ["מתוכם שומן רווי", n.sat_fat, "ג׳", 1],
                ["סיבים תזונתיים", n.fiber, "ג׳", 1],
                ["נתרן", n.sodium_mg, "מ״ג", 0],
              ] as [string, number | null | undefined, string, number][]
            )
              .filter(([, v]) => v != null)
              .map(([label, v, unit, d]) => (
                <tr key={label}>
                  <td className="py-1.5 text-fg">{label}</td>
                  <td className="py-1.5 text-end tabular-nums font-semibold text-fg">
                    {fmt(v, d)} {unit}
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      ) : (
        <p className="text-sm text-muted">
          אין עדיין ערכים תזונתיים למוצר הזה.
        </p>
      )}

      {ingrText ? (
        <div>
          <button
            onClick={() => setShowIngr((v) => !v)}
            className="min-h-10 text-sm font-medium text-brand"
          >
            {showIngr ? "הסתרת רכיבים ▴" : "רשימת רכיבים ▾"}
          </button>
          {showIngr && (
            <p className="text-sm leading-relaxed text-fg">{ingrText}</p>
          )}
        </div>
      ) : (
        <p className="text-sm text-muted">אין עדיין רשימת רכיבים.</p>
      )}
      <p className="text-[11px] text-faint">
        מקור: {research ? "סבב המחקר + " : ""}Open Food Facts. סימון אדום לפי
        ספי משרד הבריאות. הספים האישיים - בהגדרות.
      </p>
    </section>
  );
}

/** Reviews from other websites (if the scheduled round found any). */
export function ReviewsSection({ research }: { research: Research | null }) {
  if (!research?.reviews_summary) return null;
  return (
    <section className="space-y-2 rounded-2xl border border-line bg-surface p-4 shadow-card">
      <h3 className="font-bold text-fg">⭐ ביקורות מהרשת</h3>
      {research.reviews_score != null && (
        <div className="text-sm font-semibold text-fg">
          {fmt(research.reviews_score)} / 5
          {research.reviews_count ? (
            <span className="font-normal text-muted">
              {" "}
              · לפי {research.reviews_count} ביקורות
            </span>
          ) : null}
        </div>
      )}
      <p className="text-sm leading-relaxed text-fg">
        {research.reviews_summary}
      </p>
      {research.review_sources?.length ? (
        <ul className="space-y-1 text-xs">
          {research.review_sources.slice(0, 5).map((s) => (
            <li key={s.url}>
              <a
                href={s.url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-brand underline"
              >
                {s.title || s.url}
              </a>
            </li>
          ))}
        </ul>
      ) : null}
      <p className="text-[11px] text-faint">
        עודכן {new Date(research.updated_at).toLocaleDateString("he-IL")}
      </p>
    </section>
  );
}

type Note = { id: string; body: string; author: string; created_at: string };

/** Family notes on the product ("the kids don't like it", "buy only from the Hadarim branch"). */
export function NotesSection({
  code,
  me,
  nameOf,
}: {
  code: string;
  me: string;
  nameOf: (email: string) => string;
}) {
  const [notes, setNotes] = useState<Note[] | null>(null);
  const [text, setText] = useState("");
  const load = async () => {
    const { data } = await supabase
      .from("product_notes")
      .select("id,body,author,created_at")
      .eq("code", code)
      .order("created_at");
    setNotes((data as Note[]) ?? []);
  };
  useEffect(() => {
    supabase
      .from("product_notes")
      .select("id,body,author,created_at")
      .eq("code", code)
      .order("created_at")
      .then(({ data }) => setNotes((data as Note[]) ?? []));
  }, [code]);
  const add = async () => {
    const body = text.trim();
    if (!body) return;
    setText("");
    await supabase.from("product_notes").insert({ code, body });
    load();
  };
  const remove = async (id: string) => {
    setNotes((prev) => prev?.filter((x) => x.id !== id) ?? null);
    await supabase.from("product_notes").delete().eq("id", id);
  };
  return (
    <section className="space-y-3 rounded-2xl border border-line bg-surface p-4 shadow-card">
      <h3 className="font-bold text-fg">📝 הערות</h3>
      {notes?.length ? (
        <ul className="space-y-2">
          {notes.map((x) => (
            <li
              key={x.id}
              className="flex items-start gap-2 rounded-xl bg-surface-2 p-2.5"
            >
              <div className="min-w-0 flex-1">
                <p className="text-sm text-fg">{x.body}</p>
                <p className="text-[11px] text-faint">
                  {nameOf(x.author)} ·{" "}
                  {new Date(x.created_at).toLocaleDateString("he-IL")}
                </p>
              </div>
              {x.author.toLowerCase() === me.toLowerCase() && (
                <button
                  onClick={() => remove(x.id)}
                  className="flex h-9 w-9 shrink-0 items-center justify-center text-faint"
                  aria-label="מחיקת הערה"
                >
                  ×
                </button>
              )}
            </li>
          ))}
        </ul>
      ) : (
        notes && <p className="text-sm text-muted">עוד אין הערות.</p>
      )}
      <div className="flex gap-2">
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && add()}
          maxLength={1000}
          placeholder="למשל: הילדים לא אוהבים, לקנות רק ביוחננוף..."
          className="h-11 min-w-0 flex-1 rounded-2xl border border-line bg-surface px-3 text-base text-fg outline-none focus:border-brand"
        />
        <button
          onClick={add}
          disabled={!text.trim()}
          className="h-11 shrink-0 rounded-2xl bg-brand px-4 text-sm font-bold text-brand-fg disabled:opacity-40"
        >
          הוסיפו
        </button>
      </div>
    </section>
  );
}

type Req = {
  id: string;
  kind: "search" | "photo";
  status: string;
  requested_at: string;
  result_note: string | null;
};

/** Downscale a phone photo before upload (up to 1600px, JPEG) - fast and saves space. */
async function shrink(file: File): Promise<Blob> {
  try {
    const bmp = await createImageBitmap(file);
    const scale = Math.min(1, 1600 / Math.max(bmp.width, bmp.height));
    const c = document.createElement("canvas");
    c.width = Math.round(bmp.width * scale);
    c.height = Math.round(bmp.height * scale);
    c.getContext("2d")!.drawImage(bmp, 0, 0, c.width, c.height);
    return await new Promise((res) =>
      c.toBlob((b) => res(b ?? file), "image/jpeg", 0.85),
    );
  } catch {
    return file;
  }
}

/**
 * Missing information? Three ways: mark for the next round, upload a back-of-pack photo (also for the next round),
 * or ask Claude now in the chat (copies a ready request and opens the conversation).
 */
export function ResearchSection({
  code,
  name,
  research,
}: {
  code: string;
  name: string;
  research: Research | null;
}) {
  const [reqs, setReqs] = useState<Req[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const load = async () => {
    const { data } = await supabase
      .from("research_requests")
      .select("id,kind,status,requested_at,result_note")
      .eq("code", code)
      .order("requested_at", { ascending: false })
      .limit(5);
    setReqs((data as Req[]) ?? []);
  };
  useEffect(() => {
    supabase
      .from("research_requests")
      .select("id,kind,status,requested_at,result_note")
      .eq("code", code)
      .order("requested_at", { ascending: false })
      .limit(5)
      .then(({ data }) => setReqs((data as Req[]) ?? []));
  }, [code]);
  const pending = reqs?.filter((r) => r.status === "pending") ?? [];

  const requestSearch = async () => {
    setBusy(true);
    await supabase
      .from("research_requests")
      .insert({ code, name, kind: "search" });
    await load();
    setBusy(false);
  };
  const upload = async (files: FileList | null) => {
    if (!files?.length) return;
    setBusy(true);
    setNote(null);
    let ok = 0;
    for (const f of Array.from(files).slice(0, 4)) {
      const blob = await shrink(f);
      const path = `${code}/${crypto.randomUUID()}.jpg`;
      const { error } = await supabase.storage
        .from("product-photos")
        .upload(path, blob, { contentType: "image/jpeg" });
      if (!error) {
        await supabase
          .from("research_requests")
          .insert({ code, name, kind: "photo", photo_path: path });
        ok++;
      }
    }
    setNote(ok ? `הועלו ${ok} צילומים - יעובדו בסבב הבא` : "ההעלאה נכשלה");
    await load();
    setBusy(false);
  };
  const askNow = async () => {
    const prompt = `חפש מידע על המוצר "${name}" (ברקוד ${code}): רכיבים, ערכים תזונתיים, רמת עיבוד וביקורות מהרשת, ועדכן ב-SuperBadash.`;
    try {
      await navigator.clipboard.writeText(prompt);
      setNote("הבקשה הועתקה - הדביקו ושלחו בצ'אט שנפתח");
    } catch {
      setNote(prompt);
    }
    window.open(CLAUDE_CHAT_URL, "_blank", "noopener");
  };

  return (
    <section className="space-y-3 rounded-2xl border border-line bg-surface p-4 shadow-card">
      <h3 className="font-bold text-fg">🔎 חסר מידע?</h3>
      {pending.length > 0 ? (
        <p className="rounded-xl bg-info-soft p-2.5 text-sm text-info">
          ממתין לסבב הבא:{" "}
          {pending
            .map((r) => (r.kind === "photo" ? "צילום" : "חיפוש"))
            .join(", ")}
        </p>
      ) : research ? (
        <p className="text-xs text-muted">
          נבדק בסבב המחקר ב-
          {new Date(research.updated_at).toLocaleDateString("he-IL")}.
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <button
          onClick={requestSearch}
          disabled={busy || pending.some((r) => r.kind === "search")}
          className="h-11 rounded-2xl bg-surface-2 px-4 text-sm font-semibold text-fg disabled:opacity-50"
        >
          {pending.some((r) => r.kind === "search")
            ? "✓ סומן לחיפוש"
            : "חפשו לי בסבב הבא"}
        </button>
        <label
          className={`flex h-11 cursor-pointer items-center rounded-2xl bg-surface-2 px-4 text-sm font-semibold text-fg ${busy ? "opacity-50" : ""}`}
        >
          📷 צילום גב האריזה
          <input
            type="file"
            accept="image/*"
            capture="environment"
            multiple
            className="hidden"
            disabled={busy}
            onChange={(e) => upload(e.target.files)}
          />
        </label>
        <button
          onClick={askNow}
          className="h-11 rounded-2xl bg-surface-2 px-4 text-sm font-semibold text-fg"
        >
          💬 שאלו את Claude עכשיו
        </button>
      </div>
      {note && <p className="text-xs text-muted">{note}</p>}
      {reqs?.find((r) => r.status === "done" && r.result_note) && (
        <p className="text-xs text-muted">
          מהסבב האחרון:{" "}
          {reqs.find((r) => r.status === "done" && r.result_note)!.result_note}
        </p>
      )}
    </section>
  );
}

export { DEFAULT_HEALTH };
