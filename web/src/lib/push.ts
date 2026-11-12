import { supabase } from "./supabase";

// The public key (not a secret) - must match VAPID_PRIVATE_KEY on the server
export const VAPID_PUBLIC_KEY =
  "BFeQ0md5IPFtcpU2oq0Z-ZSBjhYXBabYduJ8v4knCnk5lQwt2xQPRtNqHtw8UrE5hPacspSGacdYqypvDPGjDaM";

export type PushState =
  | "unsupported"
  | "ios-needs-install"
  | "denied"
  | "off"
  | "on";

function b64ToBytes(b64: string): Uint8Array<ArrayBuffer> {
  const pad = "=".repeat((4 - (b64.length % 4)) % 4);
  const raw = atob((b64 + pad).replace(/-/g, "+").replace(/_/g, "/"));
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

const isIOS = () => /iPhone|iPad|iPod/.test(navigator.userAgent);
const isStandalone = () =>
  window.matchMedia("(display-mode: standalone)").matches ||
  (navigator as unknown as { standalone?: boolean }).standalone === true;

/** The notification state on this device. */
export async function pushState(): Promise<PushState> {
  if (
    !("serviceWorker" in navigator) ||
    !("PushManager" in window) ||
    !("Notification" in window)
  ) {
    return isIOS() && !isStandalone() ? "ios-needs-install" : "unsupported";
  }
  if (Notification.permission === "denied") return "denied";
  const reg = await navigator.serviceWorker.getRegistration();
  const sub = await reg?.pushManager.getSubscription();
  return sub ? "on" : "off";
}

/** Enable notifications on this device: ask for permission, subscribe, and save to the DB under the current user. */
export async function enablePush(email: string): Promise<PushState> {
  const reg =
    (await navigator.serviceWorker.getRegistration()) ??
    (await navigator.serviceWorker.register("/sw.js"));
  await navigator.serviceWorker.ready;
  const perm = await Notification.requestPermission();
  if (perm !== "granted") return perm === "denied" ? "denied" : "off";
  const sub =
    (await reg.pushManager.getSubscription()) ??
    (await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: b64ToBytes(VAPID_PUBLIC_KEY),
    }));
  const j = sub.toJSON() as {
    endpoint: string;
    keys: { p256dh: string; auth: string };
  };
  const { error } = await supabase.from("push_subscriptions").upsert({
    endpoint: j.endpoint,
    email,
    p256dh: j.keys.p256dh,
    auth: j.keys.auth,
    user_agent: navigator.userAgent.slice(0, 200),
  });
  if (error) throw error;
  return "on";
}

export async function disablePush(): Promise<PushState> {
  const reg = await navigator.serviceWorker.getRegistration();
  const sub = await reg?.pushManager.getSubscription();
  if (sub) {
    await supabase
      .from("push_subscriptions")
      .delete()
      .eq("endpoint", sub.endpoint);
    await sub.unsubscribe();
  }
  return "off";
}

async function authedPost(
  path: string,
  body?: unknown,
): Promise<Response | null> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) return null;
  return fetch(path, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${token}`,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
}

/** Tell the server something happened (it decides who should hear about it). Never blocks the user. */
export function notifyEvent(type: "list_add" | "ran_out", id: string) {
  authedPost("/api/notify/event", { type, id }).catch(() => {});
}

export async function sendTestPush(): Promise<{
  ok: boolean;
  sent?: number;
  error?: string;
}> {
  const r = await authedPost("/api/push/test");
  if (!r) return { ok: false, error: "not signed in" };
  return r.json();
}
