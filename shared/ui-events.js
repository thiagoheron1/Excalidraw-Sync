(function initializeUIEvents(globalScope) {
  "use strict";

  const EDITABLE_SELECTOR = [
    "input",
    "textarea",
    "select",
    "[contenteditable='true']",
    "[role='textbox']",
  ].join(",");
  const SAVE_WARNING_GRACE_SECONDS = 30;

  function isEditableEvent(event) {
    const path = typeof event.composedPath === "function" ? event.composedPath() : [event.target];
    return path.some(
      (target) =>
        target?.nodeType === 1 &&
        (target.matches?.(EDITABLE_SELECTOR) || target.isContentEditable),
    );
  }

  function protectEditableEvents(shadowRoot) {
    const stopAtExtensionBoundary = (event) => {
      if (isEditableEvent(event)) {
        event.stopPropagation();
      }
    };
    shadowRoot.addEventListener("keydown", stopAtExtensionBoundary);
    shadowRoot.addEventListener("keypress", stopAtExtensionBoundary);
    shadowRoot.addEventListener("keyup", stopAtExtensionBoundary);
    return () => {
      shadowRoot.removeEventListener("keydown", stopAtExtensionBoundary);
      shadowRoot.removeEventListener("keypress", stopAtExtensionBoundary);
      shadowRoot.removeEventListener("keyup", stopAtExtensionBoundary);
    };
  }

  function normalizeTheme(value) {
    return ["excalidraw", "system", "light", "dark"].includes(value) ? value : "excalidraw";
  }

  function excalidrawThemeFromClassName(className = "") {
    return String(className).split(/\s+/).includes("theme--dark") ? "dark" : "light";
  }

  function observeExcalidrawTheme({ documentRoot, MutationObserverCtor, onTheme }) {
    const readTheme = () => excalidrawThemeFromClassName(
      documentRoot.querySelector(".excalidraw")?.className,
    );
    const notify = () => onTheme(readTheme());
    const observer = new MutationObserverCtor((mutations) => {
      const themeMayHaveChanged = mutations.some((mutation) =>
        mutation.type === "attributes"
          ? mutation.target.matches?.(".excalidraw")
          : [...mutation.addedNodes].some((node) =>
            node.nodeType === 1
            && (node.matches?.(".excalidraw") || node.querySelector?.(".excalidraw")),
          ),
      );
      if (themeMayHaveChanged) notify();
    });
    observer.observe(documentRoot.documentElement, {
      attributes: true,
      attributeFilter: ["class"],
      childList: true,
      subtree: true,
    });
    notify();
    return () => observer.disconnect();
  }

  function sidebarViewForOpen() {
    return "files";
  }

  function shouldHighlightLauncher({ introduced = true, visible = true } = {}) {
    return visible && introduced === false;
  }

  function launcherPositionBesideSidebar(
    position,
    { open = false, sidebarWidth = 0, viewport, launcherSize, minimumTop = 70 } = {},
  ) {
    const constrained = clampLauncherPosition(position, viewport, launcherSize);
    if (!open || constrained.x >= Math.max(0, Number(sidebarWidth) || 0) + 8) {
      return { position: constrained, moved: false };
    }
    return {
      position: rightAnchoredLauncherPosition(
        { y: Math.max(minimumTop, constrained.y) },
        viewport,
        launcherSize,
      ),
      moved: true,
    };
  }

  function workspaceForRecovery({ recovery = null, stored = null, durable = null } = {}) {
    return recovery?.workspace || stored || durable || null;
  }

  function liveImageFileIds(elements = []) {
    return [...new Set(
      elements
        .filter((element) => element?.type === "image" && element.isDeleted !== true && element.fileId)
        .map((element) => element.fileId),
    )];
  }

  async function waitForEmbeddedFiles(
    fileIds,
    readFiles,
    { attempts = 12, delayMs = 150, wait = (ms) => new Promise((resolve) => globalScope.setTimeout(resolve, ms)) } = {},
  ) {
    const expectedIds = [...new Set((fileIds || []).filter(Boolean))];
    if (!expectedIds.length) return {};
    let files = {};
    let missingIds = expectedIds;
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      files = await readFiles(expectedIds);
      missingIds = expectedIds.filter((id) => {
        const dataURL = files?.[id]?.dataURL;
        return typeof dataURL !== "string" || !dataURL.startsWith("data:");
      });
      if (!missingIds.length) return files;
      if (attempt < attempts - 1) await wait(delayMs);
    }
    throw new Error(`Excalidraw is still saving ${missingIds.length} embedded image${missingIds.length === 1 ? "" : "s"}. Please try again.`);
  }

  function sceneStorageFingerprint(elements = []) {
    return JSON.stringify(
      (Array.isArray(elements) ? elements : [])
        .filter((element) => element?.isDeleted !== true && element?.id)
        .map((element) => [element.id, element.type || "", element.fileId || ""]),
    );
  }

  async function waitForImportedScene(
    elements,
    readStoredElements,
    { attempts = 150, delayMs = 100, wait = (ms) => new Promise((resolve) => globalScope.setTimeout(resolve, ms)) } = {},
  ) {
    const expected = sceneStorageFingerprint(elements);
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      let stored = [];
      try {
        stored = JSON.parse((await readStoredElements()) || "[]");
      } catch (_error) {
        stored = [];
      }
      if (sceneStorageFingerprint(stored) === expected) return stored;
      if (attempt < attempts - 1) await wait(delayMs);
    }
    throw new Error("Excalidraw did not finish importing the drawing in time.");
  }

  function normalizeSaveSettings(value = {}) {
    const mode = ["edit", "interval", "manual"].includes(value.mode) ? value.mode : "edit";
    const intervalSeconds = [5, 15, 30, 60, 300].includes(Number(value.intervalSeconds))
      ? Number(value.intervalSeconds)
      : 30;
    const syncDelaySeconds = [30, 60, 300].includes(Number(value.syncDelaySeconds))
      ? Number(value.syncDelaySeconds)
      : 30;
    const staleMinutes = [1, 5, 10, 30].includes(Number(value.staleMinutes))
      ? Number(value.staleMinutes)
      : 5;
    return {
      mode,
      intervalSeconds,
      syncDelaySeconds,
      staleMinutes,
      notificationsEnabled: value.notificationsEnabled !== false,
    };
  }

  function warningDelayMs(kind, mode, intervalSeconds, graceSeconds) {
    const saveDelaySeconds = kind === "unsaved" && mode === "interval"
      ? Math.max(0, Number(intervalSeconds) || 0)
      : 0;
    return (saveDelaySeconds + Math.max(0, Number(graceSeconds) || 0)) * 1000;
  }

  function healthAfterExpectedWindow({ kind, ageMs, mode, intervalSeconds, graceSeconds, staleMinutes }) {
    const warningAfterMs = warningDelayMs(kind, mode, intervalSeconds, graceSeconds);
    if (ageMs <= warningAfterMs) {
      return { level: "ok", kind: null, ageMs };
    }
    return {
      level: ageMs >= warningAfterMs + staleMinutes * 60_000 ? "stale" : "pending",
      kind,
      ageMs,
    };
  }

  function getSaveHealth({
    dirtySince,
    unsyncedSince,
    mode = "edit",
    intervalSeconds = 30,
    graceSeconds = SAVE_WARNING_GRACE_SECONDS,
    staleMinutes = 5,
    now = Date.now(),
  } = {}) {
    const candidates = [
      dirtySince ? { kind: "unsaved", since: new Date(dirtySince).getTime() } : null,
      unsyncedSince ? { kind: "unsynced", since: new Date(unsyncedSince).getTime() } : null,
    ].filter((item) => item && Number.isFinite(item.since));
    if (!candidates.length) {
      return { level: "ok", kind: null, ageMs: 0 };
    }
    const oldest = candidates.sort((left, right) => left.since - right.since)[0];
    const ageMs = Math.max(0, now - oldest.since);
    return healthAfterExpectedWindow({
      kind: oldest.kind,
      ageMs,
      mode,
      intervalSeconds,
      graceSeconds,
      staleMinutes,
    });
  }

  function getFileSyncHealth({
    updatedAt,
    syncedAt,
    dirtySince,
    active = false,
    connected = false,
    mode = "edit",
    intervalSeconds = 30,
    graceSeconds = SAVE_WARNING_GRACE_SECONDS,
    staleMinutes = 5,
    now = Date.now(),
  } = {}) {
    if (!connected) {
      return { level: "ok", kind: null, ageMs: 0 };
    }
    const updatedTime = new Date(updatedAt || 0).getTime();
    const syncedTime = new Date(syncedAt || 0).getTime();
    const dirtyTime = active ? new Date(dirtySince || 0).getTime() : 0;
    const pendingSince = Number.isFinite(dirtyTime) && dirtyTime > 0
      ? dirtyTime
      : Number.isFinite(updatedTime) && updatedTime > syncedTime
        ? updatedTime
        : 0;
    if (!pendingSince) {
      return { level: "ok", kind: null, ageMs: 0 };
    }
    const ageMs = Math.max(0, now - pendingSince);
    return healthAfterExpectedWindow({
      kind: dirtyTime ? "unsaved" : "unsynced",
      ageMs,
      mode,
      intervalSeconds,
      graceSeconds,
      staleMinutes,
    });
  }

  function isExtensionContextInvalidated(error) {
    return /extension context invalidated|could not reach the updated background service/i.test(String(error?.message || error || ""));
  }

  function isSaveShortcut(event = {}) {
    return String(event.key || "").toLowerCase() === "s" && Boolean(event.metaKey || event.ctrlKey) && !event.altKey;
  }

  function folderDropMode(clientY, rect = {}) {
    const top = Number(rect.top) || 0;
    const height = Math.max(1, Number(rect.height) || 1);
    const position = (Number(clientY) - top) / height;
    if (position < 0.25) return "before";
    if (position > 0.75) return "after";
    return "inside";
  }

  function excalidrawControlsOffset({ open = false, railHidden = false } = {}) {
    if (open) return "min(392px, 94vw)";
    return railHidden ? "0px" : "44px";
  }

  async function runWithInvalidationRecovery(action, recover) {
    try {
      return await action();
    } catch (error) {
      if (!isExtensionContextInvalidated(error)) {
        throw error;
      }
      await recover(error);
      return undefined;
    }
  }

  function clampLauncherPosition(position, viewport, launcherSize, margin = 8) {
    const width = Number.isFinite(viewport?.width) ? viewport.width : 0;
    const height = Number.isFinite(viewport?.height) ? viewport.height : 0;
    const launcherWidth = Number.isFinite(launcherSize?.width) ? launcherSize.width : 0;
    const launcherHeight = Number.isFinite(launcherSize?.height) ? launcherSize.height : 0;
    const x = Number.isFinite(position?.x) ? position.x : margin;
    const y = Number.isFinite(position?.y) ? position.y : margin;
    const maximumX = Math.max(margin, width - launcherWidth - margin);
    const maximumY = Math.max(margin, height - launcherHeight - margin);
    return {
      x: Math.round(Math.min(maximumX, Math.max(margin, x))),
      y: Math.round(Math.min(maximumY, Math.max(margin, y))),
    };
  }

  function rightAnchoredLauncherPosition(position, viewport, launcherSize, inset = 12) {
    return clampLauncherPosition(
      {
        x: (Number(viewport?.width) || 0) - (Number(launcherSize?.width) || 0) - inset,
        y: Number.isFinite(position?.y) ? position.y : 70,
      },
      viewport,
      launcherSize,
    );
  }

  function focusAndSelectFormField(form, fieldName = "") {
    const requested = fieldName ? form?.elements?.namedItem?.(fieldName) : null;
    const field = requested || form?.querySelector?.("input, select, button");
    field?.focus?.();
    field?.select?.();
    return field || null;
  }

  async function copyTextToClipboard(text, {
    navigatorRef = globalScope.navigator,
    documentRef = globalScope.document,
  } = {}) {
    try {
      if (navigatorRef?.clipboard?.writeText) {
        await navigatorRef.clipboard.writeText(text);
        return;
      }
    } catch (_error) {
      // Extension clipboard permission plus the selection fallback covers browsers
      // that revoke transient user activation while Excalidraw creates the link.
    }
    if (!documentRef?.body || typeof documentRef.execCommand !== "function") {
      throw new Error("The browser blocked clipboard access. Copy the link from Excalidraw's share dialog.");
    }
    const textarea = documentRef.createElement("textarea");
    textarea.value = text;
    textarea.setAttribute("readonly", "");
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    documentRef.body.append(textarea);
    textarea.focus();
    textarea.select();
    const copied = documentRef.execCommand("copy");
    textarea.remove();
    if (!copied) {
      throw new Error("The browser blocked clipboard access. Copy the link from Excalidraw's share dialog.");
    }
  }

  function requireActionResult(result, requiredFields = [], action = "This action") {
    const valid = result && typeof result === "object"
      && requiredFields.every((field) => result[field] !== null && result[field] !== undefined);
    if (!valid) {
      throw new Error(`${action} could not reach the updated background service. Reload the extension and refresh Excalidraw, then try again.`);
    }
    return result;
  }

  function positionLauncherElement(element, position) {
    element.style.right = "auto";
    element.style.bottom = "auto";
    element.style.left = `${position.x}px`;
    element.style.top = `${position.y}px`;
    return position;
  }

  function attachDraggableLauncher(element, options) {
    const dragThreshold = options.dragThreshold ?? 6;
    const keyboardStep = options.keyboardStep ?? 12;
    let gesture = null;
    let suppressNextClick = false;

    const currentSize = () => options.getSize();
    const constrain = (position) =>
      clampLauncherPosition(position, options.getViewport(), currentSize(), options.margin);

    function move(position) {
      return options.onMove(constrain(position));
    }

    function finishGesture(event, cancelled = false) {
      if (!gesture || (event.pointerId != null && event.pointerId !== gesture.pointerId)) {
        return;
      }
      const completed = gesture;
      gesture = null;
      element.classList.remove("is-dragging");
      try {
        if (event.pointerId != null && element.hasPointerCapture?.(event.pointerId)) {
          element.releasePointerCapture(event.pointerId);
        }
      } catch (_error) {
        // Losing pointer capture during a window change is safe to ignore.
      }
      if (completed.moved) {
        suppressNextClick = !cancelled;
        if (suppressNextClick) {
          globalScope.setTimeout(() => {
            suppressNextClick = false;
          }, 0);
        }
        options.onCommit(completed.position);
        event.preventDefault();
      }
    }

    function onPointerDown(event) {
      if (event.isPrimary === false || (event.button != null && event.button !== 0)) {
        return;
      }
      const position = options.getPosition();
      gesture = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        originX: position.x,
        originY: position.y,
        position,
        moved: false,
      };
      try {
        if (event.pointerId != null) {
          element.setPointerCapture?.(event.pointerId);
        }
      } catch (_error) {
        // Dragging still works when pointer capture is unavailable.
      }
    }

    function onPointerMove(event) {
      if (!gesture || (event.pointerId != null && event.pointerId !== gesture.pointerId)) {
        return;
      }
      const deltaX = event.clientX - gesture.startX;
      const deltaY = event.clientY - gesture.startY;
      if (!gesture.moved && Math.hypot(deltaX, deltaY) < dragThreshold) {
        return;
      }
      gesture.moved = true;
      element.classList.add("is-dragging");
      gesture.position = move({
        x: gesture.originX + deltaX,
        y: gesture.originY + deltaY,
      });
      event.preventDefault();
    }

    function onClick(event) {
      if (suppressNextClick) {
        suppressNextClick = false;
        event.preventDefault();
        event.stopImmediatePropagation();
        return;
      }
      options.onActivate();
    }

    function onPointerCancel(event) {
      finishGesture(event, true);
    }

    function onKeyDown(event) {
      if (!event.altKey || !["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) {
        return;
      }
      const delta = {
        ArrowLeft: [-keyboardStep, 0],
        ArrowRight: [keyboardStep, 0],
        ArrowUp: [0, -keyboardStep],
        ArrowDown: [0, keyboardStep],
      }[event.key];
      const position = options.getPosition();
      const next = move({ x: position.x + delta[0], y: position.y + delta[1] });
      options.onCommit(next);
      event.preventDefault();
      event.stopPropagation();
    }

    element.addEventListener("pointerdown", onPointerDown);
    element.addEventListener("pointermove", onPointerMove);
    element.addEventListener("pointerup", finishGesture);
    element.addEventListener("pointercancel", onPointerCancel);
    element.addEventListener("click", onClick);
    element.addEventListener("keydown", onKeyDown);

    return {
      constrain,
      destroy() {
        element.removeEventListener("pointerdown", onPointerDown);
        element.removeEventListener("pointermove", onPointerMove);
        element.removeEventListener("pointerup", finishGesture);
        element.removeEventListener("pointercancel", onPointerCancel);
        element.removeEventListener("click", onClick);
        element.removeEventListener("keydown", onKeyDown);
      },
    };
  }

  const api = {
    SAVE_WARNING_GRACE_SECONDS,
    attachDraggableLauncher,
    clampLauncherPosition,
    copyTextToClipboard,
    excalidrawControlsOffset,
    excalidrawThemeFromClassName,
    folderDropMode,
    focusAndSelectFormField,
    getFileSyncHealth,
    getSaveHealth,
    isExtensionContextInvalidated,
    isSaveShortcut,
    isEditableEvent,
    launcherPositionBesideSidebar,
    liveImageFileIds,
    normalizeSaveSettings,
    normalizeTheme,
    observeExcalidrawTheme,
    positionLauncherElement,
    requireActionResult,
    rightAnchoredLauncherPosition,
    protectEditableEvents,
    runWithInvalidationRecovery,
    shouldHighlightLauncher,
    sidebarViewForOpen,
    sceneStorageFingerprint,
    workspaceForRecovery,
    waitForEmbeddedFiles,
    waitForImportedScene,
  };
  globalScope.ExcalidrawSyncUIEvents = api;
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this);
