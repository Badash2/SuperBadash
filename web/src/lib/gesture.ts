/**
 * Gesture recognition in the browser (MediaPipe Gesture Recognizer). Everything is served from our own site:
 * the engine (public/mediapipe, copied at build) and the model (public/models/gesture_recognizer.task).
 * Nothing goes to a server - the image stays on the device.
 */
type Recognizer = {
  recognizeForVideo: (
    v: HTMLVideoElement,
    ts: number,
  ) => { gestures: { categoryName: string; score: number }[][] };
  close: () => void;
};

export const TRIGGER_GESTURE = "Open_Palm"; // an open hand, 5 fingers

export async function createGestureRecognizer(): Promise<Recognizer> {
  const { FilesetResolver, GestureRecognizer } =
    await import("@mediapipe/tasks-vision");
  const vision = await FilesetResolver.forVisionTasks("/mediapipe");
  const opts = (delegate: "GPU" | "CPU") => ({
    baseOptions: {
      modelAssetPath: "/models/gesture_recognizer.task",
      delegate,
    },
    runningMode: "VIDEO" as const,
    numHands: 1,
  });
  try {
    return (await GestureRecognizer.createFromOptions(
      vision,
      opts("GPU"),
    )) as unknown as Recognizer;
  } catch {
    // an old phone / no WebGL - CPU is slower, but at one check every half second it's enough
    return (await GestureRecognizer.createFromOptions(
      vision,
      opts("CPU"),
    )) as unknown as Recognizer;
  }
}

/** The top gesture in the frame, or null. */
export function topGesture(
  r: Recognizer,
  v: HTMLVideoElement,
  ts: number,
): { name: string; score: number } | null {
  const res = r.recognizeForVideo(v, ts);
  const g = res.gestures?.[0]?.[0];
  return g ? { name: g.categoryName, score: g.score } : null;
}
