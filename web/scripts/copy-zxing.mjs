// Copies the barcode reader engine (ZXing WASM) from the installed library into public/zxing,
// so the site serves it itself instead of fetching it from an external CDN at runtime (reliability + privacy).
// Runs automatically before every build/dev (prebuild/predev in package.json), so it's always in sync with the version.
import { copyFileSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";

const require = createRequire(import.meta.url);
// an official export of the library (the "exports" field) - not an internal path
const wasm = require.resolve("zxing-wasm/reader/zxing_reader.wasm");
const out = join(import.meta.dirname, "..", "public", "zxing");
mkdirSync(out, { recursive: true });
copyFileSync(wasm, join(out, "zxing_reader.wasm"));
console.log("zxing_reader.wasm -> public/zxing/");
