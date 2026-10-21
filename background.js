importScripts("shared.js");

chrome.action.onClicked.addListener(() => chrome.runtime.openOptionsPage());

async function execute(action, tab, frameId) {
  switch (action) {
    case "back": return chrome.tabs.goBack(tab.id);
    case "forward": return chrome.tabs.goForward(tab.id);
    case "newTab": return chrome.tabs.create({ windowId: tab.windowId, index: tab.index + 1, openerTabId: tab.id });
    case "newWindow": return chrome.windows.create({ type: "normal", focused: true, incognito: !!tab.incognito });
    case "closeTab": return chrome.tabs.remove(tab.id);
    case "reload": return chrome.tabs.reload(tab.id);
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

chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (message?.type !== "glide:gesture") return;
  if (sender.id !== chrome.runtime.id || !sender.tab || !GestureKit.validGesture(message.gesture)) {
    respond({ ok: false, error: "올바르지 않은 요청입니다." });
    return;
  }
  (async () => {
    const settings = await GestureKit.readSettings();
    const rule = settings.rules.find(item => item.gesture === message.gesture);
    if (!settings.enabled || !rule) throw new Error("사용하지 않는 제스처입니다.");
    const tab = await chrome.tabs.get(sender.tab.id);
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
