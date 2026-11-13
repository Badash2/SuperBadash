// Kiosk flow test: a barcode in front of the fake camera -> recorded as "ran out" -> on the site to the list.
// Also checks the scan sound and the fixed-device redirect. Setup: see README.md in this directory.
//
//   node kiosk.cjs   (needs out/barcode.y4m from make-barcode.py and the site on BASE_URL)
const { chromium, devices, db, OUT, BASE, REF, fakeSession, handle } = require("./harness.cjs");
const errors = [];
let PAGE;

// Kiosk flow: a scan at the bin -> "ran out recently" on the site -> to the list; fixed-device redirect.
(async () => {
  await db.query("truncate shopping_items, consumed_items");
  const browser = await chromium.launch({
    args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream", `--use-file-for-fake-video-capture=${OUT}/barcode.y4m`, "--autoplay-policy=user-gesture-required"],
  });
  const ctx = await browser.newContext({ ...devices["Pixel 7"], locale: "he-IL", colorScheme: "dark", permissions: ["camera"] });
  await ctx.route(`https://${REF}.supabase.co/rest/v1/**`, handle);
  // The notification endpoints are tested separately (notify-api.cjs); here we only check that the UI calls them
  const apiCalls = [];
  await ctx.route(`${BASE}/api/**`, (r) => { apiCalls.push(new URL(r.request().url()).pathname); return r.fulfill({ status: 200, contentType: "application/json", body: '{"ok":true,"sent":0}' }); });
  await ctx.route(`https://${REF}.supabase.co/auth/v1/**`, (r) =>
    r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(fakeSession().user) }));
  // Records the sounds the page produces (frequency, wave, context state) - "hearing" without speakers
  await ctx.addInitScript(() => {
    window.__tones = [];
    const orig = AudioContext.prototype.createOscillator;
    AudioContext.prototype.createOscillator = function () {
      const o = orig.call(this);
      const ctx = this;
      const start = o.start.bind(o);
      o.start = (...a) => { window.__tones.push({ f: o.frequency.value, type: o.type, state: ctx.state }); return start(...a); };
      return o;
    };
  });
  const page = await ctx.newPage();
  PAGE = page;
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => { if (m.type() === "error" && !/websocket|realtime|404|TensorFlow Lite/i.test(m.text())) errors.push(m.text()); });

  await page.goto(BASE + "/scanner");
  await page.evaluate(([k, v]) => localStorage.setItem(k, v), [`sb-${REF}-auth-token`, JSON.stringify(fakeSession())]);
  await page.reload();
  await page.getByRole("button", { name: /להפעלת צליל הסריקה/ }).waitFor({ timeout: 15000 });
  const scannedBeforeTouch = await page.getByText("נרשם שנגמר").count();
  const tonesBeforeTouch = await page.evaluate(() => window.__tones.length);
  const soundBtnBefore = await page.getByRole("button", { name: /להפעלת צליל הסריקה/ }).count();
  await page.getByRole("button", { name: /להפעלת צליל הסריקה/ }).click(); // one touch, like on the phone
  await page.waitForTimeout(1500);
  const soundBtnAfter = await page.getByRole("button", { name: /להפעלת צליל הסריקה/ }).count();
  await page.getByText("נרשם שנגמר").waitFor({ timeout: 30000 });
  await page.waitForTimeout(500);
  const tones = await page.evaluate(() => window.__tones);
  console.log("scanned before touch:", scannedBeforeTouch, "| tones before touch:", tonesBeforeTouch, "| sound button before touch:", soundBtnBefore, "| after:", soundBtnAfter, "| tones:", JSON.stringify(tones));
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${OUT}/kiosk-1-scanned.png` });
  const rows1 = (await db.query("select code, name, status, device from consumed_items")).rows;
  await page.waitForTimeout(10000); // the barcode stays in front of the camera longer than the cooldown -> still a single scan
  const rows2 = (await db.query("select count(*)::int n from consumed_items")).rows[0].n;

  await page.getByRole("button", { name: /זה הסורק הקבוע/ }).click();
  await page.goto(BASE + "/");
  await page.waitForURL("**/scanner", { timeout: 10000 });
  const redirected = page.url().endsWith("/scanner");

  await page.getByRole("button", { name: "לאפליקציה הרגילה" }).click();
  await page.getByPlaceholder("מה צריך?", { exact: false }).waitFor({ timeout: 15000 });
  await page.waitForTimeout(1500);
  // The core requirement: a scan by the bin does NOT go onto the list on its own
  const listBefore = (await db.query("select count(*)::int n from shopping_items")).rows[0].n;
  const panelOnList = await page.getByText("נגמר לאחרונה").count();
  const tabLabel = await page.locator("nav button").nth(1).innerText();
  await page.locator("nav button").nth(1).click();
  await page.getByRole("button", { name: "+ לרשימה" }).first().waitFor({ timeout: 10000 });
  await page.screenshot({ path: `${OUT}/kiosk-2-ranout-tab.png` });
  await page.getByRole("button", { name: "+ לרשימה" }).first().click();
  await page.getByText("✓ ברשימה").waitFor({ timeout: 10000 });
  await page.screenshot({ path: `${OUT}/kiosk-3-after-add.png` });
  const items = (await db.query("select name from shopping_items")).rows.map((r) => r.name);
  const status = (await db.query("select status from consumed_items")).rows.map((r) => r.status);
  const tabAfter = await page.locator("nav button").nth(1).innerText();
  console.log("list empty before a manual add:", listBefore === 0, "| no suggestions panel on list:", panelOnList === 0);
  console.log("tab:", tabLabel.replace(/\s+/g, " "), "->", tabAfter.replace(/\s+/g, " "));
  console.log("recorded:", JSON.stringify(rows1));
  console.log("no duplicate while barcode stays in view:", rows2 === 1);
  console.log("fixed-device redirect / -> /scanner:", redirected);
  console.log("added to list after click:", items, "| consumed status:", status);
  console.log("notify calls from UI:", [...new Set(apiCalls)]);
  console.log("errors:", errors.length ? errors : "none");
  await browser.close();
  await db.end();
})().catch(async (e) => {
  console.error("FAILED", e.message.split("\n")[0]);
  console.log("page errors:", errors);
  if (PAGE) await PAGE.screenshot({ path: `${OUT}/fail.png`, fullPage: true });
  process.exit(1);
});
