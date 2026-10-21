const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const http = require("node:http");
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const root = path.resolve(__dirname, "..");
let context;
let profile;
const server = http.createServer((request, response) => {
  response.setHeader("Content-Type", "text/html; charset=utf-8");
  if (request.url === "/frame") {
    response.end("<!doctype html><html><body style='height:2000px'>Cross-origin frame</body></html>");
    return;
  }
  response.end(`<!doctype html><html><head><title>Glide test ${request.url}</title></head><body style="margin:0;min-height:3000px;font:20px system-ui"><h1>Glide ${request.url}</h1><a href="/two">Next page</a><div id="scroller" style="position:absolute;left:700px;top:100px;width:250px;height:300px;overflow:auto;background:#eee"><div style="height:1500px">Nested scrolling</div></div><iframe src="http://localhost:${server.address().port}/frame" style="position:absolute;top:600px;left:100px;width:400px;height:300px"></iframe><script>window.contextEvents=[];document.addEventListener('contextmenu',e=>{contextEvents.push({prevented:e.defaultPrevented,trusted:e.isTrusted})});</script></body></html>`);
});

async function draw(page, points, { shift = false, cancel = false } = {}) {
  if (shift) await page.keyboard.down("Shift");
  await page.mouse.move(...points[0]);
  await page.mouse.down({ button: "right" });
  for (const point of points.slice(1)) await page.mouse.move(...point, { steps: 9 });
  if (cancel) await page.keyboard.press("Escape");
  await page.mouse.up({ button: "right" });
  if (shift) await page.keyboard.up("Shift");
}

async function check(name, fn) {
  await fn();
  console.log(`PASS ${name}`);
}

(async () => {
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  profile = await fs.mkdtemp(path.join(os.tmpdir(), "glide-test-"));
  context = await chromium.launchPersistentContext(profile, {
    channel: "chromium", headless: true, viewport: { width: 1200, height: 950 },
    args: [`--disable-extensions-except=${root}`, `--load-extension=${root}`]
  });
  const errors = [];
  context.on("page", page => page.on("pageerror", error => errors.push(error.message)));
  let worker = context.serviceWorkers()[0];
  worker ||= await context.waitForEvent("serviceworker");
  const id = new URL(worker.url()).host;
  worker.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
  const options = await context.newPage();
  await options.goto(`chrome-extension://${id}/options.html`);
  await options.locator("#rules tr").first().waitFor();
  const page = await context.newPage();
  const fresh = async url => { await page.goto(url || `${base}/one`); await page.waitForTimeout(100); };
  await fresh();

  await check("extension loads with 10 editable defaults", async () => {
    assert.equal(await options.locator("#rules tr").count(), 10);
    assert.equal(await options.locator("#save").isDisabled(), true);
  });
  await check("real right-drag creates a tab, then closes it", async () => {
    const created = context.waitForEvent("page");
    await draw(page, [[400, 250], [400, 400]]);
    const tab = await created;
    await tab.goto(`${base}/close-me`);
    await tab.waitForTimeout(100);
    const closed = tab.waitForEvent("close");
    await draw(tab, [[400, 250], [400, 400], [550, 400]]);
    await closed;
    await page.bringToFront();
  });
  await check("back and forward use browser history", async () => {
    await page.locator("a").click();
    await page.waitForURL(`${base}/two`);
    await page.waitForTimeout(100);
    await draw(page, [[450, 300], [280, 300]]);
    await page.waitForURL(`${base}/one`);
    await page.waitForTimeout(100);
    await draw(page, [[300, 300], [480, 300]]);
    await page.waitForURL(`${base}/two`);
  });
  await check("up-down reloads once", async () => {
    await page.waitForTimeout(100);
    const navigation = page.waitForEvent("load");
    await draw(page, [[400, 350], [400, 200], [400, 380]]);
    await navigation;
  });
  await check("plain and Shift-right clicks retain context menus", async () => {
    await fresh();
    await page.mouse.click(450, 350, { button: "right" });
    assert.equal(await page.evaluate(() => contextEvents.at(-1)?.prevented), false);
    await page.keyboard.press("Escape");
    const count = context.pages().length;
    await draw(page, [[400, 250], [400, 400]], { shift: true });
    await page.waitForTimeout(150);
    assert.equal(context.pages().length, count);
    assert.equal(await page.evaluate(() => contextEvents.at(-1)?.prevented), false);
    await page.keyboard.press("Escape");
  });
  await check("Escape and unknown gestures do not execute", async () => {
    const count = context.pages().length;
    await draw(page, [[400, 250], [400, 400]], { cancel: true });
    await draw(page, [[400, 250], [550, 250], [550, 400], [400, 400]]);
    await page.waitForTimeout(150);
    assert.equal(context.pages().length, count);
  });
  await check("website synthetic pointer events cannot invoke gestures", async () => {
    const count = context.pages().length;
    await page.evaluate(() => {
      for (const [type, x, y, buttons] of [["pointerdown", 400, 250, 2], ["pointermove", 400, 450, 2], ["pointerup", 400, 450, 0]]) {
        window.dispatchEvent(new PointerEvent(type, { clientX: x, clientY: y, buttons, button: 2, pointerId: 1, bubbles: true }));
      }
    });
    await page.waitForTimeout(150);
    assert.equal(context.pages().length, count);
  });
  await check("settings record, reject duplicates, and persist a new mapping", async () => {
    await options.bringToFront();
    await options.locator("#add").click();
    const rect = await options.locator("#draw-area").boundingBox();
    const x = rect.x + 70, y = rect.y + 60;
    await draw(options, [[x, y], [x - 40, y]]);
    assert.equal(await options.locator("#use-record").isDisabled(), true);
    assert.match(await options.locator("#record-error").textContent(), /이미 등록/);
    await draw(options, [[x, y], [x + 150, y], [x + 150, y + 100]]);
    assert.equal(await options.locator("#recorded").textContent(), "→ ↓");
    await options.locator("#record-binding input").fill("Ctrl+T");
    await options.locator("#use-record").click();
    await options.locator("#rules tr").last().locator("select").selectOption("muteTab");
    await options.locator("#save").click();
    await options.waitForFunction(() => document.querySelector("#status").textContent.startsWith("저장했습니다"));
    await options.reload();
    await options.locator("#rules tr").last().waitFor();
    assert.equal(await options.locator("#rules tr").count(), 11);
    await page.bringToFront();
    const beforeMuted = await worker.evaluate(async () => (await chrome.tabs.query({ active: true, lastFocusedWindow: true }))[0].mutedInfo.muted);
    await draw(page, [[400, 250], [550, 250], [550, 400]]);
    await page.waitForTimeout(150);
    assert.equal(await worker.evaluate(async () => (await chrome.tabs.query({ active: true, lastFocusedWindow: true }))[0].mutedInfo.muted), !beforeMuted);
  });
  await check("disabling gestures updates already open pages", async () => {
    await options.bringToFront();
    await options.locator("#enabled").uncheck();
    await options.locator("#save").click();
    await options.waitForFunction(() => document.querySelector("#status").textContent.startsWith("저장했습니다"));
    await page.bringToFront();
    const count = context.pages().length;
    await draw(page, [[400, 250], [400, 400]]);
    await page.waitForTimeout(150);
    assert.equal(context.pages().length, count);
    await options.bringToFront();
    await options.locator("#enabled").check();
    await options.locator("#save").click();
    await options.waitForFunction(() => document.querySelector("#status").textContent.startsWith("저장했습니다"));
  });
  await check("typed Ctrl+T runs the native browser action", async () => {
    await options.bringToFront();
    await options.locator("#rules tr").last().locator("select").selectOption("keyboard");
    await options.locator("#rules tr").last().locator("input").fill("Ctrl+T");
    await options.locator("#save").click();
    await options.waitForFunction(() => document.querySelector("#status").textContent.startsWith("저장했습니다"));
    await page.bringToFront();
    const created = context.waitForEvent("page");
    await draw(page, [[400, 250], [550, 250], [550, 400]]);
    const tab = await created;
    assert.match(tab.url(), /chrome:\/\/newtab/);
    await tab.close();
  });
  await check("captured website keys retain modifiers and focus", async () => {
    await options.bringToFront();
    const row = options.locator("#rules tr").last();
    await row.locator(".shortcut-controls button").click();
    await options.keyboard.press("Control+Shift+K");
    assert.equal(await row.locator("input").inputValue(), "Ctrl+Shift+K");
    await options.locator("#save").click();
    await options.waitForFunction(() => document.querySelector("#status").textContent.startsWith("저장했습니다"));
    await page.bringToFront();
    await page.evaluate(() => {
      window.testKeys = [];
      for (const type of ["keydown", "keyup"]) document.addEventListener(type, event => {
        if (event.code === "KeyK") testKeys.push({ type: event.type, ctrl: event.ctrlKey, shift: event.shiftKey, code: event.keyCode, trusted: event.isTrusted });
      });
    });
    await draw(page, [[400, 250], [550, 250], [550, 400]]);
    await page.waitForFunction(() => testKeys.length === 2);
    assert.deepEqual(await page.evaluate(() => testKeys), [
      { type: "keydown", ctrl: true, shift: true, code: 75, trusted: false },
      { type: "keyup", ctrl: true, shift: true, code: 75, trusted: false }
    ]);
  });
  await check("scroll gestures find the nested scroll container", async () => {
    await page.bringToFront();
    await draw(page, [[800, 170], [800, 300], [740, 300]]);
    await page.waitForFunction(() => document.querySelector("#scroller").scrollTop > 900);
    assert.equal(await page.evaluate(() => scrollY), 0);
    await draw(page, [[800, 300], [800, 150]]);
    await page.waitForFunction(() => document.querySelector("#scroller").scrollTop === 0);
  });
  await check("settings fit desktop and mobile with no script errors", async () => {
    await options.bringToFront();
    await options.screenshot({ path: path.join(root, "tests/settings-desktop.png"), fullPage: true });
    await options.setViewportSize({ width: 390, height: 844 });
    assert.equal(await options.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await options.screenshot({ path: path.join(root, "tests/settings-mobile.png"), fullPage: true });
    assert.deepEqual(errors, []);
  });
  console.log("All browser integration checks passed.");
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => {
  await context?.close();
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
  if (profile && path.dirname(profile) === os.tmpdir() && path.basename(profile).startsWith("glide-test-")) {
    await fs.rm(profile, { recursive: true, force: true, maxRetries: 5 });
  }
});
