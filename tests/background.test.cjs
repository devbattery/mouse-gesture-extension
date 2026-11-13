const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function worker(rule, extra = {}) {
  let listener;
  const calls = [];
  const reads = { count: 0 };
  const changeListeners = [];
  const tab = { id: 5, windowId: 2, index: 1, active: true, mutedInfo: { muted: false } };
  const record = name => async (...args) => { calls.push([name, ...args]); };
  const chrome = {
    action: { onClicked: { addListener() {} } },
    runtime: { id: "test-extension", onMessage: { addListener(fn) { listener = fn; } } },
    storage: { local: { get: async () => { reads.count++; return { settings: { enabled: true, threshold: 22, rules: [rule], ...extra } }; } },
      onChanged: { addListener(fn) { changeListeners.push(fn); } } },
    tabs: { get: async () => tab, query: async () => [{ id: 9, index: 2 }, tab, { id: 1, index: 0 }],
      goBack: record("back"), goForward: record("forward"), create: record("create"),
      remove: record("remove"), reload: record("reload"), update: record("update"),
      duplicate: record("duplicate"), sendMessage: record("sendMessage"),
      getZoom: async () => 1, setZoom: record("setZoom") },
    sessions: { getRecentlyClosed: async () => [{ window: { sessionId: "window" } }, { tab: { sessionId: "closed-tab" } }], restore: record("restore") },
    windows: { create: record("newWindow"), get: async () => ({ id: 2, state: "normal" }), update: record("updateWindow") }
  };
  const context = vm.createContext({ chrome, structuredClone, importScripts() {} });
  for (const file of ["shared.js", "background.js"]) vm.runInContext(fs.readFileSync(path.join(__dirname, "..", file), "utf8"), context);
  const send = (message = { type: "glide:gesture", gesture: rule.gesture }, sender = { id: chrome.runtime.id, tab, frameId: 7 }) =>
    new Promise(resolve => listener(message, sender, resolve));
  return { send, calls, chrome, tab, reads, changeListeners };
}

test("hard reload, zoom, and fullscreen map to browser APIs", async () => {
  const hard = worker({ gesture: "RD", action: "keyboard", shortcut: "Ctrl+Shift+R" });
  assert.equal((await hard.send()).ok, true);
  assert.equal(JSON.stringify(hard.calls[0]), JSON.stringify(["reload", 5, { bypassCache: true }]));

  for (const [shortcut, expected] of [["Ctrl++", 1.1], ["Ctrl+-", 0.9], ["Ctrl+0", 0]]) {
    const app = worker({ gesture: "RD", action: "keyboard", shortcut });
    assert.equal((await app.send()).ok, true);
    assert.equal(JSON.stringify(app.calls[0]), JSON.stringify(["setZoom", 5, expected]));
  }

  for (const shortcut of ["Shift+F5", "Cmd+Shift+R"]) {
    const app = worker({ gesture: "RD", action: "keyboard", shortcut });
    assert.equal((await app.send()).ok, true);
    assert.equal(JSON.stringify(app.calls[0]), JSON.stringify(["reload", 5, { bypassCache: true }]));
  }

  const fullscreen = worker({ gesture: "RD", action: "keyboard", shortcut: "F11" });
  assert.equal((await fullscreen.send()).ok, true);
  assert.equal(JSON.stringify(fullscreen.calls[0]), JSON.stringify(["updateWindow", 2, { state: "fullscreen" }]));

  // 방향 제스처에 동작을 직접 연결한 경우에도 같은 API를 쓴다.
  const direct = worker({ gesture: "RD", action: "hardReload" });
  assert.equal((await direct.send()).ok, true);
  assert.equal(JSON.stringify(direct.calls[0]), JSON.stringify(["reload", 5, { bypassCache: true }]));
});

test("fullscreen toggles back to a normal window when already fullscreen", async () => {
  const app = worker({ gesture: "RD", action: "fullscreen" });
  app.chrome.windows.get = async () => ({ id: 2, state: "fullscreen" });
  assert.equal((await app.send()).ok, true);
  assert.equal(JSON.stringify(app.calls[0]), JSON.stringify(["updateWindow", 2, { state: "normal" }]));
});

test("new tabs open in the originating window beside the source tab", async () => {
  const app = worker({ gesture: "D", action: "newTab" });
  assert.equal((await app.send()).ok, true);
  assert.equal(JSON.stringify(app.calls), JSON.stringify([["create", { windowId: 2, index: 2, openerTabId: 5 }]]));
});

test("runs native back, forward, reload, close, duplicate, and mute actions", async () => {
  for (const [action, method] of [["back", "back"], ["forward", "forward"], ["reload", "reload"],
    ["closeTab", "remove"], ["duplicateTab", "duplicate"], ["muteTab", "update"]]) {
    const app = worker({ gesture: "L", action });
    assert.equal((await app.send()).ok, true);
    assert.equal(app.calls[0][0], method);
    assert.equal(app.calls[0][1], 5);
  }
});

test("tab switching is sorted and wraps at both ends", async () => {
  for (const [action, index, expected] of [["nextTab", 2, 1], ["previousTab", 0, 9]]) {
    const app = worker({ gesture: "L", action });
    app.tab.index = index;
    app.chrome.tabs.query = async () => [{ id: 9, index: index === 2 ? 1 : 2 }, app.tab, { id: 1, index: index === 0 ? 1 : 0 }];
    assert.equal((await app.send()).ok, true);
    assert.equal(app.calls[0][1], expected);
  }
});

test("restores a tab rather than accidentally restoring a whole window", async () => {
  const app = worker({ gesture: "DU", action: "restoreTab" });
  await app.send();
  assert.deepEqual(app.calls[0], ["restore", "closed-tab"]);
  app.chrome.sessions.getRecentlyClosed = async () => [];
  assert.equal((await app.send()).ok, false);
});

test("scroll messages go only to the frame where the gesture started", async () => {
  const app = worker({ gesture: "U", action: "scrollTop" });
  await app.send();
  assert.equal(JSON.stringify(app.calls[0]), JSON.stringify(["sendMessage", 5, { type: "glide:scroll", edge: "scrollTop" }, { frameId: 7 }]));
});

test("rejects unknown gestures, foreign senders, disabled settings, and inactive tabs", async () => {
  const app = worker({ gesture: "L", action: "back" });
  for (const [message, sender] of [
    [{ type: "glide:gesture", gesture: "RR" }, undefined],
    [{ type: "glide:gesture", gesture: "R" }, undefined],
    [{ type: "glide:gesture", gesture: "L" }, { id: "foreign", tab: app.tab }],
    [{ type: "glide:gesture", gesture: "L" }, { id: "test-extension" }]
  ]) assert.equal((await app.send(message, sender)).ok, false);
  app.tab.active = false;
  assert.equal((await app.send()).ok, false);
  assert.equal((await worker({ gesture: "L", action: "back" }, { enabled: false }).send()).ok, false);
  assert.equal(app.calls.length, 0);
});

test("browser failures are returned to the user", async () => {
  const app = worker({ gesture: "L", action: "back" });
  app.chrome.tabs.goBack = async () => { throw new Error("No history"); };
  assert.equal((await app.send()).error, "No history");
});

test("typed Ctrl+T and Ctrl+W run the corresponding browser APIs", async () => {
  for (const [shortcut, method] of [["Ctrl+T", "create"], ["Ctrl+W", "remove"], ["Ctrl+R", "reload"], ["Alt+Left", "back"]]) {
    const app = worker({ gesture: "RD", action: "keyboard", shortcut });
    assert.equal((await app.send()).ok, true);
    assert.equal(app.calls[0][0], method);
  }
});

test("custom website keys go to the original frame using saved settings", async () => {
  const app = worker({ gesture: "RD", action: "keyboard", shortcut: "Ctrl+K" });
  app.chrome.tabs.sendMessage = async (...args) => { app.calls.push(["sendMessage", ...args]); return { ok: true }; };
  assert.equal((await app.send()).ok, true);
  assert.equal(JSON.stringify(app.calls[0]), JSON.stringify(["sendMessage", 5, { type: "glide:shortcut", shortcut: "Ctrl+K" }, { frameId: 7 }]));
});

test("invalid saved keys and website delivery failures return errors", async () => {
  const invalid = worker({ gesture: "RD", action: "keyboard", shortcut: "Ctrl+" });
  assert.equal((await invalid.send()).ok, false);
  assert.equal(invalid.calls.length, 0);
  const app = worker({ gesture: "RD", action: "keyboard", shortcut: "F" });
  app.chrome.tabs.sendMessage = async () => ({ ok: false, error: "No target" });
  assert.equal((await app.send()).error, "No target");
});

test("Ctrl+N, Cmd+N, and the new-window action create a browser window in the source privacy mode", async () => {
  for (const incognito of [false, true]) {
    for (const rule of [{ gesture: "RD", action: "keyboard", shortcut: "Ctrl+N" },
      { gesture: "RD", action: "keyboard", shortcut: "Cmd+N" }, { gesture: "RD", action: "newWindow" }]) {
      const app = worker(rule);
      app.tab.incognito = incognito;
      assert.equal((await app.send()).ok, true);
      assert.equal(JSON.stringify(app.calls), JSON.stringify([["newWindow", { type: "normal", focused: true, incognito }]]));
    }
  }
});

test("new-window API errors are reported without falling back to website keys", async () => {
  const app = worker({ gesture: "RD", action: "keyboard", shortcut: "Ctrl+N" });
  app.chrome.windows.create = async () => { throw new Error("Window creation failed"); };
  assert.equal((await app.send()).error, "Window creation failed");
  assert.equal(app.calls.length, 0);
});

test("settings are cached between gestures and re-read after a storage change", async () => {
  const app = worker({ gesture: "L", action: "back" });
  assert.equal((await app.send()).ok, true);
  assert.equal((await app.send()).ok, true);
  // 같은 워커에서 두 번째 제스처는 저장소를 다시 읽지 않는다.
  assert.equal(app.reads.count, 1);
  // 다른 영역·다른 키의 변경은 캐시를 버리지 않는다.
  for (const listener of app.changeListeners) listener({ other: {} }, "local");
  for (const listener of app.changeListeners) listener({ settings: {} }, "sync");
  await app.send();
  assert.equal(app.reads.count, 1);
  // 설정을 바꾸면 다음 제스처에서 새 값을 읽어 반영한다.
  app.chrome.storage.local.get = async () => {
    app.reads.count++;
    return { settings: { enabled: true, threshold: 22, rules: [{ gesture: "L", action: "forward" }] } };
  };
  for (const listener of app.changeListeners) listener({ settings: {} }, "local");
  assert.equal((await app.send()).ok, true);
  assert.equal(app.reads.count, 2);
  assert.equal(app.calls.at(-1)[0], "forward");
});

test("failed settings reads are not cached", async () => {
  const app = worker({ gesture: "L", action: "back" });
  const original = app.chrome.storage.local.get;
  app.chrome.storage.local.get = async () => { throw new Error("storage busy"); };
  assert.equal((await app.send()).error, "storage busy");
  app.chrome.storage.local.get = original;
  assert.equal((await app.send()).ok, true);
});
