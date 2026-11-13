importScripts("shared.js");

chrome.action.onClicked.addListener(() => chrome.runtime.openOptionsPage());

// Chrome UI와 같은 확대/축소 단계(25%~500%). 한 단계씩 이동해 체감 배율을 맞춘다.
const zoomLevels = [0.25, 0.33, 0.5, 0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3, 4, 5];

async function zoom(tabId, step) {
  const current = await chrome.tabs.getZoom(tabId);
  // 현재 배율과 같거나 큰 단계를 기준점으로 삼아 비표준 배율에서도 자연스럽게 이동한다.
  const index = zoomLevels.findIndex(level => level >= current - 0.001);
  const from = index === -1 ? zoomLevels.length - 1 : index;
  const target = zoomLevels[Math.min(zoomLevels.length - 1, Math.max(0, from + step))];
  return chrome.tabs.setZoom(tabId, target);
}

// F11처럼 전체 화면과 일반 상태를 오간다.
async function toggleFullscreen(windowId) {
  const window = await chrome.windows.get(windowId);
  return chrome.windows.update(windowId, { state: window.state === "fullscreen" ? "normal" : "fullscreen" });
}

async function execute(action, tab, frameId) {
  switch (action) {
    case "back": return chrome.tabs.goBack(tab.id);
    case "forward": return chrome.tabs.goForward(tab.id);
    case "newTab": return chrome.tabs.create({ windowId: tab.windowId, index: tab.index + 1, openerTabId: tab.id });
    case "newWindow": return chrome.windows.create({ type: "normal", focused: true, incognito: !!tab.incognito });
    case "closeTab": return chrome.tabs.remove(tab.id);
    case "reload": return chrome.tabs.reload(tab.id);
    case "hardReload": return chrome.tabs.reload(tab.id, { bypassCache: true });
    case "zoomIn": return zoom(tab.id, 1);
    case "zoomOut": return zoom(tab.id, -1);
    case "zoomReset": return chrome.tabs.setZoom(tab.id, 0);
    case "fullscreen": return toggleFullscreen(tab.windowId);
    case "duplicateTab": return chrome.tabs.duplicate(tab.id);
    case "muteTab": return chrome.tabs.update(tab.id, { muted: !tab.mutedInfo?.muted });
    case "restoreTab": {
      const sessions = await chrome.sessions.getRecentlyClosed();
      const session = sessions.find(item => item.tab?.sessionId);
      if (!session) throw new Error("다시 열 수 있는 탭이 없습니다.");
      return chrome.sessions.restore(session.tab.sessionId);
    }
    case "previousTab":
    case "nextTab": {
      const tabs = (await chrome.tabs.query({ windowId: tab.windowId })).sort((a, b) => a.index - b.index);
      const index = tabs.findIndex(item => item.id === tab.id);
      const step = action === "nextTab" ? 1 : -1;
      return chrome.tabs.update(tabs[(index + step + tabs.length) % tabs.length].id, { active: true });
    }
    case "scrollTop":
    case "scrollBottom":
      return chrome.tabs.sendMessage(tab.id, { type: "glide:scroll", edge: action }, { frameId });
    default: throw new Error("지원하지 않는 동작입니다.");
  }
}

// 서비스 워커가 살아 있는 동안 검증된 설정을 메모리에 보관한다.
// 제스처마다 storage 왕복과 전체 설정 검증을 반복하지 않게 하고,
// 설정이 바뀌면 즉시 무효화해 다음 제스처에서 새 값을 읽는다.
// 워커가 종료되면 캐시도 함께 사라지므로 오래된 값이 남지 않는다.
let settingsCache;
function cachedSettings() {
  if (!settingsCache) {
    const pending = GestureKit.readSettings().catch(error => {
      // 읽기·검증 실패는 캐시하지 않고 다음 요청에서 다시 시도한다.
      // 그 사이 설정 변경으로 새 읽기가 캐시에 들어갔다면 그것은 지우지 않는다.
      if (settingsCache === pending) settingsCache = undefined;
      throw error;
    });
    settingsCache = pending;
  }
  return settingsCache;
}
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes.settings) settingsCache = undefined;
});

chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (message?.type !== "glide:gesture") return;
  if (sender.id !== chrome.runtime.id || !sender.tab || !GestureKit.validGesture(message.gesture)) {
    respond({ ok: false, error: "올바르지 않은 요청입니다." });
    return;
  }
  (async () => {
    // sender.tab은 메시지를 보낸 순간의 탭 정보(활성 여부·창·위치·음소거)를 담고 있어
    // 별도 chrome.tabs.get 왕복 없이 그대로 쓴다.
    const tab = sender.tab;
    const settings = await cachedSettings();
    const rule = settings.rules.find(item => item.gesture === message.gesture);
    if (!settings.enabled || !rule) throw new Error("사용하지 않는 제스처입니다.");
    if (!tab.active) throw new Error("현재 보고 있는 탭에서만 실행할 수 있습니다.");
    if (rule.action === "keyboard") {
      const action = GestureKit.shortcutAction(rule.shortcut);
      if (action) await execute(action, tab, sender.frameId);
      else {
        const response = await chrome.tabs.sendMessage(tab.id, { type: "glide:shortcut", shortcut: rule.shortcut }, { frameId: sender.frameId });
        if (!response?.ok) throw new Error(response?.error || "웹페이지에 단축키를 전달하지 못했습니다.");
      }
    } else await execute(rule.action, tab, sender.frameId);
    respond({ ok: true });
  })().catch(error => respond({ ok: false, error: error.message }));
  return true;
});
