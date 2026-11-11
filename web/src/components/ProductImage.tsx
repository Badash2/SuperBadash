"use client";
/* eslint-disable @next/next/no-img-element -- images from external CDNs, no point in the Next optimiser */
import { useState } from "react";

/** Product image: Rami Levy's image server by barcode, then Open Food Facts, then an icon. */
export function ProductImage({
  code,
  fallbackUrl,
  size = 48,
  emoji = "🛒",
}: {
  code: string | null;
  fallbackUrl?: string | null;
  size?: number;
  emoji?: string;
}) {
  const sources = [
    code && /^\d{8,14}$/.test(code) ? `https://img.rami-levy.co.il/product/${code}/small.jpg` : null,
    fallbackUrl ?? null,
  ].filter(Boolean) as string[];
  const [idx, setIdx] = useState(0);
  const style = { width: size, height: size };
  if (idx >= sources.length) {
    return (
      <div style={style} className="flex shrink-0 items-center justify-center rounded-xl bg-surface-2 text-xl">
        {emoji}
      </div>
    );
  }
  return (
    <img
      src={sources[idx]}
      alt=""
      loading="lazy"
      style={style}
      className="shrink-0 rounded-xl bg-img object-contain p-0.5"
      onError={() => setIdx((i) => i + 1)}
    />
  );
}
