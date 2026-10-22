const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const source = fs.readFileSync(path.join(__dirname, "../shared.js"), "utf8");
const kit = vm.runInNewContext(source + "; GestureKit", { structuredClone });

test("ignores hand jitter and joins straight movement", () => {
  const gesture = new kit.Gesture(200, 200);
  for (let i = 0; i < 15; i++) gesture.move(200 + i % 5, 200 - i % 6);
  assert.equal(gesture.sequence, "");
  assert.equal(gesture.moved, false);
  for (let x = 180; x >= 50; x -= 10) gesture.move(x, 200 + x % 3);
  assert.equal(gesture.sequence, "L");
});

test("recognizes turns, reversals, and fast movement", () => {
  const gesture = new kit.Gesture(200, 200);
  for (const [x, y] of [[200, 300], [320, 300], [320, 200], [200, 200], [200, 300]]) gesture.move(x, y);
  assert.equal(gesture.sequence, "DRULD");
});

test("waits for a clear direction on a diagonal", () => {
  const gesture = new kit.Gesture(0, 0);
  gesture.move(30, 30);
  assert.equal(gesture.sequence, "");
  assert.equal(gesture.moved, true);
  gesture.move(70, 35);
  assert.equal(gesture.sequence, "R");
});

test("threshold is in CSS pixels and configurable", () => {
  const sensitive = new kit.Gesture(0, 0, 12);
  const stable = new kit.Gesture(0, 0, 48);
  sensitive.move(20, 0);
  stable.move(20, 0);
  assert.equal(sensitive.sequence, "R");
  assert.equal(stable.sequence, "");
});

test("overlong gestures cannot execute a valid prefix", () => {
  const gesture = new kit.Gesture(0, 0);
  for (let i = 0; i < 13; i++) gesture.move(i % 2 ? 0 : 100, 0);
  assert.equal(gesture.sequence.length, 12);
  assert.equal(gesture.invalid, true);
});

test("defaults are independent and validated; empty rules stay empty", () => {
  const first = kit.validateSettings();
  first.rules.pop();
  assert.equal(kit.validateSettings().rules.length, 10);
  assert.equal(kit.validateSettings({ enabled: false, threshold: 22, rules: [] }).rules.length, 0);
  assert.equal(kit.arrows("DRUL"), "↓ → ↑ ←");
});

test("rejects malformed settings, duplicates, and unknown actions", () => {
  for (const value of [null, {}, { ...kit.defaults, threshold: NaN }, { ...kit.defaults, threshold: 2 },
    { ...kit.defaults, rules: [{ gesture: "LL", action: "back" }] },
    { ...kit.defaults, rules: [{ gesture: "R", action: "__proto__" }] },
    { ...kit.defaults, rules: [kit.defaults.rules[0], kit.defaults.rules[0]] }]) {
    assert.throws(() => kit.validateSettings(value));
  }
  for (const value of [null, [], "", "L?", "L".repeat(100), "LL", 12]) assert.equal(kit.validGesture(value), false);
});

test("trail frees the canvas backing store when a gesture ends", () => {
  const context = { clearRect() {}, scale() {}, beginPath() {}, moveTo() {}, quadraticCurveTo() {}, lineTo() {}, stroke() {} };
  const canvas = { width: 0, height: 0, getBoundingClientRect: () => ({ width: 800, height: 600 }), getContext: () => context };
  // content script와 같은 DPR 상한(2배)에서 CSS 크기 × 2로 백킹 스토어를 잡는지 확인한다.
  const trailKit = vm.runInNewContext(source + "; GestureKit", { structuredClone, devicePixelRatio: 2,
    requestAnimationFrame: callback => { callback(); return 1; }, cancelAnimationFrame() {} });
  const trail = new trailKit.Trail(canvas);
  trail.start(0, 0);
  trail.add(10, 10);
  assert.equal(canvas.width, 1600);
  assert.equal(canvas.height, 1200);
  trail.release();
  assert.equal(canvas.width, 0);
  assert.equal(canvas.height, 0);
});
