"use client";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { DEFAULT_PREFS, KIOSK_SOURCE, type Prefs } from "@/lib/notify-rules";
import {
  disablePush,
  enablePush,
  pushState,
  sendTestPush,
  type PushState,
} from "@/lib/push";
import type { Member } from "@/lib/types";

type Opt<T extends string> = [T, string, string?];

/** Personal settings: each family member picks for themselves which notifications to get. Saved automatically. */
export function SettingsView({
  me,
  members,
  onRenamed,
}: {
  me: string;
  members: Member[];
  onRenamed: (name: string) => void;
}) {
  const [prefs, setPrefs] = useState<Prefs | null>(null);
  const [push, setPush] = useState<PushState | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const myRow = members.find((m) => m.email.toLowerCase() === me.toLowerCase());
  const [name, setName] = useState(myRow?.display_name ?? "");

  useEffect(() => {
    supabase
      .from("notification_prefs")
      .select("*")
      .ilike("email", me)
      .maybeSingle()
      .then(({ data }) =>
        setPrefs((data as Prefs | null) ?? { email: me, ...DEFAULT_PREFS }),
      );
    pushState().then(setPush);
  }, [me]);

  const save = async (patch: Partial<Prefs>) => {
    const next = { ...prefs!, ...patch, email: me };
    setPrefs(next);
    const { error } = await supabase
      .from("notification_prefs")
      .upsert({ ...next, updated_at: new Date().toISOString() });
    setNote(error ? "השמירה נכשלה: " + error.message : "נשמר ✓");
    setTimeout(() => setNote(null), 1500);
  };

  const togglePush = async () => {
    setBusy(true);
    try {
      setPush(push === "on" ? await disablePush() : await enablePush(me));
    } catch (e) {
      setNote(
        "לא הצלחתי להפעיל: " + (e instanceof Error ? e.message : String(e)),
      );
    }
    setBusy(false);
  };

  const test = async () => {
    setBusy(true);
    const r = await sendTestPush();
    setNote(
      r.ok
        ? r.sent
          ? "נשלחה התראת בדיקה ✓"
          : "אין מכשיר רשום להתראות"
        : r.error?.includes("not set")
          ? "השרת עוד לא הוגדר לשליחה (חסרים מפתחות ב-Vercel)"
          : "השליחה נכשלה",
    );
    setBusy(false);
  };

  const saveName = async () => {
    const n = name.trim();
    if (!n || n === myRow?.display_name) return;
    await supabase
      .from("family_members")
      .update({ display_name: n })
      .ilike("email", me);
    onRenamed(n);
    setNote("נשמר ✓");
    setTimeout(() => setNote(null), 1500);
  };

  if (!prefs) return <p className="text-sm text-muted">טוען...</p>;

  const fromAll = !prefs.ran_out_from || prefs.ran_out_from.length === 0;
  const toggleFrom = (src: string) => {
    const cur = new Set((prefs.ran_out_from ?? []).map((x) => x.toLowerCase()));
    if (cur.has(src.toLowerCase())) cur.delete(src.toLowerCase());
    else cur.add(src.toLowerCase());
    save({ ran_out_from: cur.size ? [...cur] : null });
  };
  const sources: [string, string][] = [
    ...members.map(
      (m) =>
        [m.email.toLowerCase(), m.display_name || m.email.split("@")[0]] as [
          string,
          string,
        ],
    ),
    [KIOSK_SOURCE, "סורק הפח (בלי שם)"],
  ];

  return (
    <div className="space-y-5 pb-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-extrabold">⚙️ הגדרות</h2>
        {note && <span className="text-sm font-medium text-brand">{note}</span>}
      </div>

      <Card title="🔔 התראות במכשיר הזה">
        {push === "unsupported" && (
          <p className="text-sm text-muted">הדפדפן הזה לא תומך בהתראות.</p>
        )}
        {push === "ios-needs-install" && (
          <p className="text-sm text-muted">
            באייפון התראות עובדות רק מהאפליקציה המותקנת: בספארי לחצו שיתוף ⇐
            &quot;הוסף למסך הבית&quot;, פתחו משם והפעילו כאן.
          </p>
        )}
        {push === "denied" && (
          <p className="text-sm text-warn">
            ההתראות חסומות לאתר הזה. אפשרו אותן בהגדרות הדפדפן (הרשאות האתר)
            וחזרו לכאן.
          </p>
        )}
        {(push === "on" || push === "off") && (
          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={togglePush}
              disabled={busy}
              className={`h-11 rounded-2xl px-4 font-bold shadow-card disabled:opacity-40 ${
                push === "on"
                  ? "bg-surface-2 text-fg"
                  : "bg-brand text-brand-fg active:bg-brand-strong"
              }`}
            >
              {push === "on" ? "כבו התראות במכשיר" : "הפעילו התראות במכשיר"}
            </button>
            {push === "on" && (
              <button
                onClick={test}
                disabled={busy}
                className="h-11 rounded-2xl bg-surface-2 px-4 font-medium text-fg"
              >
                שליחת בדיקה
              </button>
            )}
          </div>
        )}
        <p className="text-xs text-faint">
          ההעדפות למטה שייכות לחשבון שלכם וחלות על כל המכשירים שבהם הפעלתם
          התראות.
        </p>
      </Card>

      <Card title="🛒 תוספות לרשימה">
        <Radio<Prefs["list_adds"]>
          value={prefs.list_adds}
          onChange={(v) => save({ list_adds: v })}
          options={[
            [
              "in_store",
              "רק כשאני בסופר",
              'כשבחרתם סניף ב"אני עכשיו ב" - כדי לא לפספס משהו שנוסף בדרך',
            ],
            ["always", "תמיד"],
            ["off", "בלי"],
          ]}
        />
      </Card>

      <Card title="🗑️ נגמר (סורק הפח)">
        <Radio<Prefs["ran_out"]>
          value={prefs.ran_out}
          onChange={(v) => save({ ran_out: v })}
          options={[
            ["daily", "סיכום פעם ביום"],
            ["each", "על כל סריקה"],
            ["off", "בלי"],
          ]}
        />
        {prefs.ran_out !== "off" && (
          <div className="space-y-2">
            <div className="text-sm text-muted">מסריקות של:</div>
            <div className="flex flex-wrap gap-2">
              <Chip
                active={fromAll}
                onClick={() => save({ ran_out_from: null })}
              >
                כולם
              </Chip>
              {sources.map(([key, label]) => (
                <Chip
                  key={key}
                  active={
                    !fromAll &&
                    (prefs.ran_out_from ?? []).some(
                      (x) => x.toLowerCase() === key,
                    )
                  }
                  onClick={() => toggleFrom(key)}
                >
                  {label}
                </Chip>
              ))}
            </div>
          </div>
        )}
      </Card>

      <Card title="🔥 מבצעים">
        <Radio<Prefs["deals"]>
          value={prefs.deals}
          onChange={(v) => save({ deals: v })}
          options={[
            ["daily", "סיכום פעם ביום"],
            ["each", "כל מבצע אמיתי חדש", "עד 3 בכל פעם, בלי כפילויות"],
            ["off", "בלי"],
          ]}
        />
        {prefs.deals !== "off" && <div className="border-t border-line pt-3 text-sm text-muted">על אילו מוצרים:</div>}
        {prefs.deals !== "off" && (
          <Radio<Prefs["deals_scope"]>
            value={prefs.deals_scope}
            onChange={(v) => save({ deals_scope: v })}
            options={[
              [
                "ours",
                "רק על מה שאנחנו קונים",
                "לומד מהקניות, מהרשימה ומסורק הפח - משתפר עם הזמן",
              ],
              ["ours_plus_top", "וגם המבצעים החזקים ביותר באזור"],
            ]}
          />
        )}
      </Card>

      <Card title="⏰ זמנים">
        <label className="flex items-center justify-between gap-3 text-sm">
          <span>שעת הסיכום היומי</span>
          <select
            value={prefs.digest_hour}
            onChange={(e) => save({ digest_hour: Number(e.target.value) })}
            className="h-10 rounded-xl border border-line bg-surface px-3 font-semibold text-fg"
          >
            {Array.from({ length: 18 }, (_, i) => i + 6).map((h) => (
              <option key={h} value={h}>
                {String(h).padStart(2, "0")}:00
              </option>
            ))}
          </select>
        </label>
        <label className="flex min-h-10 items-center justify-between gap-3 text-sm">
          <span>
            שעות שקט{" "}
            <span className="text-muted">
              (22:00-07:00, בלי התראות &quot;על כל&quot;)
            </span>
          </span>
          <input
            type="checkbox"
            checked={prefs.quiet}
            onChange={(e) => save({ quiet: e.target.checked })}
            className="h-5 w-5 accent-[var(--brand)]"
          />
        </label>
      </Card>

      <Card title="🙂 השם שלי">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={saveName}
          placeholder="איך יקראו לכם ברשימה ובסורק"
          className="h-12 w-full rounded-2xl border border-line bg-surface px-4 text-base text-fg outline-none focus:border-brand"
        />
      </Card>
    </div>
  );
}

function Card({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-3 rounded-2xl border border-line bg-surface p-4 shadow-card">
      <h3 className="font-bold text-fg">{title}</h3>
      {children}
    </section>
  );
}

function Radio<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T;
  onChange: (v: T) => void;
  options: Opt<T>[];
}) {
  return (
    <div className="space-y-1" role="radiogroup">
      {options.map(([v, label, hint]) => (
        <button
          key={v}
          role="radio"
          aria-checked={value === v}
          onClick={() => onChange(v)}
          className="flex min-h-11 w-full items-start gap-3 rounded-xl px-1 py-2 text-start"
        >
          <span
            className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 ${
              value === v ? "border-brand" : "border-faint/60"
            }`}
          >
            {value === v && (
              <span className="h-2.5 w-2.5 rounded-full bg-brand" />
            )}
          </span>
          <span>
            <span
              className={`block text-sm ${value === v ? "font-bold text-fg" : "text-fg"}`}
            >
              {label}
            </span>
            {hint && <span className="block text-xs text-muted">{hint}</span>}
          </span>
        </button>
      ))}
    </div>
  );
}

function Chip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      aria-pressed={active}
      className={`min-h-9 rounded-full border px-3.5 py-1.5 text-sm font-medium ${
        active
          ? "border-brand bg-brand text-brand-fg"
          : "border-line bg-surface text-fg"
      }`}
    >
      {children}
    </button>
  );
}
