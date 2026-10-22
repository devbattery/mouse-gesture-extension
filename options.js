const { actions, arrows, Gesture, Trail } = GestureKit;
const $ = selector => document.querySelector(selector);
let settings;
let editingIndex;
let recorded = "";
let recording;
let recordingPointer;
let draftRule;
let bindingCount = 0;
const recordTrail = new Trail($("#record-canvas"));

function status(text, error = false) {
  $("#status").textContent = text;
  $("#status").dataset.error = error;
}

function dirty() {
  $("#save").disabled = false;
  status("변경사항을 저장해 주세요.");
}

function bindingControls(rule, onChange, name) {
  const container = document.createElement("div");
  container.className = "binding";
  const select = document.createElement("select");
  select.setAttribute("aria-label", `${name} 실행 방식`);
  // 새 제스처는 먼저 동작을 고르도록 비워 둔다. 내장 동작을 앞에 두어
  // 단축키를 직접 입력하지 않아도 된다는 사실이 드러나게 한다.
  const placeholder = document.createElement("option");
  placeholder.value = "";
  placeholder.textContent = "동작을 선택하세요";
  placeholder.disabled = true;
  select.append(placeholder);
  for (const [id, action] of Object.entries(actions)) {
    const option = document.createElement("option");
    option.value = id;
    option.textContent = action.label + (action.shortcut ? ` · ${action.shortcut}` : "");
    select.append(option);
  }
  const custom = document.createElement("option");
  custom.value = "keyboard";
  custom.textContent = "직접 단축키 입력";
  select.append(custom);
  select.value = rule.action;
  const controls = document.createElement("div");
  controls.className = "shortcut-controls";
  const input = document.createElement("input");
  input.type = "text";
  input.maxLength = 80;
  input.placeholder = "예: Ctrl+T, Alt+Left, F";
  input.autocomplete = "off";
  input.spellcheck = false;
  input.value = rule.shortcut || "";
  input.setAttribute("aria-label", `${name} 단축키`);
  const capture = document.createElement("button");
  capture.type = "button";
  capture.textContent = "키로 입력";
  capture.setAttribute("aria-label", `${name} 키로 입력`);
  capture.setAttribute("aria-pressed", "false");
  const hint = document.createElement("p");
  hint.className = "binding-hint";
  hint.setAttribute("role", "status");
  // 화면 낭독기가 동작 선택 안내를 함께 읽도록 힌트와 연결한다.
  hint.id = `binding-hint-${++bindingCount}`;
  select.setAttribute("aria-describedby", hint.id);
  let listening = false;

  function preview() {
    const keyboard = rule.action === "keyboard";
    controls.hidden = !keyboard;
    hint.hidden = false;
    // 아직 동작을 고르지 않은 새 제스처는 오류가 아니라 안내를 보여 준다.
    if (!rule.action) {
      hint.textContent = "실행할 동작을 선택하거나 단축키를 직접 입력하세요.";
      hint.dataset.error = "false";
      return;
    }
    if (!keyboard) { hint.hidden = true; return; }
    if (!input.value.trim()) {
      hint.textContent = "단축키를 입력하거나 ‘키로 입력’을 누르세요.";
      hint.dataset.error = "false";
      return;
    }
    try {
      const shortcut = GestureKit.parseShortcut(rule.shortcut);
      const action = GestureKit.shortcutAction(shortcut);
      hint.textContent = action ? `${shortcut.text} → ${actions[action].label}` :
        `${shortcut.text} → 웹페이지 단축키 · 사이트에 따라 동작하지 않을 수 있습니다.`;
      hint.dataset.error = "false";
    } catch (error) {
      hint.textContent = error.message;
      hint.dataset.error = "true";
    }
  }
  function stopCapture() {
    listening = false;
    capture.textContent = "키로 입력";
    capture.setAttribute("aria-pressed", "false");
    preview();
  }
  select.addEventListener("change", () => {
    rule.action = select.value;
    if (rule.action === "keyboard") rule.shortcut = input.value;
    else delete rule.shortcut;
    stopCapture();
    onChange();
    if (rule.action === "keyboard") input.focus();
  });
  input.addEventListener("input", () => { rule.shortcut = input.value; preview(); onChange(); });
  input.addEventListener("blur", () => {
    try { input.value = rule.shortcut = GestureKit.parseShortcut(input.value).text; } catch {}
    preview();
  });
  capture.addEventListener("click", () => {
    if (listening) { stopCapture(); return; }
    listening = true;
    capture.textContent = "키를 누르세요…";
    capture.setAttribute("aria-pressed", "true");
    hint.textContent = "키 조합을 누르세요. Esc는 취소. 브라우저가 가로채면 입력란에 Ctrl+T처럼 적어 주세요.";
    hint.dataset.error = "false";
  });
  capture.addEventListener("keydown", event => {
    if (!listening) return;
    event.preventDefault();
    event.stopPropagation();
    if (event.key === "Escape" && !event.ctrlKey && !event.altKey && !event.metaKey && !event.shiftKey) { stopCapture(); return; }
    try {
      const shortcut = GestureKit.shortcutFromEvent(event);
      if (!shortcut) return;
      input.value = rule.shortcut = shortcut;
      stopCapture();
      onChange();
    } catch (error) { hint.textContent = error.message; hint.dataset.error = "true"; }
  });
  capture.addEventListener("blur", stopCapture);
  controls.append(input, capture);
  container.append(select, controls, hint);
  preview();
  return container;
}

function render() {
  $("#enabled").checked = settings.enabled;
  $("#threshold").value = settings.threshold;
  $("#distance").value = `${settings.threshold} px`;
  $("#empty").hidden = settings.rules.length !== 0;
  $("#add").disabled = settings.rules.length >= 64;
  $("#rules").replaceChildren();
  settings.rules.forEach((rule, index) => {
    const row = document.createElement("tr");
    const gestureCell = row.insertCell();
    const button = document.createElement("button");
    button.className = "gesture-button";
    button.textContent = arrows(rule.gesture);
    button.setAttribute("aria-label", `${arrows(rule.gesture)} 제스처 다시 그리기`);
    button.addEventListener("click", () => openRecorder(index));
    gestureCell.append(button);
    row.insertCell().append(bindingControls(rule, dirty, arrows(rule.gesture)));
    const remove = document.createElement("button");
    remove.className = "icon-button";
    remove.textContent = "×";
    remove.setAttribute("aria-label", `${arrows(rule.gesture)} 제스처 삭제`);
    remove.addEventListener("click", () => {
      settings.rules.splice(index, 1);
      render();
      dirty();
      const next = $("#rules").rows[Math.min(index, settings.rules.length - 1)];
      (next?.querySelector(".icon-button") || $("#add")).focus();
    });
    row.insertCell().append(remove);
    $("#rules").append(row);
  });
}

function clearRecord() {
  recording = undefined;
  recorded = "";
  recordTrail.clear();
  $("#record-placeholder").hidden = false;
  $("#recorded").textContent = "아직 그리지 않았어요";
  $("#record-error").textContent = "";
  $("#use-record").disabled = true;
}

function openRecorder(index) {
  editingIndex = index;
  draftRule = index === undefined ? { action: "" } : structuredClone(settings.rules[index]);
  clearRecord();
  $("#record-binding").replaceChildren(bindingControls(draftRule, validateRecord, "등록할 제스처"));
  $("#recorder").showModal();
}

function validateRecord() {
  const duplicate = settings.rules.some((rule, index) => rule.gesture === recorded && index !== editingIndex);
  let error = duplicate ? "이미 등록된 제스처입니다. 다른 방향으로 그려 주세요." : "";
  const missingAction = !draftRule.action;
  const missingShortcut = draftRule.action === "keyboard" && !draftRule.shortcut.trim();
  if (missingAction) error ||= "실행할 동작을 선택해 주세요.";
  else if (draftRule.action === "keyboard" && !missingShortcut) {
    try { GestureKit.parseShortcut(draftRule.shortcut); } catch (caught) { error ||= caught.message; }
  }
  $("#record-error").textContent = error;
  $("#use-record").disabled = !recorded || missingAction || missingShortcut || !!error;
}

$("#draw-area").addEventListener("contextmenu", event => event.preventDefault());
$("#draw-area").addEventListener("pointerdown", event => {
  if (event.button !== 2 || event.buttons !== 2) return;
  clearRecord();
  const rect = event.currentTarget.getBoundingClientRect();
  recording = new Gesture(event.clientX, event.clientY, settings.threshold);
  recordingPointer = event.pointerId;
  event.currentTarget.setPointerCapture(event.pointerId);
  recordTrail.start(event.clientX - rect.left, event.clientY - rect.top);
  $("#record-placeholder").hidden = true;
  event.preventDefault();
});
$("#draw-area").addEventListener("pointermove", event => {
  if (!recording || event.pointerId !== recordingPointer || !(event.buttons & 2)) return;
  recording.move(event.clientX, event.clientY);
  const rect = event.currentTarget.getBoundingClientRect();
  recordTrail.add(event.clientX - rect.left, event.clientY - rect.top);
  $("#recorded").textContent = arrows(recording.sequence) || "그리는 중…";
});
$("#draw-area").addEventListener("pointerup", event => {
  if (!recording || event.pointerId !== recordingPointer || event.button !== 2) return;
  recording.move(event.clientX, event.clientY);
  recorded = recording.invalid ? "" : recording.sequence;
  recording = undefined;
  $("#recorded").textContent = arrows(recorded) || "조금 더 길고 분명하게 그려 주세요";
  validateRecord();
});
$("#draw-area").addEventListener("pointercancel", clearRecord);
$("#draw-area").addEventListener("lostpointercapture", () => { if (recording) clearRecord(); });
window.addEventListener("blur", () => { if (recording) clearRecord(); });
$("#recorder").addEventListener("close", clearRecord);
$("#cancel-record").addEventListener("click", () => $("#recorder").close());
$("#clear-record").addEventListener("click", clearRecord);
$("#use-record").addEventListener("click", () => {
  if (!recorded || $("#use-record").disabled) return;
  const rule = { ...draftRule, gesture: recorded };
  if (rule.action === "keyboard") rule.shortcut = GestureKit.parseShortcut(rule.shortcut).text;
  if (editingIndex === undefined) settings.rules.push(rule);
  else settings.rules[editingIndex] = rule;
  $("#recorder").close();
  render();
  dirty();
});
$("#add").addEventListener("click", () => openRecorder());
$("#enabled").addEventListener("change", event => { settings.enabled = event.target.checked; dirty(); });
$("#threshold").addEventListener("input", event => {
  settings.threshold = Number(event.target.value);
  $("#distance").value = `${settings.threshold} px`;
  dirty();
});
$("#reset").addEventListener("click", () => {
  settings.rules = structuredClone(GestureKit.defaults.rules);
  render();
  dirty();
  status("기본 제스처를 불러왔습니다. 저장하면 적용됩니다.");
});
$("#save").addEventListener("click", async () => {
  try {
    const value = GestureKit.validateSettings(settings);
    $("#save").disabled = true;
    await chrome.storage.local.set({ settings: value });
    status("저장했습니다. 열린 웹페이지에도 바로 적용됩니다.");
  } catch (error) {
    $("#save").disabled = false;
    status(error.message, true);
  }
});
window.addEventListener("beforeunload", event => {
  if (!$("#save").disabled) { event.preventDefault(); event.returnValue = ""; }
});
GestureKit.readSettings().then(value => { settings = value; render(); }).catch(error => {
  settings = structuredClone(GestureKit.defaults);
  render();
  dirty();
  status(`설정을 읽지 못했습니다. ${error.message} 저장하면 기본값으로 복구합니다.`, true);
});
