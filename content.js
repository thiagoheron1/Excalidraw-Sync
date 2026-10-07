/* global ExcalidrawSyncCore */
(function initializeExcalidrawSync() {
  "use strict";

  if (globalThis.__excalidrawSyncLoaded) {
    return;
  }
  globalThis.__excalidrawSyncLoaded = true;

  const extensionApi = globalThis.browser || globalThis.chrome;
  const usesPromiseApi = typeof globalThis.browser !== "undefined";
  const WORKSPACE_KEY = "excalidrawSync.workspace";
  const FILES_DB = "files-db";
  const FILES_STORE = "files-store";
  const AUTOSAVE_INTERVAL_MS = 1000;
  const CLOUD_SYNC_DELAY_MS = 1800;
  const rootHost = document.createElement("div");
  rootHost.id = "excalidraw-sync-root";
  document.documentElement.append(rootHost);
  const shadow = rootHost.attachShadow({ mode: "open" });

  const state = {
    workspace: null,
    providers: null,
    open: false,
    view: "files",
    query: "",
    collapsedFolders: new Set(),
    status: "Saved locally",
    busy: false,
    lastBrowserFingerprint: "",
    syncTimer: null,
    githubPollTimer: null,
  };

  function apiCall(target, method, ...args) {
    if (usesPromiseApi) {
      return target[method](...args);
    }
    return new Promise((resolve, reject) => {
      target[method](...args, (result) => {
        const error = extensionApi.runtime.lastError;
        if (error) {
          reject(new Error(error.message));
        } else {
          resolve(result);
        }
      });
    });
  }

  async function storageGet(key) {
    const result = await apiCall(extensionApi.storage.local, "get", key);
    return result?.[key];
  }

  async function storageSet(key, value) {
    await apiCall(extensionApi.storage.local, "set", { [key]: value });
  }

  async function sendMessage(message) {
    const response = await apiCall(extensionApi.runtime, "sendMessage", message);
    if (!response?.ok) {
      throw new Error(response?.error || "The extension could not complete that action.");
    }
    return response.data;
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function icon(name, size = 20) {
    const paths = {
      logo: '<path d="M4 4h6l2 2h8v12H4z"/><path d="m7 12 2.2 2.2L16 8.5"/>',
      menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
      close: '<path d="m6 6 12 12M18 6 6 18"/>',
      search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/>',
      file: '<path d="M6 3h8l4 4v14H6z"/><path d="M14 3v5h5M9 13h6M9 17h4"/>',
      folder: '<path d="M3 6h7l2 2h9v11H3z"/>',
      plus: '<path d="M12 5v14M5 12h14"/>',
      settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-2.8 2.8-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6v.2h-4V21a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1L4.2 17l.1-.1a1.7 1.7 0 0 0 .3-1.9A1.7 1.7 0 0 0 3 14H3v-4h.1a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9L4.2 7 7 4.2l.1.1A1.7 1.7 0 0 0 9 4.6a1.7 1.7 0 0 0 1-1.6V3h4v.1a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.9-.3l.1-.1L19.8 7l-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.6 1h.1v4H21a1.7 1.7 0 0 0-1.6 1Z"/>',
      pin: '<path d="m14 4 6 6-3 1-4 4-1 5-8-8 5-1 4-4z"/><path d="m8 16-5 5"/>',
      trash: '<path d="M4 7h16M9 7V4h6v3M7 7l1 14h8l1-14M10 11v6M14 11v6"/>',
      edit: '<path d="M4 20h4L19 9l-4-4L4 16zM13.5 6.5l4 4"/>',
      chevron: '<path d="m8 10 4 4 4-4"/>',
      cloud: '<path d="M6.5 19a4.5 4.5 0 0 1-.4-9A6 6 0 0 1 17.6 8 5.5 5.5 0 0 1 18 19Z"/><path d="m9 14 3-3 3 3M12 11v7"/>',
      import: '<path d="M5 4h9l5 5v11H5zM14 4v5h5"/><path d="M12 12v6M9 15l3 3 3-3"/>',
      check: '<path d="m5 12 4 4L19 6"/>',
      external: '<path d="M14 4h6v6M20 4l-9 9"/><path d="M18 13v7H4V6h7"/>',
      back: '<path d="m15 18-6-6 6-6"/>',
      more: '<circle cx="5" cy="12" r="1" fill="currentColor"/><circle cx="12" cy="12" r="1" fill="currentColor"/><circle cx="19" cy="12" r="1" fill="currentColor"/>',
    };
    return `<svg aria-hidden="true" viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${paths[name] || ""}</svg>`;
  }

  const styles = `
    :host { all: initial; }
    *, *::before, *::after { box-sizing: border-box; }
    button, input, select { font: inherit; }
    button { color: inherit; }
    .launcher {
      position: fixed; left: 12px; top: 76px; z-index: 2147483000;
      width: 46px; height: 46px; border: 1px solid rgba(121,113,234,.45);
      border-radius: 13px; background: #6965db; color: #fff; display: grid;
      place-items: center; cursor: pointer; box-shadow: 0 8px 26px rgba(30,27,75,.28);
      transition: transform .18s ease, background .18s ease, opacity .18s ease;
    }
    .launcher:hover { transform: translateY(-1px); background: #5b57cf; }
    .launcher:focus-visible, .panel button:focus-visible, .panel input:focus-visible,
    .panel select:focus-visible, .dialog button:focus-visible, .dialog input:focus-visible,
    .dialog select:focus-visible { outline: 3px solid #a5b4fc; outline-offset: 2px; }
    .launcher.is-hidden { opacity: 0; pointer-events: none; }
    .backdrop { position: fixed; inset: 0; z-index: 2147482997; background: rgba(5,5,8,.34); opacity: 0; pointer-events: none; transition: opacity .2s ease; }
    .backdrop.open { opacity: 1; pointer-events: auto; }
    .panel {
      --bg: #111113; --surface: #1c1c1f; --surface-2: #26262b; --border: #35353e;
      --text: #f4f4f5; --muted: #a1a1aa; --accent: #8b87f7; --danger: #fb7185;
      position: fixed; inset: 0 auto 0 0; z-index: 2147482998; width: min(370px, 92vw);
      transform: translateX(-102%); transition: transform .23s cubic-bezier(.2,.7,.2,1);
      background: var(--bg); color: var(--text); border-right: 1px solid var(--border);
      box-shadow: 18px 0 44px rgba(0,0,0,.28); display: flex; flex-direction: column;
      font-family: ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      font-size: 15px; line-height: 1.4; color-scheme: dark;
    }
    .panel.open { transform: translateX(0); }
    .panel-header { display: flex; align-items: center; gap: 11px; padding: 18px 18px 14px; }
    .brand-mark { width: 34px; height: 34px; border-radius: 10px; display: grid; place-items: center; color: white; background: #6965db; }
    .brand { min-width: 0; flex: 1; }
    .brand strong { display: block; font-size: 18px; letter-spacing: -.02em; }
    .brand span { display: block; color: var(--muted); font-size: 12px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .icon-button { border: 0; background: transparent; border-radius: 9px; width: 36px; height: 36px; display: inline-grid; place-items: center; cursor: pointer; }
    .icon-button:hover { background: var(--surface-2); }
    .panel-body { flex: 1; overflow: auto; padding: 0 14px 22px; scrollbar-width: thin; }
    .search-wrap { position: relative; margin: 6px 4px 14px; }
    .search-wrap svg { position: absolute; left: 12px; top: 11px; color: var(--muted); }
    .search { width: 100%; height: 42px; border: 1px solid var(--border); border-radius: 11px; background: var(--surface); color: var(--text); padding: 0 12px 0 40px; }
    .search::placeholder { color: #797983; }
    .quick-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin: 0 4px 15px; }
    .quick-action { min-height: 42px; border: 1px solid var(--border); border-radius: 10px; background: var(--surface); display: flex; align-items: center; gap: 9px; padding: 0 11px; cursor: pointer; text-align: left; }
    .quick-action:hover { border-color: #5a5878; background: var(--surface-2); }
    .sync-row { display: flex; align-items: center; gap: 8px; margin: 0 4px 15px; padding: 10px 11px; border-radius: 10px; background: rgba(105,101,219,.12); color: #d9d8ff; }
    .sync-row span { flex: 1; font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .sync-row button { border: 0; background: transparent; color: #c8c7ff; cursor: pointer; padding: 4px; border-radius: 6px; }
    .section { border-top: 1px solid var(--border); padding-top: 13px; margin-top: 7px; }
    .section-title { color: var(--muted); font-size: 12px; font-weight: 700; letter-spacing: .08em; text-transform: uppercase; display: flex; align-items: center; gap: 7px; padding: 7px 9px; }
    .folder { margin: 5px 0 10px; }
    .folder-head { display: flex; align-items: center; gap: 7px; min-height: 38px; border-radius: 9px; padding: 0 5px 0 3px; }
    .folder-head:hover { background: rgba(255,255,255,.035); }
    .folder-toggle { border: 0; background: transparent; flex: 1; min-width: 0; display: flex; align-items: center; gap: 8px; text-align: left; font-weight: 650; cursor: pointer; padding: 8px 4px; }
    .folder-toggle span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .folder-toggle .chevron { transition: transform .16s ease; }
    .folder.collapsed .chevron { transform: rotate(-90deg); }
    .folder.collapsed .folder-files { display: none; }
    .row-actions { display: flex; align-items: center; gap: 1px; }
    .row-action { width: 30px; height: 30px; border: 0; border-radius: 7px; background: transparent; color: var(--muted); display: grid; place-items: center; cursor: pointer; }
    .row-action:hover { background: var(--surface-2); color: var(--text); }
    .row-action.delete:hover { color: var(--danger); background: rgba(251,113,133,.12); }
    .file-row { position: relative; display: flex; align-items: center; gap: 7px; min-height: 43px; margin: 3px 0 3px 15px; border: 1px solid transparent; border-radius: 9px; padding: 0 5px 0 10px; touch-action: pan-y; transition: transform .14s ease, background .14s ease; }
    .file-row:hover { background: var(--surface); }
    .file-row.active { border-color: #8b87f7; background: rgba(105,101,219,.15); box-shadow: inset 3px 0 #8b87f7; }
    .file-main { border: 0; background: transparent; flex: 1; min-width: 0; display: flex; align-items: center; gap: 9px; text-align: left; cursor: pointer; padding: 9px 0; }
    .file-main .file-copy { min-width: 0; }
    .file-main strong { display: block; font-weight: 520; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .file-main small { display: block; margin-top: 1px; color: var(--muted); font-size: 11px; }
    .file-main svg { flex: 0 0 auto; color: #a9a6ff; }
    .pinned { margin: 2px 0 13px; }
    .empty { color: var(--muted); padding: 14px 11px 20px; font-size: 13px; }
    .panel-footer { flex: 0 0 auto; border-top: 1px solid var(--border); padding: 10px 14px 12px; color: var(--muted); font-size: 11px; display: flex; align-items: center; gap: 8px; }
    .panel-footer .dot { width: 7px; height: 7px; border-radius: 50%; background: #34d399; }
    .panel-footer.busy .dot { background: #fbbf24; animation: pulse 1s infinite; }
    @keyframes pulse { 50% { opacity: .35; } }
    .manage-title { display: flex; align-items: center; gap: 8px; padding: 4px 3px 12px; }
    .manage-title h2 { font-size: 18px; margin: 0; flex: 1; }
    .card { background: var(--surface); border: 1px solid var(--border); border-radius: 13px; padding: 14px; margin: 0 0 12px; }
    .card-head { display: flex; align-items: center; gap: 9px; margin-bottom: 12px; }
    .card-head strong { flex: 1; font-size: 15px; }
    .badge { border-radius: 99px; padding: 3px 7px; background: #303037; color: var(--muted); font-size: 10px; text-transform: uppercase; letter-spacing: .05em; }
    .badge.connected { background: rgba(52,211,153,.13); color: #6ee7b7; }
    .field { display: block; margin: 10px 0; }
    .field > span { display: block; color: #d4d4d8; font-size: 12px; margin-bottom: 5px; }
    .field input, .field select { width: 100%; height: 39px; border: 1px solid var(--border); border-radius: 8px; background: #111113; color: var(--text); padding: 0 10px; }
    .field-help { color: var(--muted); font-size: 11px; margin: -3px 0 10px; }
    .button-row { display: flex; gap: 7px; flex-wrap: wrap; margin-top: 12px; }
    .button { min-height: 36px; border: 1px solid var(--border); background: var(--surface-2); border-radius: 8px; padding: 0 12px; cursor: pointer; }
    .button:hover { border-color: #5a5878; }
    .button.primary { background: #6965db; border-color: #7772ec; color: white; }
    .button.danger { color: #fda4af; }
    .button:disabled { opacity: .55; cursor: wait; }
    .provider-status { font-size: 11px; color: var(--muted); margin-top: 9px; overflow-wrap: anywhere; }
    .provider-status.error { color: #fda4af; }
    .device-code { margin: 10px 0; padding: 12px; border: 1px dashed #5f5b9f; border-radius: 9px; text-align: center; background: rgba(105,101,219,.1); }
    .device-code strong { display: block; font-size: 24px; letter-spacing: .12em; color: #dedcff; }
    .text-link { color: #b8b5ff; text-decoration: none; }
    .text-link:hover { text-decoration: underline; }
    .dialog-layer { position: fixed; inset: 0; z-index: 2147483001; display: grid; place-items: center; padding: 20px; background: rgba(0,0,0,.58); font-family: ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; color: #f4f4f5; }
    .dialog { width: min(390px, 94vw); border: 1px solid #3f3f49; border-radius: 15px; background: #171719; padding: 19px; box-shadow: 0 22px 75px rgba(0,0,0,.55); color-scheme: dark; }
    .dialog h2 { margin: 0 0 7px; font-size: 19px; }
    .dialog p { color: #b6b6bf; margin: 0 0 14px; font-size: 14px; }
    .dialog .field input, .dialog .field select { background: #0f0f11; }
    .dialog-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 18px; }
    .toast { position: fixed; left: 50%; bottom: 24px; z-index: 2147483002; transform: translate(-50%, 18px); opacity: 0; max-width: min(430px, 88vw); border: 1px solid #454550; border-radius: 10px; background: #1f1f23; color: #fff; padding: 10px 14px; box-shadow: 0 12px 34px rgba(0,0,0,.35); font: 13px/1.4 ui-sans-serif, -apple-system, sans-serif; transition: opacity .18s ease, transform .18s ease; }
    .toast.show { opacity: 1; transform: translate(-50%, 0); }
    .toast.error { border-color: #9f4353; }
    @media (max-width: 600px) {
      .launcher { left: 8px; top: 70px; width: 42px; height: 42px; }
      .panel { width: min(350px, 94vw); }
      .row-action { width: 34px; height: 34px; }
    }
    @media (prefers-reduced-motion: reduce) { *, *::before, *::after { transition: none !important; animation: none !important; } }
  `;

  function replaceMarkup(target, markup) {
    const parsed = new DOMParser().parseFromString(`<body>${markup}</body>`, "text/html");
    const fragment = document.createDocumentFragment();
    for (const child of [...parsed.body.childNodes]) {
      fragment.append(document.importNode(child, true));
    }
    target.replaceChildren(fragment);
  }

  replaceMarkup(shadow, `
    <button class="launcher" type="button" aria-label="Open Excalidraw Sync">${icon("logo", 25)}</button>
    <div class="backdrop" aria-hidden="true"></div>
    <aside class="panel" aria-label="Excalidraw Sync sidebar" aria-hidden="true">
      <header class="panel-header"></header>
      <main class="panel-body"></main>
      <footer class="panel-footer"><span class="dot"></span><span class="footer-status">Saved locally</span></footer>
    </aside>
    <div class="modal-root"></div>
    <div class="toast" role="status" aria-live="polite"></div>
    <input class="file-picker" type="file" accept=".excalidraw,application/json" multiple hidden>
  `);
  const styleElement = document.createElement("style");
  styleElement.textContent = styles;
  shadow.prepend(styleElement);

  const elements = {
    launcher: shadow.querySelector(".launcher"),
    backdrop: shadow.querySelector(".backdrop"),
    panel: shadow.querySelector(".panel"),
    header: shadow.querySelector(".panel-header"),
    body: shadow.querySelector(".panel-body"),
    footer: shadow.querySelector(".panel-footer"),
    footerStatus: shadow.querySelector(".footer-status"),
    modalRoot: shadow.querySelector(".modal-root"),
    toast: shadow.querySelector(".toast"),
    filePicker: shadow.querySelector(".file-picker"),
  };

  function showToast(message, type = "info") {
    elements.toast.textContent = message;
    elements.toast.className = `toast ${type === "error" ? "error" : ""} show`;
    clearTimeout(showToast.timer);
    showToast.timer = setTimeout(() => {
      elements.toast.classList.remove("show");
    }, 3500);
  }

  function setBusy(busy, status = null) {
    state.busy = busy;
    if (status) {
      state.status = status;
    }
    elements.footer.classList.toggle("busy", busy);
    elements.footerStatus.textContent = state.status;
  }

  function setOpen(open) {
    state.open = open;
    elements.panel.classList.toggle("open", open);
    elements.backdrop.classList.toggle("open", open);
    elements.launcher.classList.toggle("is-hidden", open);
    elements.panel.setAttribute("aria-hidden", String(!open));
    if (open) {
      render();
      requestAnimationFrame(() => elements.panel.querySelector("button, input")?.focus());
    }
  }

  function browserFingerprint() {
    return [
      localStorage.getItem("version-dataState") || "",
      localStorage.getItem("version-files") || "",
      localStorage.getItem("excalidraw") || "[]",
      localStorage.getItem("excalidraw-state") || "{}",
    ].join("|");
  }

  function openFilesDatabase() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(FILES_DB, 1);
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains(FILES_STORE)) {
          request.result.createObjectStore(FILES_STORE);
        }
      };
      request.onerror = () => reject(request.error || new Error("Could not open Excalidraw image storage."));
      request.onsuccess = () => resolve(request.result);
    });
  }

  async function readSceneFiles(fileIds) {
    if (!fileIds.length) {
      return {};
    }
    const database = await openFilesDatabase();
    if (!database.objectStoreNames.contains(FILES_STORE)) {
      database.close();
      return {};
    }
    try {
      const transaction = database.transaction(FILES_STORE, "readonly");
      const store = transaction.objectStore(FILES_STORE);
      const results = await Promise.all(
        fileIds.map(
          (id) =>
            new Promise((resolve) => {
              const request = store.get(id);
              request.onsuccess = () => resolve(request.result || null);
              request.onerror = () => resolve(null);
            }),
        ),
      );
      return results.reduce((files, file, index) => {
        if (file) {
          const { lastRetrieved: _lastRetrieved, ...stableFile } = file;
          files[fileIds[index]] = stableFile;
        }
        return files;
      }, {});
    } finally {
      database.close();
    }
  }

  async function writeSceneFiles(files) {
    const entries = Object.entries(files || {});
    if (!entries.length) {
      return;
    }
    const database = await openFilesDatabase();
    if (!database.objectStoreNames.contains(FILES_STORE)) {
      database.close();
      throw new Error("Excalidraw image storage is not available yet.");
    }
    try {
      await new Promise((resolve, reject) => {
        const transaction = database.transaction(FILES_STORE, "readwrite");
        const store = transaction.objectStore(FILES_STORE);
        for (const [id, file] of entries) {
          store.put({ ...file, id: file.id || id, lastRetrieved: Date.now() }, id);
        }
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error || new Error("Could not restore embedded images."));
        transaction.onabort = () => reject(transaction.error || new Error("Could not restore embedded images."));
      });
    } finally {
      database.close();
    }
  }

  async function captureScene() {
    let elementsValue;
    let appStateValue;
    try {
      elementsValue = JSON.parse(localStorage.getItem("excalidraw") || "[]");
      appStateValue = JSON.parse(localStorage.getItem("excalidraw-state") || "{}");
    } catch (_error) {
      throw new Error("Excalidraw has not finished saving this drawing yet.");
    }
    const fileIds = [...new Set(elementsValue.map((item) => item?.fileId).filter(Boolean))];
    const files = await readSceneFiles(fileIds);
    return ExcalidrawSyncCore.normalizeScene({
      type: "excalidraw",
      version: 2,
      source: "https://excalidraw.com",
      elements: elementsValue,
      appState: appStateValue,
      files,
    });
  }

  async function applyScene(sceneInput) {
    const scene = ExcalidrawSyncCore.normalizeScene(sceneInput);
    await writeSceneFiles(scene.files);
    localStorage.setItem("excalidraw", JSON.stringify(scene.elements));
    localStorage.setItem("excalidraw-state", JSON.stringify(scene.appState));
    const version = JSON.stringify(Date.now());
    localStorage.setItem("version-dataState", version);
    localStorage.setItem("version-files", version);
  }

  async function persistWorkspace({ sync = true } = {}) {
    state.workspace.updatedAt = ExcalidrawSyncCore.nowIso();
    await storageSet(WORKSPACE_KEY, state.workspace);
    if (sync) {
      scheduleCloudSync();
    }
  }

  async function captureAndSaveActive({ sync = true, force = false } = {}) {
    const file = state.workspace?.files.find((item) => item.id === state.workspace.activeFileId);
    if (!file) {
      return false;
    }
    const scene = await captureScene();
    const hash = ExcalidrawSyncCore.hashScene(scene);
    if (!force && hash === file.hash) {
      return false;
    }
    file.scene = scene;
    file.hash = hash;
    file.updatedAt = ExcalidrawSyncCore.nowIso();
    await persistWorkspace({ sync });
    state.status = "Saved locally";
    elements.footerStatus.textContent = state.status;
    return true;
  }

  function scheduleCloudSync() {
    clearTimeout(state.syncTimer);
    const connected = state.providers?.github?.connected || state.providers?.googleDrive?.connected;
    if (!connected) {
      return;
    }
    state.syncTimer = setTimeout(() => syncNow({ quiet: true }), CLOUD_SYNC_DELAY_MS);
  }

  async function syncNow({ quiet = false } = {}) {
    if (state.busy) {
      return;
    }
    setBusy(true, "Syncing…");
    try {
      await captureAndSaveActive({ sync: false });
      const result = await sendMessage({ type: "sync:workspace", workspace: state.workspace });
      state.providers = result.providers;
      const errors = [result.result.github?.error, result.result.googleDrive?.error].filter(Boolean);
      if (errors.length) {
        throw new Error(errors.join(" "));
      }
      state.status = "Synced";
      if (!quiet) {
        showToast("Your drawings are up to date.");
      }
    } catch (error) {
      state.status = "Sync needs attention";
      if (!quiet) {
        showToast(error.message, "error");
      }
    } finally {
      setBusy(false, state.status);
      if (state.open && state.view === "manage") {
        render();
      }
    }
  }

  function ensureWorkspaceHasFile() {
    if (state.workspace.files.length) {
      return;
    }
    let folder = state.workspace.folders[0];
    if (!folder) {
      folder = {
        id: ExcalidrawSyncCore.makeId("folder"),
        name: ExcalidrawSyncCore.DEFAULT_FOLDER_NAME,
        createdAt: ExcalidrawSyncCore.nowIso(),
        updatedAt: ExcalidrawSyncCore.nowIso(),
      };
      state.workspace.folders.push(folder);
    }
    const file = {
      id: ExcalidrawSyncCore.makeId("file"),
      folderId: folder.id,
      name: "Untitled",
      pinned: false,
      scene: ExcalidrawSyncCore.emptyScene(),
      hash: ExcalidrawSyncCore.hashScene(ExcalidrawSyncCore.emptyScene()),
      createdAt: ExcalidrawSyncCore.nowIso(),
      updatedAt: ExcalidrawSyncCore.nowIso(),
    };
    state.workspace.files.push(file);
    state.workspace.activeFileId = file.id;
  }

  async function switchFile(fileId) {
    if (fileId === state.workspace.activeFileId || state.busy) {
      return;
    }
    const next = state.workspace.files.find((file) => file.id === fileId);
    if (!next) {
      return;
    }
    setBusy(true, "Saving current file…");
    try {
      await new Promise((resolve) => setTimeout(resolve, 380));
      await captureAndSaveActive({ sync: false, force: true });
      state.workspace.activeFileId = next.id;
      await persistWorkspace({ sync: false });
      await applyScene(next.scene);
      scheduleCloudSync();
      state.status = "Opening file…";
      elements.footerStatus.textContent = state.status;
      location.reload();
    } catch (error) {
      setBusy(false, "Could not switch files");
      showToast(error.message, "error");
    }
  }

  function closeDialog(result = null) {
    const layer = elements.modalRoot.querySelector(".dialog-layer");
    if (layer?._resolve) {
      layer._resolve(result);
    }
    elements.modalRoot.replaceChildren();
  }

  function showFormDialog({ title, description = "", fields = [], confirmLabel = "Save", danger = false }) {
    return new Promise((resolve) => {
      const layer = document.createElement("div");
      layer.className = "dialog-layer";
      layer._resolve = resolve;
      replaceMarkup(layer, `
        <form class="dialog" role="dialog" aria-modal="true" aria-labelledby="dialog-title">
          <h2 id="dialog-title">${escapeHtml(title)}</h2>
          ${description ? `<p>${escapeHtml(description)}</p>` : ""}
          ${fields
            .map(
              (field) => `
                <label class="field">
                  <span>${escapeHtml(field.label)}</span>
                  ${
                    field.type === "select"
                      ? `<select name="${escapeHtml(field.name)}">${field.options
                          .map((option) => `<option value="${escapeHtml(option.value)}" ${option.value === field.value ? "selected" : ""}>${escapeHtml(option.label)}</option>`)
                          .join("")}</select>`
                      : `<input name="${escapeHtml(field.name)}" value="${escapeHtml(field.value || "")}" ${field.required ? "required" : ""} maxlength="120">`
                  }
                </label>`,
            )
            .join("")}
          <div class="dialog-actions">
            <button class="button cancel" type="button">Cancel</button>
            <button class="button ${danger ? "danger" : "primary"}" type="submit">${escapeHtml(confirmLabel)}</button>
          </div>
        </form>`);
      elements.modalRoot.append(layer);
      const form = layer.querySelector("form");
      const cancel = layer.querySelector(".cancel");
      cancel.addEventListener("click", () => closeDialog(null));
      layer.addEventListener("click", (event) => {
        if (event.target === layer) {
          closeDialog(null);
        }
      });
      form.addEventListener("submit", (event) => {
        event.preventDefault();
        closeDialog(Object.fromEntries(new FormData(form)));
      });
      layer.addEventListener("keydown", (event) => {
        if (event.key === "Escape") {
          closeDialog(null);
        }
      });
      requestAnimationFrame(() => form.querySelector("input, select, button")?.focus());
    });
  }

  async function createFile(folderId = null) {
    const folders = state.workspace.folders;
    if (!folders.length) {
      await createFolder();
    }
    const result = await showFormDialog({
      title: "New file",
      fields: [
        { name: "name", label: "File name", value: "Untitled", required: true },
        {
          name: "folderId",
          label: "Folder",
          type: "select",
          value: folderId || state.workspace.folders[0]?.id,
          options: state.workspace.folders.map((folder) => ({ value: folder.id, label: folder.name })),
        },
      ],
      confirmLabel: "Create file",
    });
    if (!result) {
      return;
    }
    const now = ExcalidrawSyncCore.nowIso();
    const file = {
      id: ExcalidrawSyncCore.makeId("file"),
      folderId: result.folderId,
      name: result.name.trim() || "Untitled",
      pinned: false,
      scene: ExcalidrawSyncCore.emptyScene(),
      hash: ExcalidrawSyncCore.hashScene(ExcalidrawSyncCore.emptyScene()),
      createdAt: now,
      updatedAt: now,
    };
    state.workspace.files.push(file);
    await persistWorkspace({ sync: false });
    render();
    await switchFile(file.id);
  }

  async function createFolder() {
    const result = await showFormDialog({
      title: "New folder",
      fields: [{ name: "name", label: "Folder name", value: "New folder", required: true }],
      confirmLabel: "Create folder",
    });
    if (!result) {
      return null;
    }
    const now = ExcalidrawSyncCore.nowIso();
    const folder = {
      id: ExcalidrawSyncCore.makeId("folder"),
      name: result.name.trim() || "New folder",
      createdAt: now,
      updatedAt: now,
    };
    state.workspace.folders.push(folder);
    await persistWorkspace();
    render();
    return folder;
  }

  async function renameEntry(kind, id) {
    const collection = kind === "folder" ? state.workspace.folders : state.workspace.files;
    const entry = collection.find((item) => item.id === id);
    if (!entry) {
      return;
    }
    const result = await showFormDialog({
      title: `Rename ${kind}`,
      fields: [{ name: "name", label: "Name", value: entry.name, required: true }],
      confirmLabel: "Rename",
    });
    if (!result) {
      return;
    }
    entry.name = result.name.trim() || entry.name;
    entry.updatedAt = ExcalidrawSyncCore.nowIso();
    await persistWorkspace();
    render();
  }

  async function moveFile(fileId) {
    const file = state.workspace.files.find((item) => item.id === fileId);
    if (!file) {
      return;
    }
    const result = await showFormDialog({
      title: "Move file",
      fields: [
        {
          name: "folderId",
          label: "Folder",
          type: "select",
          value: file.folderId,
          options: state.workspace.folders.map((folder) => ({ value: folder.id, label: folder.name })),
        },
      ],
      confirmLabel: "Move",
    });
    if (!result || result.folderId === file.folderId) {
      return;
    }
    file.folderId = result.folderId;
    file.updatedAt = ExcalidrawSyncCore.nowIso();
    await persistWorkspace();
    render();
  }

  async function confirmDelete(kind, id) {
    const collection = kind === "folder" ? state.workspace.folders : state.workspace.files;
    const entry = collection.find((item) => item.id === id);
    if (!entry) {
      return;
    }
    const childCount = kind === "folder" ? state.workspace.files.filter((file) => file.folderId === id).length : 0;
    const description = kind === "folder" && childCount
      ? `Delete “${entry.name}” and its ${childCount} file${childCount === 1 ? "" : "s"}? This cannot be undone.`
      : `Delete “${entry.name}”? This cannot be undone.`;
    const result = await showFormDialog({
      title: `Delete ${kind}?`,
      description,
      confirmLabel: "Delete",
      danger: true,
    });
    if (!result) {
      return;
    }
    const activeBefore = state.workspace.activeFileId;
    state.workspace = ExcalidrawSyncCore.removeEntry(state.workspace, kind, id);
    ensureWorkspaceHasFile();
    const activeChanged = activeBefore !== state.workspace.activeFileId;
    await persistWorkspace();
    render();
    showToast(`${kind === "folder" ? "Folder" : "File"} deleted.`);
    if (activeChanged) {
      const next = state.workspace.files.find((file) => file.id === state.workspace.activeFileId);
      await applyScene(next.scene);
      location.reload();
    }
  }

  async function importFiles(fileList, folderId = null) {
    if (!fileList.length) {
      return;
    }
    let targetFolderId = folderId;
    if (!targetFolderId) {
      const result = await showFormDialog({
        title: `Import ${fileList.length} file${fileList.length === 1 ? "" : "s"}`,
        fields: [
          {
            name: "folderId",
            label: "Folder",
            type: "select",
            value: state.workspace.folders[0]?.id,
            options: state.workspace.folders.map((folder) => ({ value: folder.id, label: folder.name })),
          },
        ],
        confirmLabel: "Import",
      });
      if (!result) {
        return;
      }
      targetFolderId = result.folderId;
    }
    let imported = 0;
    const errors = [];
    for (const sourceFile of fileList) {
      try {
        const scene = ExcalidrawSyncCore.normalizeScene(await sourceFile.text());
        const now = ExcalidrawSyncCore.nowIso();
        state.workspace.files.push({
          id: ExcalidrawSyncCore.makeId("file"),
          folderId: targetFolderId,
          name: sourceFile.name.replace(/\.excalidraw$/i, "") || "Imported drawing",
          pinned: false,
          scene,
          hash: ExcalidrawSyncCore.hashScene(scene),
          createdAt: now,
          updatedAt: now,
        });
        imported += 1;
      } catch (error) {
        errors.push(`${sourceFile.name}: ${error.message}`);
      }
    }
    if (imported) {
      await persistWorkspace();
      render();
      showToast(`Imported ${imported} file${imported === 1 ? "" : "s"}.`);
    }
    if (errors.length) {
      showToast(errors[0], "error");
    }
  }

  function formatUpdated(dateValue) {
    if (!dateValue) {
      return "Not saved yet";
    }
    const date = new Date(dateValue);
    const today = new Date();
    const sameDay = date.toDateString() === today.toDateString();
    return sameDay
      ? date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
      : date.toLocaleDateString([], { month: "short", day: "numeric" });
  }

  function fileRow(file, { pinned = false } = {}) {
    return `
      <div class="file-row ${file.id === state.workspace.activeFileId ? "active" : ""}" data-deletable data-kind="file" data-id="${escapeHtml(file.id)}">
        <button class="file-main" type="button" data-action="open-file" data-id="${escapeHtml(file.id)}" aria-label="Open ${escapeHtml(file.name)}">
          ${icon("file", 19)}
          <span class="file-copy"><strong>${escapeHtml(file.name)}</strong><small>${file.id === state.workspace.activeFileId ? "Open now" : `Saved ${escapeHtml(formatUpdated(file.updatedAt))}`}</small></span>
        </button>
        <div class="row-actions">
          <button class="row-action" type="button" data-action="pin-file" data-id="${escapeHtml(file.id)}" aria-label="${pinned ? "Unpin" : "Pin"} ${escapeHtml(file.name)}">${icon("pin", 16)}</button>
          <button class="row-action" type="button" data-action="file-more" data-id="${escapeHtml(file.id)}" aria-label="File actions for ${escapeHtml(file.name)}">${icon("more", 17)}</button>
          <button class="row-action delete" type="button" data-action="delete" data-kind="file" data-id="${escapeHtml(file.id)}" aria-label="Delete ${escapeHtml(file.name)}">${icon("trash", 16)}</button>
        </div>
      </div>`;
  }

  function renderFilesView() {
    const query = state.query.trim().toLocaleLowerCase();
    const matches = (name) => !query || name.toLocaleLowerCase().includes(query);
    const pinnedFiles = state.workspace.files.filter((file) => file.pinned && matches(file.name));
    const folders = state.workspace.folders.filter((folder) =>
      matches(folder.name) || state.workspace.files.some((file) => file.folderId === folder.id && matches(file.name)),
    );
    const orphaned = state.workspace.files.filter((file) => !state.workspace.folders.some((folder) => folder.id === file.folderId) && matches(file.name));
    return `
      <div class="search-wrap">${icon("search", 19)}<input class="search" type="search" placeholder="Search files and folders" value="${escapeHtml(state.query)}" aria-label="Search files and folders"></div>
      <div class="quick-grid">
        <button class="quick-action" type="button" data-action="new-file">${icon("file", 19)}<span>New file</span></button>
        <button class="quick-action" type="button" data-action="import">${icon("import", 19)}<span>Import</span></button>
        <button class="quick-action" type="button" data-action="new-folder">${icon("folder", 19)}<span>New folder</span></button>
        <button class="quick-action" type="button" data-action="manage">${icon("settings", 19)}<span>Manage</span></button>
      </div>
      <div class="sync-row">${icon("cloud", 18)}<span>${escapeHtml(state.status)}</span><button type="button" data-action="sync" aria-label="Sync now" title="Sync now">${icon("cloud", 17)}</button></div>
      ${pinnedFiles.length ? `<section class="section pinned"><div class="section-title">${icon("pin", 15)} Pinned</div>${pinnedFiles.map((file) => fileRow(file, { pinned: true })).join("")}</section>` : ""}
      <section class="section">
        <div class="section-title">Folders</div>
        ${folders
          .map((folder) => {
            const folderFiles = state.workspace.files.filter((file) => file.folderId === folder.id && matches(file.name));
            const collapsed = state.collapsedFolders.has(folder.id);
            return `
              <div class="folder ${collapsed ? "collapsed" : ""}" data-deletable data-kind="folder" data-id="${escapeHtml(folder.id)}">
                <div class="folder-head">
                  <button class="folder-toggle" type="button" data-action="toggle-folder" data-id="${escapeHtml(folder.id)}" aria-expanded="${String(!collapsed)}">
                    <span class="chevron">${icon("chevron", 16)}</span>${icon("folder", 18)}<span>${escapeHtml(folder.name)}</span>
                  </button>
                  <div class="row-actions">
                    <button class="row-action" type="button" data-action="folder-add" data-id="${escapeHtml(folder.id)}" aria-label="Add file to ${escapeHtml(folder.name)}">${icon("plus", 16)}</button>
                    <button class="row-action" type="button" data-action="rename" data-kind="folder" data-id="${escapeHtml(folder.id)}" aria-label="Rename ${escapeHtml(folder.name)}">${icon("edit", 15)}</button>
                    <button class="row-action delete" type="button" data-action="delete" data-kind="folder" data-id="${escapeHtml(folder.id)}" aria-label="Delete ${escapeHtml(folder.name)}">${icon("trash", 15)}</button>
                  </div>
                </div>
                <div class="folder-files">${folderFiles.length ? folderFiles.map((file) => fileRow(file)).join("") : '<div class="empty">No files in this folder.</div>'}</div>
              </div>`;
          })
          .join("")}
        ${orphaned.length ? `<div class="folder"><div class="folder-head"><div class="folder-toggle">${icon("folder", 18)}<span>Unfiled</span></div></div><div class="folder-files">${orphaned.map((file) => fileRow(file)).join("")}</div></div>` : ""}
        ${!folders.length && !orphaned.length ? '<div class="empty">No matching files or folders.</div>' : ""}
      </section>`;
  }

  function providerLink(url, label) {
    return url ? `<a class="text-link" href="${escapeHtml(url)}" target="_blank" rel="noreferrer">${escapeHtml(label)} ${icon("external", 12)}</a>` : "";
  }

  function renderManageView() {
    const github = state.providers?.github;
    const drive = state.providers?.googleDrive;
    return `
      <div class="manage-title"><button class="icon-button" type="button" data-action="back" aria-label="Back to files">${icon("back", 20)}</button><h2>Manage sync</h2></div>
      <form class="providers-form">
        <section class="card">
          <div class="card-head"><strong>GitHub</strong><span class="badge ${github?.connected ? "connected" : ""}">${github?.connected ? "Connected" : "Not connected"}</span></div>
          <label class="field"><span>OAuth App client ID</span><input name="githubClientId" value="${escapeHtml(github?.config.clientId || "")}" placeholder="Iv1…"></label>
          <div class="field-help">Device Flow must be enabled in the GitHub OAuth App. The token stays in this browser.</div>
          <label class="field"><span>Repository name</span><input name="githubRepoName" value="${escapeHtml(github?.config.repoName || "excalidraw-diagrams")}"></label>
          <label class="field"><span>Repository visibility</span><select name="githubVisibility"><option value="private" ${github?.config.visibility !== "public" ? "selected" : ""}>Private</option><option value="public" ${github?.config.visibility === "public" ? "selected" : ""}>Public</option></select></label>
          <label class="field"><span>Root directory</span><input name="githubRoot" value="${escapeHtml(github?.config.rootDirectory || "Excalidraw")}"></label>
          ${github?.pendingAuth ? `<div class="device-code"><span>Enter this code on GitHub</span><strong>${escapeHtml(github.pendingAuth.userCode)}</strong><a class="text-link" href="${escapeHtml(github.pendingAuth.verificationUri)}" target="_blank" rel="noreferrer">Open GitHub ${icon("external", 12)}</a></div>` : ""}
          <div class="button-row">
            <button class="button primary" type="button" data-action="github-connect">${github?.connected ? "Reconnect" : "Connect GitHub"}</button>
            ${github?.connected ? '<button class="button danger" type="button" data-action="disconnect" data-provider="github">Disconnect</button>' : ""}
          </div>
          <div class="provider-status ${github?.lastError ? "error" : ""}">${github?.lastError ? escapeHtml(github.lastError) : github?.account ? `Signed in as ${escapeHtml(github.account.login)}. ${providerLink(github.repositoryUrl, "Open repository")}` : "A private repository will be created on the first sync."}</div>
        </section>
        <section class="card">
          <div class="card-head"><strong>Google Drive</strong><span class="badge ${drive?.connected ? "connected" : ""}">${drive?.connected ? "Connected" : "Not connected"}</span></div>
          <label class="field"><span>Google OAuth client ID</span><input name="googleClientId" value="${escapeHtml(drive?.config.clientId || "")}" placeholder="…apps.googleusercontent.com"></label>
          <div class="field-help">Use an OAuth client configured with this extension’s redirect URL and the Drive API.</div>
          <label class="field"><span>Drive folder name</span><input name="googleFolderName" value="${escapeHtml(drive?.config.folderName || "Excalidraw")}"></label>
          <label class="field"><span>Folder visibility</span><select name="googleVisibility"><option value="private" ${drive?.config.visibility !== "public" ? "selected" : ""}>Private</option><option value="public" ${drive?.config.visibility === "public" ? "selected" : ""}>Anyone with the link</option></select></label>
          <div class="button-row">
            <button class="button primary" type="button" data-action="google-connect">${drive?.connected ? "Reconnect" : "Connect Google Drive"}</button>
            ${drive?.connected ? '<button class="button danger" type="button" data-action="disconnect" data-provider="googleDrive">Disconnect</button>' : ""}
          </div>
          <div class="provider-status ${drive?.lastError ? "error" : ""}">${drive?.lastError ? escapeHtml(drive.lastError) : drive?.account ? `Signed in as ${escapeHtml(drive.account.email)}. ${providerLink(drive.folderUrl, "Open folder")}` : "The Drive folder is private unless you explicitly choose link sharing."}</div>
        </section>
        <div class="button-row"><button class="button primary" type="submit">Save settings</button><button class="button" type="button" data-action="sync">Sync now</button></div>
      </form>`;
  }

  function renderHeader() {
    replaceMarkup(elements.header, `
      <div class="brand-mark">${icon("logo", 22)}</div>
      <div class="brand"><strong>Excalidraw Sync</strong><span>${escapeHtml(state.workspace?.name || "My Excalidraw")}</span></div>
      <button class="icon-button" type="button" data-action="close" aria-label="Close sidebar">${icon("close", 21)}</button>`);
  }

  function render() {
    if (!state.workspace) {
      return;
    }
    renderHeader();
    replaceMarkup(elements.body, state.view === "manage" ? renderManageView() : renderFilesView());
    bindSwipeHandlers();
  }

  function bindSwipeHandlers() {
    for (const row of elements.body.querySelectorAll("[data-deletable]")) {
      let start = null;
      row.addEventListener("pointerdown", (event) => {
        if (event.pointerType === "mouse" || event.target.closest("[data-deletable]") !== row) {
          return;
        }
        start = { x: event.clientX, y: event.clientY };
      });
      row.addEventListener("pointermove", (event) => {
        if (!start || event.pointerType === "mouse") {
          return;
        }
        const delta = Math.min(0, event.clientX - start.x);
        if (Math.abs(delta) > 8) {
          row.style.transform = `translateX(${Math.max(-76, delta)}px)`;
        }
      });
      row.addEventListener("pointerup", (event) => {
        if (!start || event.pointerType === "mouse" || event.target.closest("[data-deletable]") !== row) {
          return;
        }
        const shouldRequestDelete = ExcalidrawSyncCore.isDeleteSwipe(start.x, event.clientX, start.y, event.clientY);
        start = null;
        row.style.transform = "";
        if (shouldRequestDelete) {
          confirmDelete(row.dataset.kind, row.dataset.id);
        }
      });
      row.addEventListener("pointercancel", () => {
        start = null;
        row.style.transform = "";
      });
    }
  }

  async function saveProviderForm() {
    const form = elements.body.querySelector(".providers-form");
    if (!form) {
      return;
    }
    const data = Object.fromEntries(new FormData(form));
    state.providers = await sendMessage({
      type: "providers:save",
      github: {
        clientId: data.githubClientId,
        repoName: data.githubRepoName,
        visibility: data.githubVisibility,
        rootDirectory: data.githubRoot,
      },
      googleDrive: {
        clientId: data.googleClientId,
        folderName: data.googleFolderName,
        visibility: data.googleVisibility,
      },
    });
  }

  async function connectGitHub() {
    setBusy(true, "Starting GitHub sign-in…");
    try {
      await saveProviderForm();
      const github = await sendMessage({ type: "github:startAuth" });
      state.providers.github = github;
      render();
      window.open(github.pendingAuth.verificationUri, "_blank", "noopener,noreferrer");
      startGitHubPolling(github.pendingAuth.interval);
    } catch (error) {
      showToast(error.message, "error");
    } finally {
      setBusy(false, "Saved locally");
    }
  }

  function startGitHubPolling(interval = 5) {
    clearTimeout(state.githubPollTimer);
    state.githubPollTimer = setTimeout(async () => {
      try {
        const result = await sendMessage({ type: "github:pollAuth" });
        if (result.pending) {
          startGitHubPolling(result.interval);
          return;
        }
        state.providers.github = result.provider;
        showToast(`Connected to GitHub as ${result.provider.account.login}.`);
        render();
        syncNow({ quiet: true });
      } catch (error) {
        showToast(error.message, "error");
      }
    }, Math.max(5, interval) * 1000);
  }

  async function connectGoogle() {
    setBusy(true, "Starting Google sign-in…");
    try {
      await saveProviderForm();
      state.providers.googleDrive = await sendMessage({ type: "google:connect" });
      showToast(`Connected to Google Drive as ${state.providers.googleDrive.account.email}.`);
      render();
      syncNow({ quiet: true });
    } catch (error) {
      showToast(error.message, "error");
    } finally {
      setBusy(false, "Saved locally");
    }
  }

  elements.launcher.addEventListener("click", () => setOpen(true));
  elements.backdrop.addEventListener("click", () => setOpen(false));
  elements.filePicker.addEventListener("change", async () => {
    const files = [...elements.filePicker.files];
    elements.filePicker.value = "";
    await importFiles(files);
  });

  elements.panel.addEventListener("input", (event) => {
    if (event.target.matches(".search")) {
      state.query = event.target.value;
      const position = event.target.selectionStart;
      render();
      const search = elements.body.querySelector(".search");
      search.focus();
      search.setSelectionRange(position, position);
    }
  });

  elements.panel.addEventListener("submit", async (event) => {
    if (!event.target.matches(".providers-form")) {
      return;
    }
    event.preventDefault();
    try {
      await saveProviderForm();
      showToast("Sync settings saved.");
      render();
    } catch (error) {
      showToast(error.message, "error");
    }
  });

  elements.panel.addEventListener("click", async (event) => {
    const button = event.target.closest("[data-action]");
    if (!button) {
      return;
    }
    const action = button.dataset.action;
    try {
      if (action === "close") setOpen(false);
      if (action === "new-file") await createFile();
      if (action === "new-folder") await createFolder();
      if (action === "import") elements.filePicker.click();
      if (action === "manage") { state.view = "manage"; render(); }
      if (action === "back") { state.view = "files"; render(); }
      if (action === "open-file") await switchFile(button.dataset.id);
      if (action === "folder-add") await createFile(button.dataset.id);
      if (action === "toggle-folder") {
        if (state.collapsedFolders.has(button.dataset.id)) state.collapsedFolders.delete(button.dataset.id);
        else state.collapsedFolders.add(button.dataset.id);
        render();
      }
      if (action === "pin-file") {
        const file = state.workspace.files.find((item) => item.id === button.dataset.id);
        if (file) { file.pinned = !file.pinned; await persistWorkspace(); render(); }
      }
      if (action === "delete") await confirmDelete(button.dataset.kind, button.dataset.id);
      if (action === "rename") await renameEntry(button.dataset.kind, button.dataset.id);
      if (action === "file-more") {
        const file = state.workspace.files.find((item) => item.id === button.dataset.id);
        const result = await showFormDialog({
          title: "File details",
          fields: [
            { name: "name", label: "File name", value: file.name, required: true },
            {
              name: "folderId", label: "Folder", type: "select", value: file.folderId,
              options: state.workspace.folders.map((folder) => ({ value: folder.id, label: folder.name })),
            },
          ],
          confirmLabel: "Save",
        });
        if (result) {
          file.name = result.name.trim() || file.name;
          file.folderId = result.folderId;
          file.updatedAt = ExcalidrawSyncCore.nowIso();
          await persistWorkspace();
          render();
        }
      }
      if (action === "sync") await syncNow();
      if (action === "github-connect") await connectGitHub();
      if (action === "google-connect") await connectGoogle();
      if (action === "disconnect") {
        state.providers = await sendMessage({ type: "provider:disconnect", provider: button.dataset.provider });
        showToast("Provider disconnected from this browser.");
        render();
      }
    } catch (error) {
      showToast(error.message, "error");
    }
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && state.open && !elements.modalRoot.children.length) {
      setOpen(false);
    }
  });

  extensionApi.runtime.onMessage.addListener((message) => {
    if (message?.type === "sidebar:toggle") {
      setOpen(!state.open);
    }
  });

  async function initialize() {
    try {
      const stored = await storageGet(WORKSPACE_KEY);
      state.workspace = ExcalidrawSyncCore.normalizeWorkspace(stored);
      if (!stored) {
        await new Promise((resolve) => setTimeout(resolve, 500));
        const scene = await captureScene();
        const active = state.workspace.files[0];
        active.scene = scene;
        active.hash = ExcalidrawSyncCore.hashScene(scene);
        await persistWorkspace({ sync: false });
      }
      ensureWorkspaceHasFile();
      state.providers = await sendMessage({ type: "providers:get" });
      state.lastBrowserFingerprint = browserFingerprint();
      render();
      setInterval(async () => {
        if (document.hidden || state.busy) {
          return;
        }
        const fingerprint = browserFingerprint();
        if (fingerprint === state.lastBrowserFingerprint) {
          return;
        }
        state.lastBrowserFingerprint = fingerprint;
        try {
          await captureAndSaveActive();
        } catch (error) {
          state.status = "Autosave needs attention";
          elements.footerStatus.textContent = state.status;
        }
      }, AUTOSAVE_INTERVAL_MS);
      window.addEventListener("pagehide", () => {
        captureAndSaveActive({ sync: false, force: true }).catch(() => {});
      });
    } catch (error) {
      showToast(`Excalidraw Sync could not start: ${error.message}`, "error");
    }
  }

  initialize();
})();
