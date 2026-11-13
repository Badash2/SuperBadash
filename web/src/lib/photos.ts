import { supabase } from "./supabase";

/**
 * Photos in a private bucket (product-photos): only family members can see them, via a temporary signed link.
 * Links are kept in memory until shortly before they expire, so the same image isn't requested twice.
 */
const BUCKET = "product-photos";
const TTL_S = 3600;
const cache = new Map<string, { url: string; exp: number }>();

export async function signedUrls(
  paths: string[],
): Promise<Map<string, string>> {
  const now = Date.now();
  const out = new Map<string, string>();
  const missing: string[] = [];
  for (const p of paths) {
    const c = cache.get(p);
    if (c && c.exp > now + 60_000) out.set(p, c.url);
    else missing.push(p);
  }
  if (missing.length) {
    const { data } = await supabase.storage
      .from(BUCKET)
      .createSignedUrls(missing, TTL_S);
    for (const d of data ?? []) {
      if (d.signedUrl && d.path) {
        cache.set(d.path, { url: d.signedUrl, exp: now + TTL_S * 1000 });
        out.set(d.path, d.signedUrl);
      }
    }
  }
  return out;
}

/** Upload a photo (JPEG) to the bucket under a folder; returns the path or null. */
export async function uploadPhoto(
  folder: string,
  blob: Blob,
): Promise<string | null> {
  const path = `${folder}/${crypto.randomUUID()}.jpg`;
  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(path, blob, { contentType: "image/jpeg" });
  return error ? null : path;
}
