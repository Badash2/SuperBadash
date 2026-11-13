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
  const { BarcodeDetector, prepareZXingModule } =
    await import("barcode-detector/ponyfill");
  // The engine (WASM) is served from our own site (public/zxing, copied at build), not from an external CDN
  prepareZXingModule({
    overrides: {
      locateFile: (path: string, prefix: string) =>
        path.endsWith(".wasm") ? `/zxing/${path}` : prefix + path,
    },
  });
  return new BarcodeDetector({
    formats: BARCODE_FORMATS as never,
  }) as unknown as Detector;
}

/** Product codes only (8-14 digits); ignores QR codes etc. */
export function pickProductCode(found: { rawValue: string }[]): string | null {
  return found.map((f) => f.rawValue).find((c) => /^\d{8,14}$/.test(c)) ?? null;
}

// ---------- sound ----------
// One shared AudioContext: browsers block sound until the first touch, so it is "unlocked" on a touch
// and kept for the whole life of the page (a new context per beep would go back to being blocked).
let audio: AudioContext | null = null;

function ctx(): AudioContext | null {
  if (audio) return audio;
  try {
    const Ctx =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext: typeof AudioContext })
        .webkitAudioContext;
    audio = new Ctx();
  } catch {
    audio = null;
  }
  return audio;
}

/** Is sound available right now (the browser didn't block it). */
export function audioReady(): boolean {
  // doesn't create a context: just checks whether one already exists and is unlocked (creating one inside a touch would "unlock" it on the spot)
  return !!audio && audio.state === "running";
}

/** Unlock sound - call from inside a touch/click handler. */
export async function unlockAudio(): Promise<boolean> {
  const c = ctx();
  if (!c) return false;
  try {
    if (c.state !== "running") await c.resume();
  } catch {}
  return c.state === "running";
}

/** One tone with a sharp envelope, through a filter that softens the edges of a square wave. */
function tone(
  c: AudioContext,
  freq: number,
  start: number,
  dur: number,
  vol: number,
) {
  const o = c.createOscillator();
  const f = c.createBiquadFilter();
  const g = c.createGain();
  o.type = "square";
  o.frequency.value = freq;
  f.type = "lowpass";
  f.frequency.value = 5000;
  g.gain.setValueAtTime(0, start);
  g.gain.linearRampToValueAtTime(vol, start + 0.004);
  g.gain.setValueAtTime(vol, start + dur - 0.015);
  g.gain.linearRampToValueAtTime(0, start + dur);
  o.connect(f).connect(g).connect(c.destination);
  o.start(start);
  o.stop(start + dur + 0.01);
}

/**
 * A supermarket-checkout beep: a single high, short, sharp tone (about 2.4 kHz, ~120 ms).
 * Error: two low tones - so it is clear by ear that it didn't work.
 */
export function beep(ok = true) {
  const c = ctx();
  if (!c) return;
  if (c.state !== "running") c.resume().catch(() => {});
  const t = c.currentTime + 0.01;
  try {
    if (ok) tone(c, 2400, t, 0.12, 0.12);
    else {
      tone(c, 420, t, 0.14, 0.14);
      tone(c, 420, t + 0.2, 0.14, 0.14);
    }
  } catch {}
}
