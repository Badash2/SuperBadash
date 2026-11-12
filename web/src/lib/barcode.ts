/**
 * A continuous barcode scanning loop from a video element.
 * Android (Chrome): the built-in BarcodeDetector. iPhone/other: ZXing (WebAssembly) loaded on demand.
 */
type Detector = {
  detect: (src: HTMLVideoElement) => Promise<{ rawValue: string }[]>;
};

export const BARCODE_FORMATS = [
  "ean_13",
  "ean_8",
  "upc_a",
  "upc_e",
  "code_128",
];

export async function createDetector(): Promise<Detector> {
  const Native = (
    globalThis as unknown as { BarcodeDetector?: new (o: object) => Detector }
  ).BarcodeDetector;
  if (Native) return new Native({ formats: BARCODE_FORMATS });
  const { BarcodeDetector } = await import("barcode-detector/ponyfill");
  return new BarcodeDetector({
    formats: BARCODE_FORMATS as never,
  }) as unknown as Detector;
}

/** Product codes only (8-14 digits); ignores QR codes etc. */
export function pickProductCode(found: { rawValue: string }[]): string | null {
  return found.map((f) => f.rawValue).find((c) => /^\d{8,14}$/.test(c)) ?? null;
}

/** A short "beep" without an audio file (Web Audio). Fails silently if the browser blocks audio. */
export function beep(ok = true) {
  try {
    const Ctx =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext: typeof AudioContext })
        .webkitAudioContext;
    const ctx = new Ctx();
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.frequency.value = ok ? 1046 : 330;
    g.gain.setValueAtTime(0.15, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.18);
    o.connect(g).connect(ctx.destination);
    o.start();
    o.stop(ctx.currentTime + 0.2);
    o.onended = () => ctx.close();
  } catch {}
}
