const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const source = file => fs.readFileSync(path.join(__dirname, "..", file), "utf8");

// 최소 EventTarget 스텁: 어떤 타입의 리스너가 붙어 있는지만 센다.
function createTarget() {
  const listeners = new Map();
  return {
    addEventListener(type, fn) { listeners.set(`${type}:${fn}`, { type, fn }); },
    removeEventListener(type, fn) { listeners.delete(`${type}:${fn}`); },
    dispatch(type, event) { for (const item of [...listeners.values()]) if (item.type === type) item.fn(event); },
    types() { return [...new Set([...listeners.values()].map(item => item.type))].sort(); },
    count(type) { return [...listeners.values()].filter(item => item.type === type).length; }
  };
}

async function loadContentScript() {
  const window = createTarget();
  const document = Object.assign(createTarget(), {
    hidden: false, fullscreenElement: null, body: null,
    documentElement: { hasPointerCapture: () => false, releasePointerCapture() {}, setPointerCapture() {} }
  });
  const runtimeHandlers = [];
  const chrome = {
    runtime: { id: "test-extension", onMessage: { addListener(fn) { runtimeHandlers.push(fn); } } },
    storage: { local: { get: async () => ({}) }, onChanged: { addListener() {} } }
  };
  const context = vm.createContext({ window, document, chrome, console, setTimeout, clearTimeout,
    performance, structuredClone, KeyboardEvent: class {}, Element: class Element {} });
  vm.runInContext(source("shared.js"), context);
  const defaults = vm.runInContext("structuredClone(GestureKit.defaults)", context);
  chrome.storage.local.get = async () => ({ settings: defaults });
  vm.runInContext(source("content.js"), context);
  await new Promise(resolve => setTimeout(resolve, 0)); // 설정 읽기 완료 대기
  return { window, document, defaults, runtimeHandlers };
}

const pointerdown = { isTrusted: true, button: 2, buttons: 2, pointerId: 1, clientX: 100, clientY: 100,
  shiftKey: false, ctrlKey: false, altKey: false, metaKey: false,
  composedPath: () => [] };
const pointerup = { isTrusted: true, button: 2, pointerId: 1, clientX: 100, clientY: 100 };

test("page listeners are attached only while a gesture is being tracked", async () => {
  const { window, document } = await loadContentScript();
  // 유휴 상태: 우클릭 시작과 메뉴 억제에 필요한 두 개만 남는다.
  assert.deepEqual(window.types(), ["contextmenu", "pointerdown"]);
  assert.deepEqual(document.types(), []);

  window.dispatch("pointerdown", pointerdown);
  assert.deepEqual(window.types(), ["blur", "contextmenu", "keydown", "lostpointercapture",
    "pointercancel", "pointerdown", "pointermove", "pointerup", "resize"]);
  assert.deepEqual(document.types(), ["fullscreenchange", "pointerleave", "visibilitychange"]);
  // pointerdown이 반복돼도 추적 리스너가 중복 등록되지 않는다.
  assert.equal(window.count("pointermove"), 1);

  window.dispatch("pointerup", pointerup);
  assert.deepEqual(window.types(), ["contextmenu", "pointerdown"]);
  assert.deepEqual(document.types(), []);

  // 다음 제스처에서도 다시 붙었다가 정리된다.
  window.dispatch("pointerdown", pointerdown);
  assert.equal(window.count("pointermove"), 1);
  window.dispatch("pointerup", pointerup);
  assert.deepEqual(document.types(), []);
});

test("gestures can still start when settings are enabled", async () => {
  const { window, defaults } = await loadContentScript();
  assert.equal(defaults.enabled, true);
  window.dispatch("pointerdown", pointerdown);
  assert.equal(window.count("pointerup"), 1);
  window.dispatch("pointerup", pointerup);
});

test("scroll gestures jump instantly like Home and End", async () => {
  const { document, runtimeHandlers } = await loadContentScript();
  const calls = [];
  document.scrollingElement = {
    scrollHeight: 2400,
    scrollTo(options) { calls.push(options); }
  };
  const listener = runtimeHandlers[0];
  listener({ type: "glide:scroll", edge: "scrollTop" }, { id: "test-extension" }, () => {});
  listener({ type: "glide:scroll", edge: "scrollBottom" }, { id: "test-extension" }, () => {});
  // smooth가 아니라 instant여야 키보드 Home/End와 같은 즉시 이동이 된다.
  assert.equal(calls.length, 2);
  assert.equal(calls[0].top, 0);
  assert.equal(calls[0].behavior, "instant");
  assert.equal(calls[1].top, 2400);
  assert.equal(calls[1].behavior, "instant");
});
