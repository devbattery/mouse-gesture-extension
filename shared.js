/* Shared by the content script, settings page, and service worker. */
globalThis.GestureKit = (() => {
  const actions = {
    back: { label: "뒤로 가기", shortcut: "Alt + ← / ⌘ + [" },
    forward: { label: "앞으로 가기", shortcut: "Alt + → / ⌘ + ]" },
    newTab: { label: "새 탭", shortcut: "Ctrl / ⌘ + T" },
    newWindow: { label: "새 창", shortcut: "Ctrl / ⌘ + N" },
    closeTab: { label: "현재 탭 닫기", shortcut: "Ctrl / ⌘ + W" },
    reload: { label: "새로고침", shortcut: "Ctrl / ⌘ + R" },
    hardReload: { label: "강력 새로고침", shortcut: "Shift + F5 / Ctrl / ⌘ + Shift + R" },
    restoreTab: { label: "닫은 탭 다시 열기", shortcut: "Ctrl / ⌘ + Shift + T" },
    previousTab: { label: "이전 탭", shortcut: "Ctrl + Shift + Tab" },
    nextTab: { label: "다음 탭", shortcut: "Ctrl + Tab" },
    scrollTop: { label: "맨 위로", shortcut: "Home" },
    scrollBottom: { label: "맨 아래로", shortcut: "End" },
    zoomIn: { label: "확대", shortcut: "Ctrl / ⌘ + +" },
    zoomOut: { label: "축소", shortcut: "Ctrl / ⌘ + -" },
    zoomReset: { label: "원래 크기로", shortcut: "Ctrl / ⌘ + 0" },
    fullscreen: { label: "전체 화면 전환", shortcut: "F11" },
    duplicateTab: { label: "탭 복제", shortcut: "" },
    muteTab: { label: "탭 음소거 켜기 / 끄기", shortcut: "" }
  };
  const defaults = {
    enabled: true,
    threshold: 22,
    rules: [
      ["L", "back"], ["R", "forward"], ["D", "newTab"],
      ["DR", "closeTab"], ["UD", "reload"], ["DU", "restoreTab"],
      ["UL", "previousTab"], ["UR", "nextTab"],
      ["U", "scrollTop"], ["DL", "scrollBottom"]
    ].map(([gesture, action]) => ({ gesture, action }))
  };
  const validGesture = value => typeof value === "string" &&
    /^[LRUD]{1,12}$/.test(value) && !/([LRUD])\1/.test(value);

  // 현재 그린 시퀀스로 시작하는 더 긴 제스처가 있는지 확인한다.
  // 다방향 제스처를 그리는 중간에 "등록되지 않은 제스처"로 오해하지 않게 한다.
  const continuesGesture = (sequence, rules) => rules.some(rule =>
    rule.gesture.length > sequence.length && rule.gesture.startsWith(sequence));

  const keyNames = {
    space: [" ", "Space", 32], enter: ["Enter", "Enter", 13], tab: ["Tab", "Tab", 9],
    escape: ["Escape", "Escape", 27], backspace: ["Backspace", "Backspace", 8],
    delete: ["Delete", "Delete", 46], insert: ["Insert", "Insert", 45],
    home: ["Home", "Home", 36], end: ["End", "End", 35],
    pageup: ["PageUp", "PageUp", 33], pagedown: ["PageDown", "PageDown", 34],
    arrowleft: ["ArrowLeft", "ArrowLeft", 37], arrowup: ["ArrowUp", "ArrowUp", 38],
    arrowright: ["ArrowRight", "ArrowRight", 39], arrowdown: ["ArrowDown", "ArrowDown", 40]
  };
  const punctuation = {
    "-": ["Minus", 189, "_"], "=": ["Equal", 187, "+"], "[": ["BracketLeft", 219, "{"],
    "]": ["BracketRight", 221, "}"], "\\": ["Backslash", 220, "|"],
    ";": ["Semicolon", 186, ":"], "'": ["Quote", 222, '"'],
    ",": ["Comma", 188, "<"], ".": ["Period", 190, ">"],
    "/": ["Slash", 191, "?"], "`": ["Backquote", 192, "~"]
  };
  const modifierNames = { ctrl: "ctrlKey", control: "ctrlKey", alt: "altKey", option: "altKey",
    shift: "shiftKey", meta: "metaKey", cmd: "metaKey", command: "metaKey" };

  function parseShortcut(text) {
    if (typeof text !== "string" || !text.trim() || text.length > 80) throw new Error("Ctrl+T처럼 단축키를 입력해 주세요.");
    const parts = text.trim().replace(/\+\s*$/, "Plus").split("+").map(part => part.trim());
    let name = parts.pop();
    const result = { ctrlKey: false, altKey: false, shiftKey: false, metaKey: false };
    for (const part of parts) {
      const modifier = Object.hasOwn(modifierNames, part.toLowerCase()) && modifierNames[part.toLowerCase()];
      if (!modifier || result[modifier]) throw new Error("보조 키는 Ctrl, Alt, Shift, Cmd를 한 번씩만 입력해 주세요.");
      result[modifier] = true;
    }
    const aliases = { left: "arrowleft", right: "arrowright", up: "arrowup", down: "arrowdown",
      esc: "escape", return: "enter", spacebar: "space", del: "delete", pgup: "pageup", pgdn: "pagedown" };
    const lookup = Object.hasOwn(aliases, name.toLowerCase()) ? aliases[name.toLowerCase()] : name.toLowerCase();
    if (/^[a-z]$/i.test(name)) {
      name = name.toUpperCase();
      Object.assign(result, { key: result.shiftKey ? name : name.toLowerCase(), code: `Key${name}`, keyCode: name.charCodeAt(0) });
    } else if (/^[0-9]$/.test(name)) {
      Object.assign(result, { key: result.shiftKey ? ")!@#$%^&*("[Number(name)] : name, code: `Digit${name}`, keyCode: name.charCodeAt(0) });
    } else if (/^f([1-9]|1[0-9]|2[0-4])$/i.test(name)) {
      name = name.toUpperCase();
      Object.assign(result, { key: name, code: name, keyCode: 111 + Number(name.slice(1)) });
    } else if (Object.hasOwn(keyNames, lookup)) {
      const [key, code, keyCode] = keyNames[lookup];
      Object.assign(result, { key, code, keyCode });
      name = code;
    } else {
      if (lookup === "plus") name = "+";
      const entry = Object.entries(punctuation).find(([key, value]) => key === name || value[2] === name);
      if (!entry) throw new Error("지원하지 않는 키입니다. 예: Ctrl+T, Alt+Left, Shift+F, Space");
      const [key, [code, keyCode, shifted]] = entry;
      if (name === shifted) result.shiftKey = true;
      // shortcut: typed punctuation uses the US layout; add layout selection if another layout is needed.
      Object.assign(result, { key: result.shiftKey ? shifted : key, code, keyCode });
      name = key;
    }
    result.text = [result.ctrlKey && "Ctrl", result.altKey && "Alt", result.shiftKey && "Shift", result.metaKey && "Cmd", name].filter(Boolean).join("+");
    return result;
  }

  function shortcutFromEvent(event) {
    if (["Control", "Alt", "Shift", "Meta", "AltGraph", "Dead", "Process", "Unidentified"].includes(event.key)) return null;
    const key = /^Key[A-Z]$/.test(event.code) ? event.code.slice(3) :
      /^Digit[0-9]$/.test(event.code) ? event.code.slice(5) : event.key === " " ? "Space" : event.key;
    return parseShortcut([event.ctrlKey && "Ctrl", event.altKey && "Alt", event.shiftKey && "Shift", event.metaKey && "Cmd", key].filter(Boolean).join("+")).text;
  }

  function shortcutAction(shortcut) {
    const text = typeof shortcut === "string" ? parseShortcut(shortcut).text : shortcut.text;
    // 브라우저 API로 실행할 수 있는 조합만 등록한다. 실제 키 입력이 아니므로
    // 표에 없는 조합은 웹페이지 키 이벤트로 전달되며 브라우저 UI를 열 수 없다.
    return ({
      "Ctrl+T": "newTab", "Cmd+T": "newTab", "Ctrl+W": "closeTab", "Cmd+W": "closeTab",
      "Ctrl+N": "newWindow", "Cmd+N": "newWindow",
      "Ctrl+R": "reload", "Cmd+R": "reload", F5: "reload",
      "Ctrl+Shift+R": "hardReload", "Shift+Cmd+R": "hardReload", "Shift+F5": "hardReload",
      "Ctrl+=": "zoomIn", "Ctrl+Shift+=": "zoomIn", "Cmd+=": "zoomIn", "Shift+Cmd+=": "zoomIn",
      "Ctrl+-": "zoomOut", "Cmd+-": "zoomOut",
      "Ctrl+0": "zoomReset", "Cmd+0": "zoomReset", F11: "fullscreen",
      "Ctrl+Shift+T": "restoreTab", "Shift+Cmd+T": "restoreTab",
      "Alt+ArrowLeft": "back", "Cmd+[": "back", "Alt+ArrowRight": "forward", "Cmd+]": "forward",
      "Ctrl+Tab": "nextTab", "Ctrl+PageDown": "nextTab",
      "Ctrl+Shift+Tab": "previousTab", "Ctrl+PageUp": "previousTab",
      Home: "scrollTop", "Ctrl+Home": "scrollTop", "Cmd+ArrowUp": "scrollTop",
      End: "scrollBottom", "Ctrl+End": "scrollBottom", "Cmd+ArrowDown": "scrollBottom"
    })[text];
  }

  // 동작 목록과 제스처 안내에서 같은 형식으로 보여 주기 위한 라벨.
  // 브라우저 기본 단축키가 없는 동작도 빈칸 대신 이유를 표시한다.
  function actionLabel(id) {
    const action = actions[id];
    return action.shortcut ? `${action.shortcut} · ${action.label}` : `${action.label} · 기본 단축키 없음`;
  }

  function ruleLabel(rule) {
    if (rule.action !== "keyboard") return actionLabel(rule.action);
    const action = shortcutAction(rule.shortcut);
    return `${rule.shortcut} · ${action ? actions[action].label : "웹페이지 단축키"}`;
  }

  // 제스처 규칙 배열을 검증하고 저장·내보내기에 필요한 필드만 남긴다.
  function validateRules(value) {
    if (!Array.isArray(value)) throw new Error("제스처 목록 형식이 올바르지 않습니다.");
    if (value.length > 64) throw new Error("제스처는 최대 64개까지 저장할 수 있습니다.");
    const seen = new Set();
    return value.map((rule, index) => {
      if (!rule || typeof rule !== "object" || Array.isArray(rule)) {
        throw new Error(`${index + 1}번째 제스처 형식이 올바르지 않습니다.`);
      }
      if (!validGesture(rule.gesture)) {
        throw new Error(`${index + 1}번째 제스처의 방향이 올바르지 않습니다.`);
      }
      if (!(Object.hasOwn(actions, rule.action) || rule.action === "keyboard")) {
        throw new Error(`${index + 1}번째 제스처의 동작이 올바르지 않습니다.`);
      }
      if (seen.has(rule.gesture)) {
        throw new Error(`${index + 1}번째 제스처가 중복되었습니다.`);
      }
      seen.add(rule.gesture);
      const result = { gesture: rule.gesture, action: rule.action };
      if (rule.action === "keyboard") result.shortcut = parseShortcut(rule.shortcut).text;
      return result;
    });
  }

  function validateSettings(value = structuredClone(defaults)) {
    if (!value || typeof value.enabled !== "boolean" ||
        !Number.isInteger(value.threshold) || value.threshold < 12 || value.threshold > 48 ||
        !Array.isArray(value.rules) || value.rules.length > 64) {
      throw new Error("설정 형식이 올바르지 않습니다.");
    }
    return { enabled: value.enabled, threshold: value.threshold, rules: validateRules(value.rules) };
  }

  // 다른 컴퓨터로 옮길 수 있는 제스처 파일 형식. 사용 여부와 감도는 기기별로
  // 유지하고, 제스처 방향·동작·직접 지정한 단축키만 담는다.
  function createGestureBackup(rules, extensionVersion) {
    if (!Array.isArray(rules)) throw new Error("내보낼 제스처 목록이 없습니다.");
    const payload = {
      app: "glide-mouse-gestures",
      format: "glide-gestures",
      formatVersion: 1,
      exportedAt: new Date().toISOString(),
      gestures: validateRules(rules)
    };
    if (typeof extensionVersion === "string" && extensionVersion) payload.extensionVersion = extensionVersion;
    return payload;
  }

  function parseGestureBackup(text) {
    if (typeof text !== "string") throw new Error("빈 파일입니다.");
    // Windows 편집기에서 붙은 UTF-8 BOM이 있어도 JSON을 읽는다.
    const source = text.replace(/^\uFEFF/, "");
    if (!source.trim()) throw new Error("빈 파일입니다.");
    let data;
    try {
      data = JSON.parse(source);
    } catch {
      throw new Error("JSON 파일을 읽지 못했습니다.");
    }
    let gestures;
    // 이전에 수동으로 만든 규칙 배열도 같은 방식으로 검증해 받아들인다.
    if (Array.isArray(data)) {
      gestures = data;
    } else if (data && typeof data === "object" && Object.hasOwn(data, "format")) {
      if (data.format !== "glide-gestures") throw new Error("Glide 제스처 파일이 아닙니다.");
      if (data.formatVersion !== 1) throw new Error("지원하지 않는 제스처 파일 버전입니다.");
      // 빈 값이나 누락된 목록을 기본값으로 대체하지 않는다.
      if (!Array.isArray(data.gestures)) throw new Error("제스처 목록이 없는 파일입니다.");
      gestures = data.gestures;
    } else {
      throw new Error("Glide 제스처 파일이 아닙니다.");
    }
    return validateRules(gestures);
  }

  class Gesture {
    constructor(x, y, threshold = 22) {
      this.x = x;
      this.y = y;
      this.threshold = threshold;
      this.sequence = "";
      this.moved = false;
      this.invalid = false;
    }

    move(x, y) {
      const dx = x - this.x;
      const dy = y - this.y;
      const ax = Math.abs(dx);
      const ay = Math.abs(dy);
      if (Math.hypot(dx, dy) < this.threshold) return;
      this.moved = true;
      const direction = ax > ay ? (dx < 0 ? "L" : "R") : (dy < 0 ? "U" : "D");
      // Wait for a clear turn instead of turning diagonal hand jitter into extra directions.
      if (direction !== this.sequence.at(-1) && Math.min(ax, ay) > Math.max(ax, ay) * 0.8) return;
      this.x = x;
      this.y = y;
      if (this.invalid || direction === this.sequence.at(-1)) return;
      if (this.sequence.length === 12) this.invalid = true;
      else this.sequence += direction;
    }
  }

  class Trail {
    constructor(canvas) {
      this.canvas = canvas;
      this.context = canvas.getContext("2d");
      this.frame = 0;
      this.queue = [];
    }

    start(x, y) {
      this.clear();
      const ratio = Math.min(devicePixelRatio || 1, 2);
      const rect = this.canvas.getBoundingClientRect();
      this.canvas.width = Math.ceil(rect.width * ratio);
      this.canvas.height = Math.ceil(rect.height * ratio);
      this.context.scale(ratio, ratio);
      Object.assign(this.context, { strokeStyle: "#7667f5", lineWidth: 4, lineCap: "round", lineJoin: "round" });
      this.last = { x, y };
    }

    add(x, y) {
      this.queue.push({ x, y });
      if (!this.frame) this.frame = requestAnimationFrame(() => this.draw());
    }

    draw() {
      this.frame = 0;
      if (!this.queue.length) return;
      const ctx = this.context;
      ctx.beginPath();
      ctx.moveTo(this.last.x, this.last.y);
      for (const point of this.queue) {
        const middle = { x: (this.last.x + point.x) / 2, y: (this.last.y + point.y) / 2 };
        ctx.quadraticCurveTo(this.last.x, this.last.y, middle.x, middle.y);
        this.last = point;
      }
      ctx.lineTo(this.last.x, this.last.y);
      ctx.stroke();
      this.queue.length = 0;
    }

    clear() {
      cancelAnimationFrame(this.frame);
      this.frame = 0;
      this.queue.length = 0;
      this.context.clearRect(0, 0, this.canvas.width, this.canvas.height);
    }

    // 제스처가 끝나면 백킹 스토어까지 반환한다.
    // 캔버스는 CSS 크기(width/height 100%)로 다시 늘어나므로 화면 배치는 그대로이고,
    // 넓은 화면(예: 4K·HiDPI)에서 제스처 한 번에 잡히던 수십 MB가 페이지 수명 동안 남지 않는다.
    release() {
      this.clear();
      if (this.canvas.width || this.canvas.height) {
        this.canvas.width = 0;
        this.canvas.height = 0;
      }
    }
  }

  const arrows = sequence => [...sequence].map(char => ({ L: "←", R: "→", U: "↑", D: "↓" })[char]).join(" ");
  const readSettings = async () => validateSettings((await chrome.storage.local.get("settings")).settings);
  return { actions, defaults, validGesture, validateSettings, validateRules, createGestureBackup, parseGestureBackup, readSettings, Gesture, Trail, arrows,
    parseShortcut, shortcutFromEvent, shortcutAction, actionLabel, ruleLabel, continuesGesture };
})();
