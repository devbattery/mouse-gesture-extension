const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const source = fs.readFileSync(path.join(__dirname, "../shared.js"), "utf8");
const kit = vm.runInNewContext(source + "; GestureKit", { structuredClone });

const rules = [
  { gesture: "L", action: "back" },
  { gesture: "RD", action: "keyboard", shortcut: "control+shift+r" },
  { gesture: "UD", action: "reload" }
];

test("creates a versioned gesture backup and normalizes rules", () => {
  const payload = kit.createGestureBackup(rules, "0.2.5");
  assert.equal(payload.app, "glide-mouse-gestures");
  assert.equal(payload.format, "glide-gestures");
  assert.equal(payload.formatVersion, 1);
  assert.equal(payload.extensionVersion, "0.2.5");
  assert.match(payload.exportedAt, /^\d{4}-\d{2}-\d{2}T/);
  assert.deepEqual(JSON.parse(JSON.stringify(payload.gestures)), [
    { gesture: "L", action: "back" },
    { gesture: "RD", action: "keyboard", shortcut: "Ctrl+Shift+R" },
    { gesture: "UD", action: "reload" }
  ]);
  assert.equal(rules[1].shortcut, "control+shift+r");
});

test("round-trips wrapper files, raw arrays, and empty gesture lists", () => {
  const payload = kit.createGestureBackup(rules, "0.2.5");
  const expected = JSON.stringify(payload.gestures);
  assert.equal(JSON.stringify(kit.parseGestureBackup(JSON.stringify(payload))), expected);
  assert.equal(JSON.stringify(kit.parseGestureBackup(JSON.stringify(rules))), expected);
  assert.equal(JSON.stringify(kit.parseGestureBackup(JSON.stringify([]))), "[]");
  assert.equal(JSON.stringify(kit.parseGestureBackup(JSON.stringify({ format: "glide-gestures", formatVersion: 1, gestures: [] }))), "[]");
  assert.equal(JSON.stringify(kit.parseGestureBackup("\uFEFF" + JSON.stringify(payload))), expected);
});

test("rejects malformed, wrong-format, missing, and invalid gesture files", () => {
  for (const value of [
    "",
    "{",
    JSON.stringify({ format: "glide-settings", formatVersion: 1, gestures: [] }),
    JSON.stringify({ format: "glide-gestures", formatVersion: 2, gestures: [] }),
    JSON.stringify({ format: "glide-gestures", formatVersion: 1 }),
    JSON.stringify({ format: "glide-gestures", formatVersion: 1, gestures: null }),
    JSON.stringify({ rules: [] }),
    JSON.stringify([{ gesture: "LL", action: "back" }]),
    JSON.stringify([{ gesture: "R", action: "__proto__" }]),
    JSON.stringify([{ gesture: "RD", action: "keyboard" }]),
    JSON.stringify([
      { gesture: "L", action: "back" },
      { gesture: "L", action: "forward" }
    ])
  ]) {
    assert.throws(() => kit.parseGestureBackup(value));
  }
  assert.throws(() => kit.parseGestureBackup(JSON.stringify([
    { gesture: "L", action: "back" },
    { gesture: "L", action: "forward" }
  ])), /2번째 제스처가 중복/);
  assert.throws(() => kit.createGestureBackup(undefined));
});
