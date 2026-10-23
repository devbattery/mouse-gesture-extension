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
  let labelState = "";
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
      labelState = "";
    }
    clearTimeout(hideTimer);
    const host = document.fullscreenElement || document.documentElement;
    // 이미 붙어 있으면 다시 append하지 않는다(불필요한 DOM 이동·리플로우 방지).
    if (overlay.parentNode !== host) host.append(overlay);
  }

  // 라벨은 "상태 키"가 바뀔 때만 다시 그린다.
  // 예전에는 포인터가 움직일 때마다 replaceChildren()으로 노드를 새로 만들어
  // 제스처 중 매 프레임 DOM·스타일 재계산이 발생했고, role="status" 낭독도 반복됐다.
  function renderLabel(state, sequence, text) {
    if (state === labelState) return;
    labelState = state;
    label.replaceChildren();
    const pattern = document.createElement("span");
    pattern.textContent = arrows(sequence);
    label.append(pattern, document.createTextNode(text));
  }

  // 현재 제스처 방향(시퀀스)에 대한 안내 문구는 방향이 바뀔 때만 계산한다.
  function showGestureLabel(current) {
    const state = `g:${current.sequence}:${current.invalid}`;
    if (state === labelState) return;
    const rule = !current.invalid && settings.rules.find(item => item.gesture === current.sequence);
    // 아직 완성되지 않았지만 더 긴 규칙으로 이어질 수 있는 시퀀스는 진행 중으로 안내한다.
    const continuing = !current.invalid && !rule &&
      GestureKit.continuesGesture(current.sequence, settings.rules);
    renderLabel(state, current.sequence, current.invalid ? "너무 긴 제스처 · Esc로 취소"
      : rule ? ruleLabel(rule)
      : continuing ? "계속 그리세요" : "등록되지 않은 제스처");
  }

  // 실행 실패·확장 업데이트 안내처럼 제스처 상태와 무관한 문구.
  function showNotice(sequence, text) {
    renderLabel(`n:${sequence}:${text}`, sequence, text);
  }

  function hide() {
    clearTimeout(hideTimer);
    trail?.release();
    overlay?.remove();
    // 다음 제스처는 라벨을 새로 계산하게 한다(설정 변경·안내 문구 뒤의 잔상 방지).
    labelState = "";
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
    stopTracking();
    releaseCapture();
    hide();
  }

  // pointermove·pointerup·keydown·blur 같은 리스너는 제스처가 진행 중일 때만 등록한다.
  // 유휴 상태에서 페이지의 마우스 이동·키 입력마다 핸들러가 호출되던 비용을 없애고,
  // preventDefault가 필요 없는 동안 non-passive pointermove도 페이지 입력 경로에 남기지 않는다.
  // 등록 시점은 제스처를 만드는 pointerdown과 같은 태스크라 첫 이동을 놓치지 않는다.
  const moveOptions = { capture: true, passive: false };
  let tracking = false;

  function startTracking() {
    if (tracking) return;
    tracking = true;
    window.addEventListener("pointermove", move, moveOptions);
    window.addEventListener("pointerup", onPointerUp, true);
    window.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("pointercancel", cancel, true);
    window.addEventListener("lostpointercapture", onLostCapture, true);
    window.addEventListener("blur", cancel);
    window.addEventListener("resize", cancel);
    document.addEventListener("pointerleave", onPointerLeave, true);
    document.addEventListener("visibilitychange", onVisibilityChange);
    document.addEventListener("fullscreenchange", cancel);
  }

  function stopTracking() {
    if (!tracking) return;
    tracking = false;
    window.removeEventListener("pointermove", move, moveOptions);
    window.removeEventListener("pointerup", onPointerUp, true);
    window.removeEventListener("keydown", onKeyDown, true);
    window.removeEventListener("pointercancel", cancel, true);
    window.removeEventListener("lostpointercapture", onLostCapture, true);
    window.removeEventListener("blur", cancel);
    window.removeEventListener("resize", cancel);
    document.removeEventListener("pointerleave", onPointerLeave, true);
    document.removeEventListener("visibilitychange", onVisibilityChange);
    document.removeEventListener("fullscreenchange", cancel);
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
    startTracking();
  }, true);

  function move(event) {
    if (!event.isTrusted || !gesture || event.pointerId !== pointerId) return;
    if (!(event.buttons & 2)) { cancel(); return; }
    const wasMoved = gesture.moved;
    const samples = event.getCoalescedEvents?.();
    if (samples) for (const sample of samples) gesture.move(sample.clientX, sample.clientY);
    gesture.move(event.clientX, event.clientY);
    if (!gesture.moved) return;
    if (!wasMoved) {
      showOverlay();
      trail.start(origin.x, origin.y);
      document.documentElement.setPointerCapture(pointerId);
    }
    trail.add(event.clientX, event.clientY);
    showGestureLabel(gesture);
    if (event.cancelable) event.preventDefault();
  }

  function onPointerUp(event) {
    if (!event.isTrusted || !gesture || event.pointerId !== pointerId || event.button !== 2) return;
    // Include the release point even when the browser coalesced the final movement.
    gesture.move(event.clientX, event.clientY);
    const finished = gesture;
    gesture = undefined;
    stopTracking();
    releaseCapture();
    if (!finished.moved) { hide(); return; }
    suppressUntil = performance.now() + 500;
    event.preventDefault();
    const rule = !finished.invalid && settings.rules.find(item => item.gesture === finished.sequence);
    // 등록되지 않은 제스처는 실행 결과가 없으므로 안내를 남기지 않고 즉시 닫는다.
    if (!rule) { hide(); return; }
    showOverlay();
    trail.clear();
    showGestureLabel(finished);
    hideTimer = setTimeout(hide, 750);
    // 확장이 리로드·업데이트된 직후에는 이 탭의 컨텍스트가 무효화되어
    // sendMessage가 동기 예외를 던진다. 그대로 두면 페이지 콘솔에 Uncaught 오류가 남으므로
    // 새로고침 안내로 바꾼다.
    let request;
    try {
      request = chrome.runtime.sendMessage({ type: "glide:gesture", gesture: finished.sequence });
    } catch {
      showUnavailable();
      return;
    }
    request.then(response => {
      if (response?.ok || gesture || !overlay?.isConnected) return;
      showNotice(finished.sequence, response?.error || "실행할 수 없습니다.");
      clearTimeout(hideTimer);
      hideTimer = setTimeout(hide, 2000);
    }).catch(showUnavailable);
  }

  // 확장 컨텍스트가 무효화됐을 때(업데이트·리로드 직후) 보여 줄 안내.
  function showUnavailable() {
    if (gesture || !overlay?.isConnected) return;
    showNotice("", "확장이 업데이트되었습니다. 페이지를 새로고침해 주세요.");
    clearTimeout(hideTimer);
    hideTimer = setTimeout(hide, 2000);
  }

  function onKeyDown(event) {
    if (event.key === "Escape" && gesture) cancel();
  }

  function onLostCapture() {
    if (gesture) cancel();
  }

  function onPointerLeave(event) {
    if (gesture && !gesture.moved && !event.relatedTarget) cancel();
  }

  function onVisibilityChange() {
    if (document.hidden) cancel();
  }

  // contextmenu는 제스처 종료 후 500ms 동안 메뉴를 억제해야 하므로 상시 등록한다.
  window.addEventListener("contextmenu", event => {
    if (!event.isTrusted || event.button !== 2) return;
    // Some platforms emit contextmenu on press; Shift + right-click always bypasses gestures.
    if (gesture || performance.now() < suppressUntil) {
      event.preventDefault();
      event.stopImmediatePropagation();
    }
  }, true);

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
    // Home/End처럼 중간 애니메이션 없이 즉시 이동한다.
    target?.scrollTo({ top: message.edge === "scrollTop" ? 0 : target.scrollHeight,
      behavior: "instant" });
  });
})();
