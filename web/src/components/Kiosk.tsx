"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";
import { beep, createDetector, pickProductCode } from "@/lib/barcode";
import { fetchProductInfo } from "@/lib/nutrition";
import { displayName } from "@/lib/text";
import { ProductImage } from "./ProductImage";
import { notifyEvent } from "@/lib/push";
import { isPerson, type Member } from "@/lib/types";

const KIOSK_FLAG = "kioskMode";
const SAME_CODE_COOLDOWN_MS = 8000; // the same product scanned twice in a row = one scan
const UNDO_MS = 8000;
const WHO_MS = 2 * 60 * 1000; // "who is scanning" stays selected for two minutes, then goes back to anonymous

type Scan = { id: string; code: string; name: string; scanned_at: string };

export function isKioskDevice(): boolean {
  try {
    return localStorage.getItem(KIOSK_FLAG) === "1";
  } catch {
    return false;
  }
}

/**
 * The fixed scanner by the bin: the camera is always on; scanning the barcode of a finished product
 * records it as "ran out" (consumed_items). On the site it shows up under "ran out recently" with quick add to the list.
 */
export default function Kiosk() {
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  const [family, setFamily] = useState<boolean | null>(null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) =>
      setSession(s),
    );
    return () => sub.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!session) return;
    supabase
      .from("family_members")
      .select("email")
      .ilike("email", session.user.email ?? "")
      .then(({ data, error }) =>
        setFamily(!error && !!data && data.length > 0),
      );
  }, [session]);

  if (session === undefined || (session && family === null))
    return <Center>טוען...</Center>;
  if (!session)
    return (
      <Center>
        <p className="mb-4">כדי להפעיל את הסורק צריך להתחבר פעם אחת</p>
        <button
          onClick={() =>
            supabase.auth.signInWithOAuth({
              provider: "google",
              options: { redirectTo: `${window.location.origin}/scanner` },
            })
          }
          className="h-12 rounded-2xl bg-brand px-6 font-bold text-brand-fg"
        >
          כניסה עם Google
        </button>
      </Center>
    );
  if (!family) return <Center>החשבון {session.user.email} לא מאושר.</Center>;
  return <Station />;
}

function Center({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center bg-[#0b0f0d] p-6 text-center text-[#e9efea]">
      {children}
    </div>
  );
}

function Station() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [status, setStatus] = useState("מפעיל מצלמה...");
  const [error, setError] = useState<string | null>(null);
  const [last, setLast] = useState<(Scan & { at: number }) | null>(null);
  const [recent, setRecent] = useState<Scan[]>([]);
  const [kiosk, setKiosk] = useState(isKioskDevice);
  // Who is scanning (optional): so whoever chose "ran out only from Odelia's scans" gets just those
  const [members, setMembers] = useState<
    { email: string; display_name: string | null }[]
  >([]);
  const [who, setWho] = useState<{ email: string; until: number } | null>(null);
  const whoRef = useRef<{ email: string; until: number } | null>(null);
  useEffect(() => {
    whoRef.current = who;
  }, [who]);
  useEffect(() => {
    supabase
      .from("family_members")
      .select("*")
      .then(({ data }) =>
        // "who's scanning" - people only (not the scanner's own account)
        setMembers(((data as Member[]) ?? []).filter(isPerson)),
      );
  }, []);
  const [now, setNow] = useState(() => Date.now());

  const loadRecent = useCallback(async () => {
    const { data } = await supabase
      .from("consumed_items")
      .select("id,code,name,scanned_at")
      .order("scanned_at", { ascending: false })
      .limit(6);
    setRecent((data as Scan[]) ?? []);
  }, []);

  const record = useCallback(
    async (code: string) => {
      const { data } = await supabase.rpc("search_products", {
        q: code,
        lim: 1,
      });
      let name = (data as { name: string }[] | null)?.[0]?.name;
      if (!name)
        name = (await fetchProductInfo(code))?.off_name || `מוצר ${code}`;
      const { data: row, error } = await supabase
        .from("consumed_items")
        .insert({
          code,
          name,
          device: "bin-scanner",
          scanned_as:
            whoRef.current && whoRef.current.until > Date.now()
              ? whoRef.current.email.toLowerCase()
              : null,
        })
        .select("id,code,name,scanned_at")
        .single();
      if (error || !row) {
        beep(false);
        setStatus("שמירה נכשלה - בדקו חיבור לאינטרנט");
        return;
      }
      beep(true);
      navigator.vibrate?.(80);
      notifyEvent("ran_out", (row as Scan).id);
      setLast({ ...(row as Scan), at: Date.now() });
      setStatus("מוכן לסריקה הבאה");
      loadRecent();
    },
    [loadRecent],
  );

  // The camera + scanning loop, with automatic recovery when the camera drops
  useEffect(() => {
    let stream: MediaStream | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let stopped = false;
    let busy = false;
    const recentCodes = new Map<string, number>();

    async function start() {
      try {
        setError(null);
        stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: { ideal: "environment" },
            width: { ideal: 960 },
            height: { ideal: 540 },
          },
          audio: false,
        });
        stream
          .getVideoTracks()[0]
          ?.addEventListener(
            "ended",
            () => !stopped && setTimeout(start, 3000),
          );
        const v = videoRef.current!;
        v.srcObject = stream;
        await v.play();
        const detector = await createDetector();
        setStatus("קרבו ברקוד של מוצר שנגמר");
        const tick = async () => {
          if (stopped) return;
          if (!busy && v.readyState >= 2) {
            try {
              const code = pickProductCode(await detector.detect(v));
              const t = Date.now();
              if (
                code &&
                t - (recentCodes.get(code) ?? 0) > SAME_CODE_COOLDOWN_MS
              ) {
                recentCodes.set(code, t);
                busy = true;
                setStatus("רושם...");
                await record(code);
                busy = false;
              }
            } catch {
              busy = false;
            }
          }
          timer = setTimeout(tick, 250);
        };
        tick();
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        setError(
          /denied|NotAllowed/i.test(msg)
            ? "אין הרשאה למצלמה. אשרו גישה בהגדרות הדפדפן."
            : "המצלמה לא זמינה, מנסה שוב...",
        );
        if (!stopped) setTimeout(start, 5000);
      }
    }
    start();
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, [record]);

  // Keep the screen on (Wake Lock), and renew it when the page comes back to the foreground
  useEffect(() => {
    let lock: { release: () => Promise<void> } | null = null;
    const nav = navigator as unknown as {
      wakeLock?: {
        request: (t: "screen") => Promise<{ release: () => Promise<void> }>;
      };
    };
    const acquire = async () => {
      try {
        if (document.visibilityState === "visible" && nav.wakeLock)
          lock = await nav.wakeLock.request("screen");
      } catch {}
    };
    acquire();
    document.addEventListener("visibilitychange", acquire);
    return () => {
      document.removeEventListener("visibilitychange", acquire);
      lock?.release().catch(() => {});
    };
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial load from the server
    loadRecent();
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [loadRecent]);

  const undo = async () => {
    if (!last) return;
    await supabase.from("consumed_items").delete().eq("id", last.id);
    setLast(null);
    setStatus("בוטל. קרבו ברקוד של מוצר שנגמר");
    loadRecent();
  };

  const toggleKiosk = () => {
    try {
      if (kiosk) localStorage.removeItem(KIOSK_FLAG);
      else localStorage.setItem(KIOSK_FLAG, "1");
    } catch {}
    setKiosk(!kiosk);
  };

  const showLast = last && now - last.at < 15000;
  const canUndo = last && now - last.at < UNDO_MS;

  return (
    <div className="flex h-dvh flex-col bg-[#0b0f0d] text-[#e9efea]">
      <div className="relative h-[42dvh] shrink-0 overflow-hidden">
        <video
          ref={videoRef}
          playsInline
          muted
          className="absolute inset-0 h-full w-full object-cover opacity-90"
        />
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <div className="h-32 w-64 rounded-2xl border-4 border-[#ffffff]/80 shadow-[0_0_0_9999px_rgba(0,0,0,0.45)]" />
        </div>
        <div className="absolute inset-x-0 top-0 p-3 text-center text-sm font-medium">
          🗑️ סורק &quot;נגמר&quot; · {error ?? status}
        </div>
      </div>

      <div className="flex-1 space-y-3 overflow-y-auto p-4">
        <div className="space-y-1.5">
          <div className="text-xs text-[#a0aca5]">מי סורק? (לא חובה)</div>
          <div className="flex flex-wrap gap-2">
            {members.map((m) => {
              const active = !!who && who.email === m.email && who.until > now;
              return (
                <button
                  key={m.email}
                  onClick={() =>
                    setWho(
                      active
                        ? null
                        : { email: m.email, until: Date.now() + WHO_MS },
                    )
                  }
                  className={`min-h-10 rounded-full px-4 text-sm font-medium ${
                    active
                      ? "bg-[#3cc985] text-[#062014]"
                      : "bg-[#ffffff]/10 text-[#e9efea]"
                  }`}
                >
                  {m.display_name || m.email.split("@")[0]}
                  {active
                    ? ` · ${Math.ceil((who!.until - now) / 60000)} דק׳`
                    : ""}
                </button>
              );
            })}
          </div>
        </div>

        {showLast ? (
          <div className="flex items-center gap-3 rounded-2xl bg-[#15301f] p-3">
            <ProductImage code={last.code} size={64} />
            <div className="min-w-0 flex-1">
              <div className="text-sm text-[#5ad89a]">✓ נרשם שנגמר</div>
              <div className="line-clamp-2 text-lg font-bold leading-snug">
                {displayName(last.name)}
              </div>
            </div>
            {canUndo && (
              <button
                onClick={undo}
                className="h-11 shrink-0 rounded-2xl bg-[#ffffff]/15 px-4 font-bold"
              >
                ביטול
              </button>
            )}
          </div>
        ) : (
          <div className="rounded-2xl bg-[#ffffff]/5 p-4 text-center text-[#a0aca5]">
            לפני שזורקים אריזה ריקה - מקרבים את הברקוד למצלמה. זה יופיע באתר
            בלשונית &quot;נגמר&quot;.
          </div>
        )}

        {recent.length > 0 && (
          <div className="space-y-1.5">
            <div className="text-xs font-bold text-[#a0aca5]">
              נסרקו לאחרונה
            </div>
            {recent.map((r) => (
              <div
                key={r.id}
                className="flex items-center justify-between gap-2 text-sm"
              >
                <span className="truncate">{displayName(r.name)}</span>
                <span className="shrink-0 text-xs text-[#727e77]">
                  {new Date(r.scanned_at).toLocaleString("he-IL", {
                    weekday: "short",
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="flex items-center justify-between gap-2 border-t border-[#ffffff]/10 p-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] text-xs">
        <button
          onClick={toggleKiosk}
          className="min-h-10 rounded-full bg-[#ffffff]/10 px-3 font-medium"
        >
          {kiosk ? "📌 זה הסורק הקבוע (לחצו לביטול)" : "📌 זה הסורק הקבוע"}
        </button>
        <button
          // A full page load on purpose: in client-side navigation the kiosk redirect check in App runs
          // before the URL updates (?app=1 is missing) and bounces back to /scanner. Caught in the kiosk test.
          // eslint-disable-next-line @next/next/no-location-assign-relative-destination
          onClick={() => window.location.assign("/?app=1")}
          className="flex min-h-10 items-center px-2 text-[#a0aca5] underline"
        >
          לאפליקציה הרגילה
        </button>
      </div>
    </div>
  );
}
