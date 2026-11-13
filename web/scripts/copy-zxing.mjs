// Copies the in-browser engines from the installed libraries into public/, so the site serves them itself
// instead of fetching them from an external CDN at runtime (reliability + privacy):
//  - the barcode reader (ZXing WASM)            -> public/zxing/
//  - gesture recognition (MediaPipe Tasks Vision WASM) -> public/mediapipe/
// (The gesture model itself, gesture_recognizer.task, is committed under public/models.)
// Runs automatically before every build/dev (prebuild/predev in package.json).
import { copyFileSync, mkdirSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

const require = createRequire(import.meta.url);
const pub = join(import.meta.dirname, "..", "public");

// ZXing - an official export of the library
mkdirSync(join(pub, "zxing"), { recursive: true });
copyFileSync(require.resolve("zxing-wasm/reader/zxing_reader.wasm"), join(pub, "zxing", "zxing_reader.wasm"));
console.log("zxing_reader.wasm -> public/zxing/");

// MediaPipe - the wasm folder of the package (the files FilesetResolver looks for)
const mpDir = join(dirname(require.resolve("@mediapipe/tasks-vision")), "wasm");
mkdirSync(join(pub, "mediapipe"), { recursive: true });
for (const f of readdirSync(mpDir)) {
  if (/^vision_wasm_(nosimd_)?internal\.(js|wasm)$/.test(f)) copyFileSync(join(mpDir, f), join(pub, "mediapipe", f));
}
console.log("mediapipe wasm -> public/mediapipe/");
