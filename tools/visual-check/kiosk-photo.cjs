// Photo reminder test: a hand in front of the fake camera -> gesture recognition -> 10-second countdown -> photo ->
// "photo reminders" in the "ran out" tab on the site -> to the list with a name (and the photo next to the item).
// There's no public open-palm (Open_Palm) image, so the test uses a thumb-up image and ?gesture=Thumb_Up -
// the same code path exactly, only a different gesture name.
//
//   python3 make-hand.py <image.jpg>  ->  out/hand.y4m ;  node kiosk-photo.cjs
const { chromium, devices, db, OUT, BASE, REF, fakeSession, handle } = require("./harness.cjs");
const errors = [];
let PAGE;

// Supabase Storage, in memory: upload, signed links, and serving the image
const store = new Map();
async function storage(route) {
  const req = route.request();
  const url = new URL(req.url());
  const p = url.pathname.replace("/storage/v1/", "");
  if (req.method() === "POST" && p.startsWith("object/sign/")) {
    const bucket = p.split("/")[2];
    const { paths } = JSON.parse(req.postData());
    const out = paths.map((x) => ({ path: x, signedURL: `/object/sign/${bucket}/${x}?token=t`, error: store.has(`${bucket}/${x}`) ? null : "not found" }));
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(out) });
  }
  if (req.method() === "POST" && p.startsWith("object/")) {
    const key = p.slice("object/".length);
    // supabase-js sends a Blob as multipart - extract the JPEG itself (from FFD8 to the last FFD9)
    const buf = req.postDataBuffer();
    const st = buf.indexOf(Buffer.from([0xff, 0xd8, 0xff]));
    const en = buf.lastIndexOf(Buffer.from([0xff, 0xd9]));
    store.set(key, st >= 0 && en > st ? buf.subarray(st, en + 2) : buf);
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ Key: key, Id: "x" }) });
  }
  if (req.method() === "GET" && p.startsWith("object/sign/")) {
    const b = store.get(p.slice("object/sign/".length));
    return b ? route.fulfill({ status: 200, contentType: "image/jpeg", body: b }) : route.fulfill({ status: 404, body: "" });
  }
  return route.fulfill({ status: 400, body: "unsupported " + p });
}

(async () => {
  await db.query("truncate shopping_items, consumed_items, photo_reminders");
  const scheme = process.env.SCHEME || "dark";
  const browser = await chromium.launch({
    args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream", `--use-file-for-fake-video-capture=${OUT}/hand.y4m`],
  });
  const ctx = await browser.newContext({ ...devices["Pixel 7"], locale: "he-IL", colorScheme: scheme, permissions: ["camera"] });
  await ctx.route(`https://${REF}.supabase.co/rest/v1/**`, handle);
  await ctx.route(`https://${REF}.supabase.co/storage/v1/**`, storage);
  await ctx.route(`${BASE}/api/**`, (r) => r.fulfill({ status: 200, contentType: "application/json", body: '{"ok":true}' }));
  await ctx.route(`https://${REF}.supabase.co/auth/v1/**`, (r) =>
    r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(fakeSession().user) }));
  await ctx.addInitScript(() => {
    window.__tones = [];
    const orig = AudioContext.prototype.createOscillator;
    AudioContext.prototype.createOscillator = function () {
      const o = orig.call(this);
      const start = o.start.bind(o);
      o.start = (...a) => { window.__tones.push(Math.round(o.frequency.value)); return start(...a); };
      return o;
    };
  });
  const page = await ctx.newPage();
  PAGE = page;
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => { if (m.type() === "error" && !/websocket|realtime|TensorFlow Lite/i.test(m.text())) errors.push(m.text()); });

  await page.goto(BASE + "/scanner");
  await page.evaluate(([k, v]) => localStorage.setItem(k, v), [`sb-${REF}-auth-token`, JSON.stringify(fakeSession())]);
  await page.goto(BASE + "/scanner?gesture=Thumb_Up");
  const btn = page.getByRole("button", { name: /להפעלת צליל הסריקה/ });
  await btn.waitFor({ timeout: 15000 });
  await btn.click();

  const t0 = Date.now();
  await page.getByText("מכינים את המוצר מול המצלמה").waitFor({ timeout: 40000 });
  const tDetect = Date.now() - t0;
  await page.waitForTimeout(2500);
  const shown = await page.locator(".text-8xl").innerText();
  await page.screenshot({ path: `${OUT}/photo-${scheme}-1-countdown.png` });
  await page.getByText("צולם כתזכורת").waitFor({ timeout: 15000 });
  const tCapture = Date.now() - t0;
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${OUT}/photo-${scheme}-2-taken.png` });
  const reminders = (await db.query("select photo_path, status, scanned_as from photo_reminders")).rows;
  const tones = await page.evaluate(() => window.__tones);
  // No second countdown right after the photo (the hand is still in front of the camera - a cooldown)
  await page.waitForTimeout(3000);
  const recount = await page.getByText("מכינים את המוצר מול המצלמה").count();

  // The family site: the "ran out" tab -> the photo reminder -> a name -> to the list
  await page.goto(BASE + "/");
  await page.getByPlaceholder("מה צריך?", { exact: false }).waitFor({ timeout: 15000 });
  const tab = await page.locator("nav button").nth(1).innerText();
  await page.locator("nav button").nth(1).click();
  await page.getByText("תזכורות מצולמות").waitFor({ timeout: 10000 });
  await page.locator('img[alt="תזכורת מצולמת"]').waitFor({ timeout: 10000 });
  await page.waitForTimeout(1000);
  const imgOk = await page.locator('img[alt="תזכורת מצולמת"]').evaluate((i) => i.complete && i.naturalWidth > 0);
  await page.screenshot({ path: `${OUT}/photo-${scheme}-3-ranout.png` });
  await page.getByPlaceholder("מה זה? (לא חובה)").fill("עגבניות שרי");
  await page.getByRole("button", { name: "+ לרשימה" }).first().click();
  await page.waitForTimeout(1500);
  const item = (await db.query("select name, photo_path, unit from shopping_items")).rows;
  const after = (await db.query("select status, item_name from photo_reminders")).rows;
  await page.locator("nav button").nth(0).click();
  await page.getByText("עגבניות שרי").waitFor({ timeout: 10000 });
  await page.waitForTimeout(1200);
  const listImg = await page.locator("li img").first().evaluate((i) => i.src.includes("/object/sign/") && i.naturalWidth > 0).catch(() => false);
  await page.screenshot({ path: `${OUT}/photo-${scheme}-4-list.png` });

  console.log(`gesture -> countdown: ${tDetect}ms | countdown showed: ${shown} | photo at: ${tCapture}ms`);
  console.log("reminder row:", JSON.stringify(reminders), "| stored:", [...store.keys()]);
  console.log("tones (ticks 1000Hz + shutter):", JSON.stringify(tones));
  console.log("no immediate re-trigger:", recount === 0);
  console.log("tab:", tab.replace(/\s+/g, " "), "| reminder image loaded:", imgOk);
  console.log("list item:", JSON.stringify(item), "| reminder after:", JSON.stringify(after), "| photo on list row:", listImg);
  console.log("errors:", errors.length ? errors : "none");
  await browser.close();
  await db.end();
})().catch(async (e) => {
  console.error("FAILED", e.message.split("\n")[0]);
  console.log("page errors:", errors);
  if (PAGE) await PAGE.screenshot({ path: `${OUT}/fail.png`, fullPage: true });
  process.exit(1);
});
