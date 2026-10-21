(() => {
  const { Gesture, Trail, arrows, ruleLabel } = GestureKit;
  let settings;
  let gesture;
  let pointerId;
  let origin;
  let scrollTarget;
  let overlay;
  let trail;
  let label;
  let hideTimer;
  let suppressUntil = 0;

  GestureKit.readSettings().then(value => { settings = value; }).catch(console.warn);
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local" || !changes.settings) return;
    try {
      settings = GestureKit.validateSettings(changes.settings.newValue);
      cancel();
    } catch (error) { console.warn("Glide:", error); }
  });

  function showOverlay() {
    if (!overlay) {
      overlay = document.createElement("div");
      overlay.style.cssText = "all:initial!important;position:fixed!important;inset:0!important;z-index:2147483647!important;pointer-events:none!important;display:block!important;";
      const shadow = overlay.attachShadow({ mode: "closed" });
      const style = document.createElement("style");
      style.textContent = ":host{color-scheme:dark}canvas{position:absolute;inset:0;width:100%;height:100%;pointer-events:none}div{position:absolute;bottom:44px;left:50%;transform:translateX(-50%);max-width:85%;padding:12px 20px;border:1px solid #ffffff26;border-radius:16px;background:#191923ed;color:#fff;box-shadow:0 8px 32px #0003;font:500 14px/1.5 system-ui,sans-serif;white-space:pre-wrap;text-align:center}span{color:#b7aaff;font-size:20px;font-weight:650;margin-right:12px}";
      const canvas = document.createElement("canvas");
      label = document.createElement("div");
      label.setAttribute("role", "status");
      shadow.append(style, canvas, label);
      trail = new Trail(canvas);
    }
    clearTimeout(hideTimer);
    (document.fullscreenElement || document.documentElement).append(overlay);
  }

  function showLabel(sequence, text) {
    label.replaceChildren();
    const pattern = document.createElement("span");
    pattern.textContent = arrows(sequence);
    label.append(pattern, document.createTextNode(text));
  }

  function hide() {
    clearTimeout(hideTimer);
    trail?.clear();
    overlay?.remove();
  }

  function releaseCapture() {
    if (pointerId !== undefined && document.documentElement.hasPointerCapture(pointerId)) {
      document.documentElement.releasePointerCapture(pointerId);
    }
    pointerId = undefined;
  }

  function cancel() {
    if (gesture?.moved) suppressUntil = performance.now() + 500;
    gesture = undefined;
    releaseCapture();
    hide();
  }

  window.addEventListener("pointerdown", event => {
    if (!event.isTrusted) return;
    if (event.button !== 2) { if (gesture) cancel(); return; }
    cancel();
    suppressUntil = 0;
    if (!settings?.enabled || event.shiftKey || event.ctrlKey || event.altKey || event.metaKey || event.buttons !== 2) return;
    gesture = new Gesture(event.clientX, event.clientY, settings.threshold);
    pointerId = event.pointerId;
    origin = { x: event.clientX, y: event.clientY };
    scrollTarget = event.composedPath()[0];
  }, true);

  function move(event) {
    if (!event.isTrusted || !gesture || event.pointerId !== pointerId) return;
    if (!(event.buttons & 2)) { cancel(); return; }
    const wasMoved = gesture.moved;
    for (const sample of event.getCoalescedEvents?.() || []) gesture.move(sample.clientX, sample.clientY);
    gesture.move(event.clientX, event.clientY);
    if (!gesture.moved) return;
    if (!wasMoved) {
      showOverlay();
      trail.start(origin.x, origin.y);
      document.documentElement.setPointerCapture(pointerId);
    }
    trail.add(event.clientX, event.clientY);
    const rule = !gesture.invalid && settings.rules.find(item => item.gesture === gesture.sequence);
    showLabel(gesture.sequence, gesture.invalid ? "너무 긴 제스처 · Esc로 취소" : rule ? ruleLabel(rule) : "등록되지 않은 제스처");
    if (event.cancelable) event.preventDefault();
  }
  window.addEventListener("pointermove", move, { capture: true, passive: false });

  window.addEventListener("pointerup", event => {
    if (!event.isTrusted || !gesture || event.pointerId !== pointerId || event.button !== 2) return;
    // Include the release point even when the browser coalesced the final movement.
    gesture.move(event.clientX, event.clientY);
    const finished = gesture;
    gesture = undefined;
    releaseCapture();
    if (!finished.moved) { hide(); return; }
    suppressUntil = performance.now() + 500;
    event.preventDefault();
    const rule = !finished.invalid && settings.rules.find(item => item.gesture === finished.sequence);
    showOverlay();
    trail.clear();
    showLabel(finished.sequence, rule ? ruleLabel(rule) : "등록되지 않은 제스처");
    hideTimer = setTimeout(hide, 750);
    if (!rule) return;
    chrome.runtime.sendMessage({ type: "glide:gesture", gesture: finished.sequence }).then(response => {
      if (response?.ok || gesture || !overlay?.isConnected) return;
      showLabel(finished.sequence, response?.error || "실행할 수 없습니다.");
      clearTimeout(hideTimer);
      hideTimer = setTimeout(hide, 2000);
    }).catch(() => {
      if (gesture || !overlay?.isConnected) return;
      showLabel("", "확장이 업데이트되었습니다. 페이지를 새로고침해 주세요.");
    });
  }, true);

  window.addEventListener("contextmenu", event => {
    if (!event.isTrusted || event.button !== 2) return;
    // Some platforms emit contextmenu on press; Shift + right-click always bypasses gestures.
    if (gesture || performance.now() < suppressUntil) {
      event.preventDefault();
      event.stopImmediatePropagation();
    }
  }, true);
  window.addEventListener("keydown", event => {
    if (event.key === "Escape" && gesture) cancel();
  }, true);
  window.addEventListener("pointercancel", cancel, true);
  window.addEventListener("lostpointercapture", () => { if (gesture) cancel(); }, true);
  window.addEventListener("blur", cancel);
  window.addEventListener("resize", cancel);
  document.addEventListener("visibilitychange", () => { if (document.hidden) cancel(); });
  document.addEventListener("fullscreenchange", cancel);
  document.addEventListener("pointerleave", event => { if (gesture && !gesture.moved && !event.relatedTarget) cancel(); });

  chrome.runtime.onMessage.addListener((message, sender, respond) => {
    if (sender.id !== chrome.runtime.id) return;
    if (message?.type === "glide:shortcut") {
      try {
        const shortcut = GestureKit.parseShortcut(message.shortcut);
        let target = document.activeElement;
        while (target?.shadowRoot?.activeElement) target = target.shadowRoot.activeElement;
        if (!target || target === document.body || target === document.documentElement) {
          target = scrollTarget?.isConnected ? scrollTarget : document.body || document.documentElement;
        }
        // shortcut: synthetic keys reach website handlers but cannot invoke native browser or OS shortcuts.
        for (const type of ["keydown", "keyup"]) {
          const event = new KeyboardEvent(type, { ...shortcut, bubbles: true, cancelable: true, composed: true,
            view: window, which: shortcut.keyCode });
          target.dispatchEvent(event);
        }
        respond({ ok: true });
      } catch (error) { respond({ ok: false, error: error.message }); }
      return;
    }
    if (message?.type !== "glide:scroll" || !["scrollTop", "scrollBottom"].includes(message.edge)) return;
    let target = scrollTarget;
    while (target instanceof Element) {
      if (target.scrollHeight > target.clientHeight + 1 && /auto|scroll/.test(getComputedStyle(target).overflowY)) break;
      target = target.parentElement || target.getRootNode()?.host;
    }
    target ||= document.scrollingElement;
    target?.scrollTo({ top: message.edge === "scrollTop" ? 0 : target.scrollHeight,
      behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth" });
  });
})();
