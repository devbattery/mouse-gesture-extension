const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const source = fs.readFileSync(path.join(__dirname, "../shared.js"), "utf8");
const kit = vm.runInNewContext(source + "; GestureKit", { structuredClone });

test("normalizes typed combinations and aliases", () => {
  for (const [input, expected] of [[" control + t ", "Ctrl+T"], ["ALT+left", "Alt+ArrowLeft"],
    ["Command+Shift+t", "Shift+Cmd+T"], ["Spacebar", "Space"], ["esc", "Escape"], ["pgdn", "PageDown"]]) {
    assert.equal(kit.parseShortcut(input).text, expected);
  }
});

test("builds the key, physical code, legacy code, and modifiers for website handlers", () => {
  const key = kit.parseShortcut("Ctrl+Shift+K");
  assert.equal(key.key, "K");
  assert.equal(key.code, "KeyK");
  assert.equal(key.keyCode, 75);
  assert.equal(key.ctrlKey, true);
  assert.equal(key.shiftKey, true);
  assert.equal(key.altKey, false);
  assert.equal(kit.parseShortcut("F12").keyCode, 123);
  assert.equal(kit.parseShortcut("Shift+2").key, "@");
});

test("punctuation and plus round-trip without changing the combination", () => {
  for (const text of ["Ctrl++", "Ctrl+Plus", "Cmd+[", "Ctrl+Shift+;", "Alt+/"]) {
    const shortcut = kit.parseShortcut(text);
    assert.equal(JSON.stringify(kit.parseShortcut(shortcut.text)), JSON.stringify(shortcut));
  }
  assert.equal(kit.parseShortcut("Ctrl++").key, "+");
});

test("maps supported browser combinations without claiming unknown keys are native", () => {
  for (const [input, expected] of [["Ctrl+T", "newTab"], ["Ctrl+W", "closeTab"], ["Cmd+R", "reload"],
    ["Ctrl+N", "newWindow"], ["Cmd+N", "newWindow"],
    ["F5", "reload"], ["Ctrl+Shift+T", "restoreTab"], ["Cmd+Shift+T", "restoreTab"],
    ["Alt+Left", "back"], ["Cmd+]", "forward"], ["Ctrl+Tab", "nextTab"],
    ["Ctrl+Shift+Tab", "previousTab"], ["Ctrl+Home", "scrollTop"], ["Ctrl+End", "scrollBottom"],
    ["Ctrl+Shift+R", "hardReload"], ["Shift+F5", "hardReload"], ["Cmd+Shift+R", "hardReload"],
    ["Ctrl++", "zoomIn"], ["Ctrl+=", "zoomIn"], ["Ctrl+-", "zoomOut"], ["Ctrl+0", "zoomReset"],
    ["F11", "fullscreen"]]) {
    assert.equal(kit.shortcutAction(input), expected);
  }
  for (const input of ["F", "Ctrl+K", "Ctrl+L", "Alt+T", "Ctrl+F5"]) assert.equal(kit.shortcutAction(input), undefined);
});

test("detects sequences that can continue into a longer gesture", () => {
  const rules = [{ gesture: "DLU" }, { gesture: "RD" }];
  assert.equal(kit.continuesGesture("D", rules), true);
  assert.equal(kit.continuesGesture("DL", rules), true);
  assert.equal(kit.continuesGesture("DLU", rules), false);
  assert.equal(kit.continuesGesture("R", rules), true);
  assert.equal(kit.continuesGesture("L", rules), false);
  assert.equal(kit.continuesGesture("D", []), false);
});

test("captures physical letter keys and ignores standalone modifiers", () => {
  assert.equal(kit.shortcutFromEvent({ key: "Control", code: "ControlLeft", ctrlKey: true }), null);
  assert.equal(kit.shortcutFromEvent({ key: "k", code: "KeyK", ctrlKey: true, shiftKey: true }), "Ctrl+Shift+K");
  assert.equal(kit.shortcutFromEvent({ key: " ", code: "Space" }), "Space");
});

test("rejects empty, malformed, duplicate-modifier, and prototype-key shortcuts", () => {
  for (const text of [undefined, null, {}, "", "Ctrl", "Ctrl+", "Ctrl+Ctrl+T", "Alt++T", "Ctrl+T+R", "Hyper+X", "__proto__+T", "constructor+T", "x".repeat(81)]) {
    assert.throws(() => kit.parseShortcut(text));
  }
});

test("preserves old settings and validates and retains custom keyboard bindings", () => {
  const old = kit.validateSettings();
  assert.equal(old.rules[0].action, "back");
  const value = kit.validateSettings({ ...old, rules: [...old.rules, { gesture: "RD", action: "keyboard", shortcut: "control+t" }] });
  assert.equal(value.rules.at(-1).shortcut, "Ctrl+T");
  assert.match(kit.ruleLabel(value.rules.at(-1)), /Ctrl\+T.*새 탭/);
  assert.match(kit.ruleLabel({ action: "keyboard", shortcut: "Ctrl+N" }), /Ctrl\+N.*새 창/);
  assert.match(kit.ruleLabel({ action: "keyboard", shortcut: "Ctrl+Shift+R" }), /Ctrl\+Shift\+R.*강력 새로고침/);
  assert.match(kit.ruleLabel({ action: "keyboard", shortcut: "F11" }), /F11.*전체 화면/);
  assert.match(kit.ruleLabel({ action: "keyboard", shortcut: "F" }), /웹페이지/);
  assert.throws(() => kit.validateSettings({ ...old, rules: [{ gesture: "RD", action: "keyboard" }] }));
});

test("built-in action labels include native shortcuts or an explicit no-shortcut note", () => {
  assert.match(kit.ruleLabel({ action: "reload" }), /Ctrl \/ ⌘ \+ R.*새로고침/);
  assert.match(kit.ruleLabel({ action: "scrollBottom" }), /End.*맨 아래로/);
  assert.match(kit.ruleLabel({ action: "duplicateTab" }), /탭 복제.*기본 단축키 없음/);
  assert.match(kit.ruleLabel({ action: "muteTab" }), /탭 음소거.*기본 단축키 없음/);
  // 화면에 표시되는 모든 내장 동작이 라벨과 단축키(또는 없음 안내)를 함께 가진다.
  for (const [id, action] of Object.entries(kit.actions)) {
    const label = kit.ruleLabel({ action: id });
    assert.ok(label.includes(action.label), `${id}: 동작 이름 누락`);
    assert.ok(action.shortcut ? label.includes(action.shortcut) : label.includes("기본 단축키 없음"), `${id}: 단축키 안내 누락`);
  }
});
