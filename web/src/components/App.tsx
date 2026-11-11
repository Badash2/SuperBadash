"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";
import type { ListItem, Member, PriceRow, ProductInfo, Store } from "@/lib/types";
import { toPriceMap } from "@/lib/pricing";
import { fetchProductInfo, normalizeInfo } from "@/lib/nutrition";
import { ListView } from "./ListView";
import { CompareView } from "./CompareView";
import { DealsView } from "./DealsView";

type Tab = "list" | "compare" | "deals";
type Gate = "loading" | "signed-out" | "not-family" | "ok";

export default function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [gate, setGate] = useState<Gate>("loading");

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      if (!data.session) setGate("signed-out");
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => {
      setSession(s);
      if (!s) setGate("signed-out");
    });
    // Clean the URL after returning from Google (?code=...)
    if (typeof window !== "undefined" && window.location.search.includes("code=")) {
      setTimeout(() => window.history.replaceState({}, "", window.location.pathname), 1500);
    }
    return () => sub.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!session) return;
    // Membership check: RLS returns a row only for an approved family member
    supabase
      .from("family_members")
      .select("email")
      .ilike("email", session.user.email ?? "")
      .then(({ data, error }) => setGate(!error && data && data.length > 0 ? "ok" : "not-family"));
  }, [session]);

  if (gate === "loading") return <Splash text="טוען..." />;
  if (gate === "signed-out") return <Login />;
  if (gate === "not-family")
    return (
      <Splash text={`החשבון ${session?.user.email} עוד לא מאושר. בקשו מאבא להוסיף אותו.`}>
        <button onClick={() => supabase.auth.signOut()} className="mt-4 rounded-lg bg-slate-800 px-4 py-2 text-white">
          התנתקות
        </button>
      </Splash>
    );
  return <Main session={session!} />;
}

function Splash({ text, children }: { text: string; children?: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center p-6 text-center">
      <div className="text-5xl">🛒</div>
      <p className="mt-3 text-slate-600 dark:text-slate-300">{text}</p>
      {children}
    </div>
  );
}

function Login() {
  // Login is rendered only on the client (after the session check), so window can be read directly
  const [err] = useState<string | null>(() => {
    const p = new URLSearchParams(window.location.search);
    return p.get("error_description") || p.get("error");
  });
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-6 p-6 text-center">
      <div>
        <div className="text-6xl">🛒</div>
        <h1 className="mt-2 text-3xl font-bold">SuperBadash</h1>
        <p className="mt-1 text-slate-500">רשימת הקניות של משפחת בדש</p>
      </div>
      <button
        onClick={() =>
          supabase.auth.signInWithOAuth({
            provider: "google",
            options: { redirectTo: window.location.origin, queryParams: { prompt: "select_account" } },
          })
        }
        className="flex items-center gap-3 rounded-xl border border-slate-300 bg-white px-6 py-3 font-semibold text-slate-800 shadow-sm active:bg-slate-50"
      >
        <svg width="20" height="20" viewBox="0 0 48 48" aria-hidden="true">
          <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
          <path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
          <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z" />
          <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
        </svg>
        כניסה עם Google
      </button>
      {err && <p className="max-w-sm text-sm text-rose-600">שגיאת התחברות: {err}</p>}
    </div>
  );
}

function Main({ session }: { session: Session }) {
  const me = session.user.email ?? "";
  const [tab, setTab] = useState<Tab>("list");
  const [stores, setStores] = useState<Store[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [items, setItems] = useState<ListItem[]>([]);
  const [priceRows, setPriceRows] = useState<PriceRow[]>([]);
  const [infos, setInfos] = useState<Map<string, ProductInfo>>(new Map());
  const [aisle, setAisle] = useState<Map<string, number>>(new Map());
  const [boughtCodes, setBoughtCodes] = useState<string[]>([]);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  // Main is rendered only on the client (after login), so localStorage can be read in the initialiser
  const [currentStore, setCurrentStoreState] = useState(() => {
    try {
      return localStorage.getItem("currentStore") ?? "";
    } catch {
      return "";
    }
  });
  const setCurrentStore = (s: string) => {
    setCurrentStoreState(s);
    try {
      localStorage.setItem("currentStore", s);
    } catch {}
  };

  const loadItems = useCallback(async () => {
    const { data } = await supabase.from("shopping_items").select("*").order("added_at");
    if (data) setItems((data as ListItem[]).map((i) => ({ ...i, quantity: Number(i.quantity) || 1 })));
  }, []);

  // Fixed data: stores, family, purchase history, update time
  useEffect(() => {
    (async () => {
      const [s, m, p, st] = await Promise.all([
        supabase.from("stores").select("store_key,name,chain").eq("role", "primary").order("store_key"),
        supabase.from("family_members").select("email,display_name"),
        supabase.from("purchases").select("code").not("code", "is", null).order("purchased_at", { ascending: false }).limit(300),
        supabase.rpc("data_status"),
      ]);
      const extra = await supabase.from("stores").select("store_key,name,chain").eq("role", "secondary");
      setStores([...((s.data as Store[]) ?? []), ...((extra.data as Store[]) ?? [])].filter((x) => x.store_key !== "rami-levy-orzim"));
      setMembers((m.data as Member[]) ?? []);
      setBoughtCodes([...new Set(((p.data as { code: string }[]) ?? []).map((r) => r.code))]);
      const times = ((st.data as { prices_at: string }[]) ?? []).map((r) => r.prices_at).sort();
      setUpdatedAt(times.at(-1) ?? null);
      await loadItems();
    })();
    const ch = supabase
      .channel("shopping_items")
      .on("postgres_changes", { event: "*", schema: "public", table: "shopping_items" }, () => loadItems())
      .subscribe();
    const onFocus = () => loadItems();
    window.addEventListener("focus", onFocus);
    return () => {
      supabase.removeChannel(ch);
      window.removeEventListener("focus", onFocus);
    };
  }, [loadItems]);

  // Prices and nutrition for the codes on the list
  const codesKey = useMemo(() => [...new Set(items.map((i) => i.code).filter(Boolean))].sort().join(","), [items]);
  useEffect(() => {
    const codes = codesKey ? codesKey.split(",") : [];
    if (codes.length === 0) return; // stale prices for codes no longer on the list are harmless
    let cancelled = false;
    (async () => {
      const [pr, pi] = await Promise.all([
        supabase.rpc("prices_for", { codes }),
        supabase.from("product_info").select("*").in("code", codes),
      ]);
      if (cancelled) return;
      setPriceRows((pr.data as PriceRow[]) ?? []);
      const map = new Map(((pi.data as ProductInfo[]) ?? []).map((i) => [i.code, normalizeInfo(i)]));
      setInfos(new Map(map));
      for (const c of codes.filter((c) => !map.has(c))) {
        const info = await fetchProductInfo(c);
        if (cancelled) return;
        if (info) setInfos((prev) => new Map(prev).set(c, info));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [codesKey]);

  useEffect(() => {
    if (!currentStore) return; // ListView uses aisle only when a store is selected
    supabase.rpc("aisle_order", { p_store: currentStore }).then(({ data }) => {
      setAisle(new Map(((data as { item_key: string; pos: number }[]) ?? []).map((r) => [r.item_key, r.pos])));
    });
  }, [currentStore]);

  const prices = useMemo(() => toPriceMap(priceRows), [priceRows]);

  const onAdd = async ({ code, name }: { code: string | null; name: string }) => {
    const existing = items.find((i) => !i.checked && (code ? i.code === code : i.name === name));
    if (existing) {
      await onQty(existing, 1);
      return;
    }
    const { data } = await supabase.from("shopping_items").insert({ code, name }).select().single();
    if (data) setItems((prev) => [...prev, { ...(data as ListItem), quantity: Number((data as ListItem).quantity) || 1 }]);
  };
  const onToggle = async (it: ListItem) => {
    const patch = it.checked
      ? { checked: false, checked_at: null, checked_by: null, checked_store: null }
      : { checked: true, checked_at: new Date().toISOString(), checked_by: me, checked_store: currentStore || null };
    setItems((prev) => prev.map((x) => (x.id === it.id ? { ...x, ...patch } : x)));
    await supabase.from("shopping_items").update(patch).eq("id", it.id);
  };
  const onQty = async (it: ListItem, delta: number) => {
    const quantity = Math.max(1, Number(it.quantity) + delta);
    setItems((prev) => prev.map((x) => (x.id === it.id ? { ...x, quantity } : x)));
    await supabase.from("shopping_items").update({ quantity }).eq("id", it.id);
  };
  const onDelete = async (it: ListItem) => {
    setItems((prev) => prev.filter((x) => x.id !== it.id));
    await supabase.from("shopping_items").delete().eq("id", it.id);
  };
  const onFinish = async () => {
    const done = items.filter((i) => i.checked).sort((a, b) => (a.checked_at ?? "").localeCompare(b.checked_at ?? ""));
    if (done.length === 0 || !confirm(`לסיים קנייה ולהעביר ${done.length} פריטים להיסטוריה?`)) return;
    const trip = crypto.randomUUID();
    const { error } = await supabase.from("purchases").insert(
      done.map((it, i) => ({
        trip_id: trip,
        code: it.code,
        name: it.name,
        quantity: it.quantity,
        store_key: it.checked_store,
        seq: i,
        purchased_at: it.checked_at,
        purchased_by: it.checked_by ?? me,
      })),
    );
    if (error) {
      alert("שמירת הקנייה נכשלה: " + error.message);
      return;
    }
    await supabase.from("shopping_items").delete().in("id", done.map((d) => d.id));
    setItems((prev) => prev.filter((x) => !x.checked));
    setBoughtCodes((prev) => [...new Set([...done.map((d) => d.code).filter((c): c is string => !!c), ...prev])]);
  };

  const myCodes = useMemo(
    () => [...new Set([...items.map((i) => i.code).filter((c): c is string => !!c), ...boughtCodes])].slice(0, 200),
    [items, boughtCodes],
  );
  const openCount = items.filter((i) => !i.checked).length;

  return (
    <div className="mx-auto flex min-h-dvh max-w-2xl flex-col">
      <header className="sticky top-0 z-30 flex items-center justify-between border-b border-slate-200 bg-white/90 px-4 py-3 backdrop-blur dark:border-slate-800 dark:bg-slate-950/90">
        <div>
          <h1 className="text-lg font-bold">🛒 SuperBadash</h1>
          {updatedAt && (
            <div className="text-[11px] text-slate-500">
              מחירים עודכנו: {new Date(updatedAt + "Z").toLocaleString("he-IL", { dateStyle: "short", timeStyle: "short" })}
            </div>
          )}
        </div>
        <button onClick={() => supabase.auth.signOut()} className="text-xs text-slate-500" title={me}>
          {session.user.user_metadata?.full_name ?? me} · יציאה
        </button>
      </header>

      <main className="flex-1 px-4 pb-28 pt-4">
        {tab === "list" && (
          <ListView
            {...{ items, prices, infos, stores, members, currentStore, setCurrentStore, aisle, onAdd, onToggle, onQty, onDelete, onFinish }}
          />
        )}
        {tab === "compare" && <CompareView items={items} prices={prices} stores={stores} />}
        {tab === "deals" && <DealsView myCodes={myCodes} onAdd={(i) => onAdd(i)} />}
      </main>

      <nav className="fixed inset-x-0 bottom-0 z-30 border-t border-slate-200 bg-white/95 pb-[env(safe-area-inset-bottom)] backdrop-blur dark:border-slate-800 dark:bg-slate-950/95">
        <div className="mx-auto grid max-w-2xl grid-cols-3">
          {(
            [
              ["list", "📝", `רשימה${openCount ? ` (${openCount})` : ""}`],
              ["compare", "⚖️", "איפה לקנות"],
              ["deals", "🔥", "מבצעים"],
            ] as [Tab, string, string][]
          ).map(([k, icon, label]) => (
            <button
              key={k}
              onClick={() => setTab(k)}
              className={`flex flex-col items-center py-2 text-xs ${tab === k ? "font-bold text-emerald-700 dark:text-emerald-400" : "text-slate-500"}`}
            >
              <span className="text-xl">{icon}</span>
              {label}
            </button>
          ))}
        </div>
      </nav>
    </div>
  );
}
