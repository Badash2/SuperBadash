"use client";
import { useEffect, useRef, useState } from "react";

type Detector = { detect: (src: HTMLVideoElement) => Promise<{ rawValue: string }[]> };
type Mode = "list" | "cart";

const FORMATS = ["ean_13", "ean_8", "upc_a", "upc_e", "code_128"];

/**
 * Barcode scanning with the camera. On Android (Chrome) the browser's built-in BarcodeDetector is
 * used; on iPhone, where it doesn't exist, the ZXing engine (WebAssembly) is loaded instead.
 * Scanning is continuous: you can scan several products one after another, and each is added straight away.
 */
export function Scanner({
  onCode,
  onClose,
  defaultMode,
}: {
  onCode: (code: string, mode: Mode) => Promise<string>;
  onClose: () => void;
  defaultMode: Mode;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [mode, setMode] = useState<Mode>(defaultMode);
  const modeRef = useRef(mode);
  const [status, setStatus] = useState("מפעיל מצלמה...");
  const [last, setLast] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    modeRef.current = mode;
  }, [mode]);

  useEffect(() => {
    let stream: MediaStream | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let stopped = false;
    let busy = false;
    const recent = new Map<string, number>();

    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 } },
          audio: false,
        });
        const v = videoRef.current!;
        v.srcObject = stream;
        await v.play();

        let detector: Detector;
        const Native = (globalThis as unknown as { BarcodeDetector?: new (o: object) => Detector }).BarcodeDetector;
        if (Native) {
          detector = new Native({ formats: FORMATS });
        } else {
          const { BarcodeDetector } = await import("barcode-detector/ponyfill");
          detector = new BarcodeDetector({ formats: FORMATS as never }) as unknown as Detector;
        }
        setStatus("כוונו את הברקוד למסגרת");

        const tick = async () => {
          if (stopped) return;
          if (!busy && v.readyState >= 2) {
            try {
              const found = await detector.detect(v);
              const code = found.map((f) => f.rawValue).find((c) => /^\d{8,14}$/.test(c));
              const now = Date.now();
              if (code && now - (recent.get(code) ?? 0) > 2500) {
                recent.set(code, now);
                busy = true;
                navigator.vibrate?.(60);
                setStatus("מחפש מוצר...");
                const name = await onCode(code, modeRef.current);
                setLast(name);
                setStatus("כוונו את הברקוד הבא");
                busy = false;
              }
            } catch {
              busy = false;
            }
          }
          timer = setTimeout(tick, 200);
        };
        tick();
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        setError(
          /denied|NotAllowed/i.test(msg)
            ? "אין הרשאה למצלמה. אשרו גישה למצלמה בהגדרות הדפדפן ונסו שוב."
            : "לא הצלחתי להפעיל את המצלמה: " + msg,
        );
      }
    })();

    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, [onCode]);

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-black text-white">
      <div className="flex items-center justify-between p-4">
        <div className="flex rounded-full bg-white/15 p-1 text-sm">
          {(
            [
              ["list", "הוסף לרשימה"],
              ["cart", "ישר לעגלה"],
            ] as [Mode, string][]
          ).map(([m, label]) => (
            <button
              key={m}
              onClick={() => setMode(m)}
              className={`rounded-full px-3 py-1.5 font-medium ${mode === m ? "bg-white text-black" : "text-white/80"}`}
            >
              {label}
            </button>
          ))}
        </div>
        <button onClick={onClose} className="rounded-full bg-white px-4 py-1.5 text-sm font-bold text-black">
          סיום
        </button>
      </div>

      <div className="relative flex-1 overflow-hidden">
        <video ref={videoRef} playsInline muted className="absolute inset-0 h-full w-full object-cover" />
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <div className="h-40 w-72 rounded-2xl border-4 border-white/90 shadow-[0_0_0_9999px_rgba(0,0,0,0.45)]" />
        </div>
      </div>

      <div className="space-y-1 p-4 pb-[calc(1rem+env(safe-area-inset-bottom))] text-center">
        {error ? (
          <p className="text-sm text-red-300">{error}</p>
        ) : (
          <>
            <p className="text-sm text-white/80">{status}</p>
            {last && <p className="font-semibold text-emerald-300">✓ {last}</p>}
          </>
        )}
      </div>
    </div>
  );
}
