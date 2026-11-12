// Short display names and colours per branch (store_key as in config/stores.toml)
export const STORE_META: Record<string, { short: string; color: string }> = {
  "rami-levy-yahalom": { short: "רמי לוי", color: "#1d4ed8" },
  "shufersal-deal-hakadar": { short: "שופרסל דיל", color: "#dc2626" },
  "shufersal-universe-hamelacha": { short: "שופרסל יוניברס", color: "#f97316" },
  "yochananof-netanya": { short: "יוחננוף", color: "#16a34a" },
  "yochananof-hadarim": { short: "יוחננוף הדרים", color: "#15803d" },
  "osher-ad-netanya": { short: "אושר עד", color: "#9333ea" },
};

export function storeShort(
  key: string | null | undefined,
  fallback?: string,
): string {
  if (!key) return "";
  return STORE_META[key]?.short ?? fallback ?? key;
}

export function storeColor(key: string): string {
  return STORE_META[key]?.color ?? "#64748b";
}
