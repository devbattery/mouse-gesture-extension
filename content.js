(() => {
  const { Gesture, Trail, arrows, ruleParts } = GestureKit;
  let settings;
  let gesture;
  let pointerId;
  let origin;
  // pointerdown 시점의 뷰포트 크기(CSS px). 히트 테스트 직후라 레이아웃이 깨끗해
  // 읽기 비용이 거의 없고, 제스처 중 창 크기가 바뀌면 resize로 취소되므로 계속 유효하다.
  let viewport;
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
      // contain:strict — 오버레이 내부의 그리기·라벨 변경이 페이지 레이아웃·페인트로
      // 번지지 않도록 격리한다(크기는 inset:0으로 뷰포트에 고정되어 있어 size 격리가 안전하다).
      overlay.style.cssText = "all:initial!important;position:fixed!important;inset:0!important;z-index:2147483647!important;pointer-events:none!important;display:block!important;contain:strict!important;";
      const shadow = overlay.attachShadow({ mode: "closed" });
      const style = document.createElement("style");
      // 라벨은 어떤 웹페이지 위에서도 읽히도록 항상 어두운 바탕을 쓴다.
      style.textContent = ":host{color-scheme:dark}" +
        "canvas{position:absolute;left:0;top:0;pointer-events:none}" +
        ".hud{position:absolute;bottom:40px;left:50%;transform:translateX(-50%);max-width:min(85%,560px);display:flex;align-items:center;gap:14px;padding:10px 20px 10px 12px;border:1px solid #ffffff24;border-radius:16px;background:#161520f0;color:#fff;box-shadow:0 10px 32px #0000003d;font:14px/1.4 'Segoe UI Variable Text','Segoe UI','Malgun Gothic','Apple SD Gothic Neo',system-ui,sans-serif;word-break:keep-all}" +
        ".seq{flex-shrink:0;padding:4px 10px;border-radius:10px;background:#ffffff1a;color:#c9c1ff;font-size:18px;font-weight:700;letter-spacing:3px;white-space:nowrap}" +
        ".text{display:flex;flex-direction:column;min-width:0}" +
        ".title{font-size:15px;font-weight:600}" +
        ".detail{font-size:12px;color:#b9b8c8}" +
        ".hud[data-tone=muted] .seq{background:#ffffff0f;color:#a3a2b4}" +
        ".hud[data-tone=muted] .title{font-weight:500;color:#d8d7e4}" +
        ".hud[data-tone=error] .title{color:#ffb3c1}" +
        ".detail:empty,.seq:empty{display:none}";
      const canvas = document.createElement("canvas");
      label = document.createElement("div");
      label.className = "hud";
      label.setAttribute("role", "status");
      shadow.append(style, canvas, label);
      trail = new Trail(canvas, "#6b5bf0");
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
  // tone: ok(실행될 동작) · muted(진행 중·미등록) · error(실패 안내)
  function renderLabel(state, sequence, title, detail = "", tone = "ok") {
    if (state === labelState) return;
    labelState = state;
    const pattern = document.createElement("span");
    pattern.className = "seq";
    pattern.textContent = arrows(sequence);
    const text = document.createElement("span");
    text.className = "text";
    const main = document.createElement("span");
    main.className = "title";
    main.textContent = title;
    const sub = document.createElement("span");
    sub.className = "detail";
    sub.textContent = detail;
    text.append(main, sub);
    label.dataset.tone = tone;
    label.replaceChildren(pattern, text);
  }

  // 현재 제스처 방향(시퀀스)에 대한 안내 문구는 방향이 바뀔 때만 계산한다.
  function showGestureLabel(current) {
    const state = `g:${current.sequence}:${current.invalid}`;
    if (state === labelState) return;
    if (current.invalid) {
      renderLabel(state, current.sequence, "너무 긴 제스처", "Esc로 취소", "error");
      return;
    }
    const rule = settings.rules.find(item => item.gesture === current.sequence);
    if (rule) {
      const { title, detail } = ruleParts(rule);
      renderLabel(state, current.sequence, title, detail);
      return;
    }
    // 아직 완성되지 않았지만 더 긴 규칙으로 이어질 수 있는 시퀀스는 진행 중으로 안내한다.
    const continuing = GestureKit.continuesGesture(current.sequence, settings.rules);
    renderLabel(state, current.sequence, continuing ? "계속 그리세요" : "등록되지 않은 제스처", "", "muted");
  }

  // 실행 실패·확장 업데이트 안내처럼 제스처 상태와 무관한 문구.
  function showNotice(sequence, text) {
    renderLabel(`n:${sequence}:${text}`, sequence, text, "", "error");
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
    viewport = { width: window.innerWidth, height: window.innerHeight };
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
      // 캔버스 CSS 크기를 미리 잰 뷰포트 크기로 직접 지정한다. 오버레이를 붙인 직후
      // getBoundingClientRect()로 재면 페이지 전체 강제 레이아웃이 일어나 무거운
      // 페이지에서 제스처 시작이 끊길 수 있다. 오버레이가 contain:strict로 잘라 내므로
      // 스크롤바 폭만큼 큰 부분은 보이지 않는다.
      const canvas = trail.canvas;
      canvas.style.width = `${viewport.width}px`;
      canvas.style.height = `${viewport.height}px`;
      trail.start(origin.x, origin.y, viewport);
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
