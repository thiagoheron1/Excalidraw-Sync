/* global ExcalidrawSyncCore, ExcalidrawSyncUIEvents, ExcalidrawSyncI18n */
(function initializeExcalidrawSync() {
  "use strict";

  if (globalThis.__excalidrawSyncLoaded) {
    return;
  }
  globalThis.__excalidrawSyncLoaded = true;

  const extensionApi = globalThis.browser || globalThis.chrome;
  const usesPromiseApi = typeof globalThis.browser !== "undefined";
  const WORKSPACE_KEY = "excalidrawSync.workspace";
  const LOCAL_VAULT_KEY = "excalidrawSync.localVault";
  const LAUNCHER_POSITION_KEY = "excalidrawSync.launcherPosition";
  const LAUNCHER_VISIBLE_KEY = "excalidrawSync.launcherVisible";
  const SIDEBAR_RAIL_HIDDEN_KEY = "excalidrawSync.sidebarRailHidden";
  const LAUNCHER_INTRODUCED_KEY = "excalidrawSync.launcherIntroduced";
  const THEME_KEY = "excalidrawSync.theme";
  const LANGUAGE_KEY = "excalidrawSync.language";
  const SAVE_SETTINGS_KEY = "excalidrawSync.saveSettings";
  const SAVE_STATE_KEY = "excalidrawSync.saveState";
  const NOTIFICATIONS_KEY = "excalidrawSync.notifications";
  const CONTEXT_RECOVERY_KEY = "excalidrawSync.contextRecovery";
  const DURABLE_RESTORE_NOTICE_KEY = "excalidrawSync.durableRestoreNotice";
  const SIDEBAR_OPEN_REQUEST_KEY = "excalidrawSync.sidebarOpenRequested";
  const FILES_DB = "files-db";
  const FILES_STORE = "files-store";
  const DURABLE_BACKUP_DB = "excalidraw-sync-backup";
  const DURABLE_BACKUP_STORE = "workspace-store";
  const DURABLE_BACKUP_KEY = "workspace";
  const CHANGE_CHECK_INTERVAL_MS = 1000;
  const rootHost = document.createElement("div");
  rootHost.id = "excalidraw-sync-root";
  rootHost.dataset.theme = ExcalidrawSyncUIEvents.excalidrawThemeFromClassName(
    document.querySelector(".excalidraw")?.className,
  );
  document.documentElement.append(rootHost);
  const shadow = rootHost.attachShadow({ mode: "open" });
  ExcalidrawSyncUIEvents.protectEditableEvents(shadow);

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
    launcherPosition: { x: 0, y: 70 },
    launcherVisible: true,
    sidebarRailHidden: false,
    launcherIntroduced: true,
    theme: "excalidraw",
    language: ExcalidrawSyncI18n.normalizeLanguage(extensionApi.i18n?.getUILanguage?.() || navigator.language),
    saveSettings: ExcalidrawSyncUIEvents.normalizeSaveSettings(),
    dirtySince: null,
    unsyncedSince: null,
    lastSavedAt: null,
    lastSyncedAt: null,
    notifications: [],
    nativeStorage: { available: false, root: "~/.excalidraw-sync" },
    draggedFileId: null,
    draggedFolderId: null,
    importFolderId: null,
  };
  let settingsSaveTimer = null;
  let settingsSaveQueue = Promise.resolve();

  function t(text) {
    return ExcalidrawSyncI18n.translate(text, state.language);
  }

  function localizeUi(root) {
    ExcalidrawSyncI18n.localizeTree(root, state.language);
  }

  function applyLanguage(value) {
    state.language = ExcalidrawSyncI18n.normalizeLanguage(value);
    rootHost.lang = state.language;
    const sidebarToggleText = shadow.querySelector(".sidebar-toggle-label");
    if (sidebarToggleText) sidebarToggleText.textContent = t("Collapse");
  }

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

  async function storageRemove(keys) {
    await apiCall(extensionApi.storage.local, "remove", keys);
  }

  async function sendMessage(message) {
    const response = await apiCall(extensionApi.runtime, "sendMessage", message);
    if (!response?.ok) {
      throw new Error(response?.error || "The extension could not complete that action.");
    }
    return response.data;
  }

  async function recoverInvalidatedContext(
    _error = null,
    { switchToFileId = null, currentFileId = null, providerFormDraft = null } = {},
  ) {
    try {
      const active = state.workspace?.files.find((file) => file.id === (currentFileId || state.workspace.activeFileId));
      if (active) {
        const scene = await captureScene();
        active.scene = scene;
        active.hash = ExcalidrawSyncCore.hashScene(scene);
        active.updatedAt = ExcalidrawSyncCore.nowIso();
      }
    } catch (_error) {
      // The in-memory workspace still contains the last successful local save.
    }
    if (switchToFileId) {
      const target = state.workspace?.files.find((file) => file.id === switchToFileId);
      if (target) {
        try {
          await applyScene(target.scene);
          state.workspace.activeFileId = switchToFileId;
          state.view = "files";
          state.open = true;
        } catch (_sceneError) {
          // Reloading still reconnects the extension; the current drawing remains selected.
        }
      }
    }
    if (providerFormDraft) {
      state.view = "manage";
      state.open = true;
    }
    try {
      sessionStorage.setItem(CONTEXT_RECOVERY_KEY, JSON.stringify({
        workspace: state.workspace,
        dirtySince: state.dirtySince,
        unsyncedSince: state.unsyncedSince,
        lastSavedAt: state.lastSavedAt,
        lastSyncedAt: state.lastSyncedAt,
        view: state.view,
        open: state.open,
        providerFormDraft,
        recoveredAt: ExcalidrawSyncCore.nowIso(),
      }));
    } catch (_error) {
      // Reloading is still the only way to attach the page to the updated extension.
    }
    showToast("ExcaliSync was updated. Reloading safely to restore this change…");
    window.setTimeout(() => location.reload(), 450);
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
      sync: '<path d="M20 7h-5V2"/><path d="m20 2-3.5 3.5A8 8 0 0 0 4.6 8"/><path d="M4 17h5v5"/><path d="m4 22 3.5-3.5A8 8 0 0 0 19.4 16"/>',
      openFolder: '<path d="M3 7h7l2 2h9l-2 10H5z"/><path d="M3 7v12h2"/>',
      import: '<path d="M5 4h9l5 5v11H5zM14 4v5h5"/><path d="M12 12v6M9 15l3 3 3-3"/>',
      check: '<path d="m5 12 4 4L19 6"/>',
      external: '<path d="M14 4h6v6M20 4l-9 9"/><path d="M18 13v7H4V6h7"/>',
      back: '<path d="m15 18-6-6 6-6"/>',
      bell: '<path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4"/>',
      alert: '<path d="M12 3 2.5 20h19z"/><path d="M12 9v4M12 17h.01"/>',
      more: '<circle cx="5" cy="12" r="1" fill="currentColor"/><circle cx="12" cy="12" r="1" fill="currentColor"/><circle cx="19" cy="12" r="1" fill="currentColor"/>',
      link: '<path d="M10 13a5 5 0 0 0 7.5.5l2-2a5 5 0 0 0-7-7l-1.1 1.1"/><path d="M14 11a5 5 0 0 0-7.5-.5l-2 2a5 5 0 0 0 7 7l1.1-1.1"/>',
    };
    return `<svg aria-hidden="true" viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${paths[name] || ""}</svg>`;
  }

  function providerIcon(name, size = 22) {
    if (name === "github") {
      return `<svg class="provider-icon github" aria-hidden="true" viewBox="0 0 24 24" width="${size}" height="${size}"><path fill="currentColor" d="M12 .7a11.5 11.5 0 0 0-3.64 22.4c.58.1.79-.25.79-.56v-2.23c-3.22.7-3.9-1.37-3.9-1.37-.53-1.34-1.29-1.7-1.29-1.7-1.05-.72.08-.7.08-.7 1.17.08 1.78 1.2 1.78 1.2 1.04 1.78 2.72 1.27 3.38.97.1-.75.4-1.27.74-1.56-2.57-.29-5.27-1.28-5.27-5.68 0-1.26.45-2.28 1.19-3.08-.12-.29-.52-1.46.11-3.04 0 0 .97-.31 3.16 1.18a10.9 10.9 0 0 1 5.76 0c2.2-1.49 3.16-1.18 3.16-1.18.63 1.58.23 2.75.11 3.04.74.8 1.19 1.82 1.19 3.08 0 4.41-2.71 5.38-5.29 5.67.42.36.78 1.06.78 2.14v3.17c0 .31.21.67.8.56A11.5 11.5 0 0 0 12 .7Z"/></svg>`;
    }
    if (name === "googleDrive") {
      return `<svg class="provider-icon google-drive" aria-hidden="true" viewBox="0 0 24 24" width="${size}" height="${size}"><path fill="#0F9D58" d="M8.1 3h5.15l7.55 13.08h-5.16z"/><path fill="#F4B400" d="M8.1 3 .55 16.08l2.58 4.46L10.68 7.46z"/><path fill="#4285F4" d="M3.13 20.54h15.1l2.57-4.46H5.7z"/></svg>`;
    }
    return "";
  }

  const styles = `
    :host {
      all: initial; color-scheme: dark;
      --bg: #111113; --surface: #1c1c1f; --surface-2: #26262b; --border: #35353e;
      --text: #f4f4f5; --muted: #a1a1aa; --accent: #8b87f7; --accent-solid: #6965db;
      --accent-hover: #5b57cf; --accent-text: #d9d8ff; --accent-link: #b8b5ff;
      --danger: #fb7185; --danger-soft: rgba(251,113,133,.12); --input-bg: #111113;
      --dialog-bg: #171719; --dialog-input: #0f0f11; --placeholder: #797983;
      --hover-border: #5a5878; --subtle-hover: rgba(255,255,255,.035);
      --active-bg: rgba(105,101,219,.15); --badge-bg: #303037;
      --success: #6ee7b7; --success-bg: rgba(52,211,153,.13);
      --overlay: rgba(0,0,0,.58); --panel-shadow: rgba(0,0,0,.28);
      --dialog-shadow: rgba(0,0,0,.55); --toast-bg: #1f1f23; --toast-text: #fff;
      --toast-border: #454550; --error-border: #9f4353;
      --warning-bg: rgba(245,158,11,.16); --warning-border: #d99b22;
      --stale-bg: rgba(225,29,72,.15);
    }
    :host([data-theme="light"]) {
      color-scheme: light;
      --bg: #fbfbfd; --surface: #f2f2f6; --surface-2: #e7e7ed; --border: #d1d1da;
      --text: #202026; --muted: #656574; --accent: #5e5ad4; --accent-solid: #6965db;
      --accent-hover: #5753c2; --accent-text: #46428c; --accent-link: #4c48ac;
      --danger: #b4233f; --danger-soft: rgba(180,35,63,.1); --input-bg: #fff;
      --dialog-bg: #fff; --dialog-input: #fff; --placeholder: #858594;
      --hover-border: #8c89b8; --subtle-hover: rgba(24,24,35,.045);
      --active-bg: rgba(105,101,219,.12); --badge-bg: #e3e3e9;
      --success: #08764e; --success-bg: rgba(8,118,78,.1);
      --overlay: rgba(26,26,36,.38); --panel-shadow: rgba(31,31,48,.2);
      --dialog-shadow: rgba(31,31,48,.26); --toast-bg: #292930; --toast-text: #fff;
      --toast-border: #44444f; --error-border: #b4233f;
      --warning-bg: #fff4cf; --warning-border: #d29213;
      --stale-bg: #ffe4e9;
    }
    @media (prefers-color-scheme: light) {
      :host([data-theme="system"]) {
        color-scheme: light;
        --bg: #fbfbfd; --surface: #f2f2f6; --surface-2: #e7e7ed; --border: #d1d1da;
        --text: #202026; --muted: #656574; --accent: #5e5ad4; --accent-solid: #6965db;
        --accent-hover: #5753c2; --accent-text: #46428c; --accent-link: #4c48ac;
        --danger: #b4233f; --danger-soft: rgba(180,35,63,.1); --input-bg: #fff;
        --dialog-bg: #fff; --dialog-input: #fff; --placeholder: #858594;
        --hover-border: #8c89b8; --subtle-hover: rgba(24,24,35,.045);
        --active-bg: rgba(105,101,219,.12); --badge-bg: #e3e3e9;
        --success: #08764e; --success-bg: rgba(8,118,78,.1);
        --overlay: rgba(26,26,36,.38); --panel-shadow: rgba(31,31,48,.2);
        --dialog-shadow: rgba(31,31,48,.26); --toast-bg: #292930; --toast-text: #fff;
        --toast-border: #44444f; --error-border: #b4233f;
        --warning-bg: #fff4cf; --warning-border: #d29213;
        --stale-bg: #ffe4e9;
      }
    }
    *, *::before, *::after { box-sizing: border-box; }
    button, input, select { font: inherit; }
    button { color: inherit; }
    .launcher {
      position: fixed; right: 12px; top: 70px; z-index: 2147483000;
      width: 64px; min-width: 64px; max-width: 64px; height: 62px; min-height: 62px; max-height: 62px; border: 1px solid rgba(121,113,234,.5);
      border-radius: 16px; background: linear-gradient(145deg, #7c78ec, var(--accent-solid)); color: #fff;
      display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 3px;
      cursor: grab; box-shadow: 0 10px 30px rgba(30,27,75,.3); padding: 6px 8px 5px;
      touch-action: none; user-select: none;
      transition: transform .18s ease, background .18s ease, opacity .18s ease;
    }
    .launcher-label {
      font-family: ui-rounded, "SF Pro Rounded", "Segoe UI", system-ui, sans-serif;
      font-size: 9px; line-height: 1; font-weight: 650; letter-spacing: .015em;
      text-rendering: optimizeLegibility;
    }
    .launcher:hover { transform: translateY(-1px); background: var(--accent-hover); }
    .launcher.needs-introduction {
      animation: launcher-introduction 1.45s ease-in-out infinite;
      box-shadow: 0 0 0 5px rgba(255,255,255,.72), 0 0 0 11px rgba(124,120,236,.48),
        0 0 34px 14px rgba(124,120,236,.72), 0 12px 34px rgba(30,27,75,.42);
    }
    .launcher.is-dragging { cursor: grabbing; transform: none; transition: background .18s ease, opacity .18s ease; }
    .launcher:focus-visible, .panel button:focus-visible, .panel input:focus-visible,
    .panel select:focus-visible, .dialog button:focus-visible, .dialog input:focus-visible,
    .dialog select:focus-visible { outline: 3px solid #a5b4fc; outline-offset: 2px; }
    .launcher.is-hidden { opacity: 0; pointer-events: none; }
    .launcher.user-hidden { display: none; }
    .backdrop { position: fixed; inset: 0; z-index: 2147482997; background: var(--overlay); opacity: 0; pointer-events: none; transition: opacity .2s ease; }
    .backdrop.open { opacity: 1; pointer-events: auto; }
    .panel {
      position: fixed; inset: 0 auto 0 0; z-index: 2147482998; width: min(392px, 94vw);
      transform: translateX(calc(-100% + 44px)); transition: transform .23s cubic-bezier(.2,.7,.2,1);
      background: var(--bg); color: var(--text); border-right: 1px solid var(--border);
      box-shadow: 18px 0 44px var(--panel-shadow); display: flex; flex-direction: column;
      font-family: Inter, ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      font-size: 13px; line-height: 1.4; color-scheme: inherit;
    }
    .panel.open { transform: translateX(0); }
    .panel.collapsed { background: var(--bg); color: var(--text); border-right-color: var(--border); box-shadow: 8px 0 24px var(--panel-shadow); cursor: pointer; }
    .panel.collapsed.rail-hidden { transform: translateX(-102%); pointer-events: none; }
    .collapsed-brand { position: absolute; z-index: 2; top: 16px; right: 0; bottom: 56px; width: 44px; display: flex; flex-direction: column; align-items: center; gap: 10px; color: var(--text); pointer-events: none; }
    .collapsed-brand svg { flex: 0 0 auto; }
    .collapsed-brand span { writing-mode: vertical-rl; text-orientation: mixed; font-family: ui-rounded, "SF Pro Rounded", "Segoe UI", system-ui, sans-serif; font-size: 10px; line-height: 1; font-weight: 700; letter-spacing: .045em; }
    .panel.open .collapsed-brand { display: none; }
    .panel:not(.open) .panel-header, .panel:not(.open) .panel-body, .panel:not(.open) .panel-footer { visibility: hidden; pointer-events: none; }
    .sidebar-toggle { position: absolute; z-index: 3; left: 0; right: 0; bottom: 0; width: 100%; height: 44px; border: 0; border-top: 1px solid var(--border); border-radius: 0; background: var(--surface); color: var(--text); display: flex; align-items: center; justify-content: center; cursor: pointer; box-shadow: 0 -4px 14px var(--panel-shadow); }
    .panel.collapsed .sidebar-toggle { justify-content: flex-end; padding-right: 12px; background: var(--surface); border-color: var(--border); color: var(--text); box-shadow: none; }
    .sidebar-toggle-label { font-size: 11px; font-weight: 650; }
    .panel.collapsed .sidebar-toggle-label { display: none; }
    .panel.open .sidebar-toggle { gap: 7px; }
    .panel:not(.open) .sidebar-toggle svg { transform: rotate(-90deg); }
    .panel.open .sidebar-toggle svg { transform: rotate(90deg); }
    .panel-header { display: flex; align-items: center; gap: 9px; padding: 15px 14px 13px; border-bottom: 1px solid var(--border); background: linear-gradient(180deg, var(--surface), var(--bg)); }
    .brand-mark { width: 34px; height: 34px; border-radius: 10px; display: grid; place-items: center; color: white; background: linear-gradient(145deg, #7c78ec, var(--accent-solid)); box-shadow: 0 5px 16px rgba(71,65,170,.22); }
    .brand { min-width: 0; flex: 1; }
    .brand strong { display: block; font-size: 16px; letter-spacing: -.02em; }
    .brand span { display: block; color: var(--muted); font-size: 10px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .icon-button { border: 0; background: transparent; border-radius: 8px; width: 32px; height: 32px; display: inline-grid; place-items: center; cursor: pointer; }
    .icon-button:hover { background: var(--surface-2); }
    .notification-button { position: relative; }
    .notification-badge { position: absolute; right: 1px; top: 1px; min-width: 16px; height: 16px; padding: 0 4px; border: 2px solid var(--bg); border-radius: 99px; background: var(--danger); color: white; display: grid; place-items: center; font-size: 9px; font-weight: 800; }
    .panel-body { flex: 1; overflow: auto; padding: 12px 13px 20px; scrollbar-width: thin; }
    .search-wrap { position: relative; margin: 0 3px 12px; }
    .search-wrap svg { position: absolute; left: 11px; top: 10px; color: var(--muted); }
    .search { width: 100%; height: 39px; border: 1px solid var(--border); border-radius: 10px; background: var(--surface); color: var(--text); padding: 0 11px 0 37px; transition: border-color .16s ease, box-shadow .16s ease; }
    .search:focus { border-color: var(--accent); box-shadow: 0 0 0 3px var(--active-bg); }
    .search::placeholder { color: var(--placeholder); }
    .quick-grid { display: flex; flex-direction: column; gap: 2px; margin: 0 3px 10px; padding-bottom: 10px; border-bottom: 1px solid var(--border); }
    .quick-action { width: 100%; min-height: 40px; border: 0; border-radius: 8px; background: transparent; display: flex; align-items: center; gap: 10px; padding: 0 9px; cursor: pointer; text-align: left; font-size: 12px; font-weight: 620; transition: background .14s ease, color .14s ease; }
    .quick-action svg { color: var(--accent); }
    .quick-action:hover { background: var(--surface-2); transform: none; }
    .sync-row { display: flex; align-items: center; gap: 7px; margin: 0 3px 10px; padding: 7px 9px; border-radius: 9px; background: var(--active-bg); color: var(--accent-text); }
    .sync-row.pending { background: rgba(245,158,11,.16); color: #b66a00; }
    .sync-row.stale { background: var(--danger-soft); color: var(--danger); border: 1px solid currentColor; }
    .sync-row span { flex: 1; font-size: 11px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .sync-row button { border: 0; background: var(--surface); color: var(--accent); cursor: pointer; width: 28px; height: 28px; display: grid; place-items: center; padding: 0; border-radius: 8px; }
    .sync-row button:hover, .header-sync:hover { background: var(--surface-2); }
    .header-sync.syncing svg { animation: spin .9s linear infinite; }
    .cloud-status { display: grid; grid-template-columns: 1fr 1fr; gap: 7px; margin: 0 3px 10px; padding-bottom: 10px; border-bottom: 1px solid var(--border); }
    .cloud-provider { min-width: 0; display: grid; grid-template-columns: auto minmax(0, 1fr); gap: 7px; align-items: center; padding: 8px 9px; border: 1px solid var(--border); border-radius: 9px; background: var(--surface); }
    .cloud-provider.has-error { border-color: var(--error-border); background: var(--danger-soft); }
    .cloud-provider-copy { min-width: 0; }
    .cloud-provider-copy strong { display: flex; align-items: center; gap: 5px; font-size: 11px; font-weight: 650; white-space: nowrap; }
    .cloud-provider-copy small { display: block; margin-top: 2px; color: var(--muted); font-size: 9px; line-height: 1.35; white-space: normal; overflow-wrap: anywhere; }
    .auto-state { display: inline-flex; align-items: center; padding: 1px 5px; border-radius: 99px; background: var(--badge-bg); color: var(--muted); font-size: 8px; font-weight: 750; letter-spacing: .02em; text-transform: uppercase; }
    .auto-state.on { background: var(--success-bg); color: var(--success); }
    .section { border-top: 1px solid var(--border); padding-top: 10px; margin-top: 5px; }
    .section-title { color: var(--muted); font-size: 10px; font-weight: 700; letter-spacing: .08em; text-transform: uppercase; display: flex; align-items: center; gap: 6px; padding: 6px 8px; }
    .section-title .section-title-spacer { flex: 1; }
    .root-drop-hint { display: none; color: var(--accent-text); font-size: 9px; font-weight: 650; letter-spacing: 0; text-transform: none; }
    .panel-body.folder-dragging .root-drop-hint { display: inline; }
    [data-drop-root].drag-target { border-radius: 8px; background: var(--active-bg); outline: 2px solid var(--accent); outline-offset: 1px; }
    .folder { margin: 3px 0 7px; }
    .folder-head { display: flex; align-items: center; gap: 6px; min-height: 34px; border-radius: 8px; padding: 0 4px 0 2px; cursor: grab; }
    .folder.dragging { opacity: .48; }
    .folder-head:hover { background: var(--subtle-hover); }
    .folder-toggle { border: 0; background: transparent; flex: 1; min-width: 0; display: flex; align-items: center; gap: 7px; text-align: left; font-size: 12px; font-weight: 620; cursor: pointer; padding: 7px 4px; }
    .folder-toggle span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .folder-toggle .chevron { transition: transform .16s ease; }
    .folder.collapsed .chevron { transform: rotate(-90deg); }
    .folder.collapsed .folder-files { display: none; }
    .folder-children { margin-left: 14px; padding-left: 7px; border-left: 1px solid var(--border); }
    .row-actions { display: flex; align-items: center; gap: 1px; }
    .row-action { width: 27px; height: 27px; border: 0; border-radius: 7px; background: transparent; color: var(--muted); display: grid; place-items: center; cursor: pointer; }
    .row-action:hover { background: var(--surface-2); color: var(--text); }
    .row-action.delete:hover { color: var(--danger); background: var(--danger-soft); }
    .file-row { position: relative; display: flex; align-items: center; gap: 6px; min-height: 40px; margin: 3px 0 3px 11px; border: 1px solid transparent; border-radius: 9px; padding: 0 4px 0 8px; touch-action: pan-y; transition: transform .14s ease, background .14s ease, border-color .14s ease; }
    .file-row:hover { background: var(--surface); }
    .file-row.active { border-color: var(--accent); background: var(--active-bg); box-shadow: inset 3px 0 var(--accent); }
    .file-row.sync-pending { background: var(--warning-bg); border-color: var(--warning-border); }
    .file-row.sync-stale { background: var(--stale-bg); border-color: var(--danger); }
    .file-row.active.sync-pending, .file-row.active.sync-stale { box-shadow: inset 3px 0 currentColor; }
    .file-row.dragging { opacity: .48; }
    .file-row.drag-target, .folder.drag-target > .folder-head { outline: 2px solid var(--accent); outline-offset: 1px; }
    .folder.nest-target > .folder-head { background: var(--active-bg); outline-style: solid; box-shadow: inset 0 0 0 1px var(--accent); }
    .sync-warning { color: var(--warning-border); display: grid; place-items: center; flex: 0 0 auto; }
    .has-tooltip { position: relative; }
    .has-tooltip::after { content: attr(data-tooltip); position: absolute; z-index: 8; left: 50%; bottom: calc(100% + 5px); width: max-content; max-width: 250px; transform: translateX(-50%); padding: 6px 8px; border: 1px solid var(--toast-border); border-radius: 7px; background: var(--toast-bg); color: var(--toast-text); box-shadow: 0 6px 18px var(--panel-shadow); font-size: 10px; line-height: 1.35; text-align: left; white-space: normal; pointer-events: none; opacity: 0; visibility: hidden; transition: opacity .06s linear; }
    .has-tooltip:hover::after, .has-tooltip:focus-visible::after { opacity: 1; visibility: visible; }
    .sync-stale .sync-warning { color: var(--danger); animation: alert-pulse 1.6s infinite; }
    .file-main { border: 0; background: transparent; flex: 1; min-width: 0; display: flex; align-items: center; gap: 7px; text-align: left; cursor: pointer; padding: 7px 0; font-size: 12px; }
    .file-main .file-copy { min-width: 0; }
    .file-main strong { display: block; font-weight: 520; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .file-main small { display: block; margin-top: 1px; color: var(--muted); font-size: 9.5px; }
    .file-main svg { flex: 0 0 auto; color: var(--accent); }
    .pinned { margin: 2px 0 13px; }
    .empty { color: var(--muted); padding: 11px 9px 16px; font-size: 11px; }
    .panel-footer { flex: 0 0 auto; margin-bottom: 44px; border-top: 1px solid var(--border); padding: 10px 14px 12px; color: var(--muted); font-size: 11px; display: flex; align-items: center; gap: 8px; }
    .panel-footer .dot { width: 7px; height: 7px; border-radius: 50%; background: #34d399; }
    .panel-footer.busy .dot { background: #fbbf24; animation: pulse 1s infinite; }
    .panel-footer.pending .dot { background: #f59e0b; }
    .panel-footer.stale .dot { background: var(--danger); animation: alert-pulse 1.6s infinite; }
    @keyframes pulse { 50% { opacity: .35; } }
    @keyframes alert-pulse { 50% { filter: brightness(1.25); } }
    @keyframes launcher-introduction {
      0%, 100% { filter: brightness(1); transform: scale(1); }
      50% { filter: brightness(1.45); transform: scale(1.09); }
    }
    @keyframes spin { to { transform: rotate(360deg); } }
    .manage-title { display: flex; align-items: center; gap: 8px; padding: 2px 2px 11px; }
    .manage-title > div { min-width: 0; flex: 1; }
    .manage-title h2 { font-size: 15px; line-height: 1.2; margin: 0; }
    .settings-subtitle { display: block; margin-top: 2px; color: var(--muted); font-size: 10px; }
    .settings-form { display: grid; gap: 9px; }
    .settings-card { background: var(--surface); border: 1px solid var(--border); border-radius: 12px; padding: 11px; box-shadow: 0 2px 9px rgba(20,20,35,.035); }
    .settings-heading { display: flex; align-items: center; gap: 8px; margin-bottom: 9px; color: var(--muted); }
    .settings-heading > svg { flex: 0 0 auto; color: var(--accent); }
    .settings-heading div { min-width: 0; flex: 1; }
    .settings-heading strong { display: block; color: var(--text); font-size: 12px; font-weight: 680; }
    .settings-heading small { display: block; margin-top: 1px; font-size: 9.5px; line-height: 1.3; }
    .settings-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 7px; }
    .settings-grid .wide { grid-column: 1 / -1; }
    .compact-field { display: grid; gap: 4px; min-width: 0; color: var(--muted); font-size: 10px; }
    .compact-field input, .compact-field select { width: 100%; height: 33px; border: 1px solid var(--border); border-radius: 8px; background: var(--input-bg); color: var(--text); padding: 0 8px; font-size: 11px; }
    .compact-field input:focus, .compact-field select:focus { border-color: var(--accent); outline: 2px solid var(--active-bg); outline-offset: 0; }
    .toggle-row { display: flex; align-items: center; gap: 9px; min-height: 38px; margin-top: 7px; cursor: pointer; }
    .toggle-copy { min-width: 0; flex: 1; }
    .toggle-copy strong { display: block; font-size: 11px; font-weight: 620; }
    .toggle-copy small { display: block; margin-top: 1px; color: var(--muted); font-size: 9.5px; line-height: 1.3; }
    .toggle-row input { position: absolute; opacity: 0; pointer-events: none; }
    .toggle-ui { position: relative; flex: 0 0 auto; width: 31px; height: 18px; border-radius: 99px; background: var(--surface-2); border: 1px solid var(--border); transition: background .16s ease, border-color .16s ease; }
    .toggle-ui::after { content: ""; position: absolute; width: 12px; height: 12px; left: 2px; top: 2px; border-radius: 50%; background: var(--muted); transition: transform .16s ease, background .16s ease; }
    .toggle-row input:checked + .toggle-ui { background: var(--accent-solid); border-color: var(--accent); }
    .toggle-row input:checked + .toggle-ui::after { background: #fff; transform: translateX(13px); }
    .toggle-row input:focus-visible + .toggle-ui { outline: 3px solid #a5b4fc; outline-offset: 2px; }
    .save-summary { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; margin-top: 8px; }
    .status-chip { min-width: 0; padding: 7px 8px; border-radius: 8px; background: var(--input-bg); color: var(--muted); font-size: 9.5px; }
    .status-chip strong { display: block; margin-bottom: 1px; color: var(--text); font-size: 10px; font-weight: 620; }
    .storage-copy { margin: 0; color: var(--muted); font-size: 10px; line-height: 1.45; }
    .storage-copy .vault-path { font-size: 9.5px; }
    .compact-actions { display: flex; align-items: center; gap: 6px; margin-top: 9px; }
    .compact-actions .danger { margin-left: auto; }
    .provider-disclosure { overflow: hidden; border-top: 1px solid var(--border); }
    .provider-disclosure:first-of-type { border-top: 0; }
    .provider-disclosure summary { display: flex; align-items: center; gap: 9px; min-height: 45px; padding: 5px 1px; cursor: pointer; list-style: none; }
    .provider-disclosure summary::-webkit-details-marker { display: none; }
    .provider-summary-copy { min-width: 0; flex: 1; }
    .provider-summary-copy strong { display: block; font-size: 11.5px; font-weight: 650; }
    .provider-summary-copy small { display: block; margin-top: 1px; color: var(--muted); font-size: 9.5px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .provider-disclosure .chevron { color: var(--muted); transition: transform .16s ease; }
    .provider-disclosure[open] .chevron { transform: rotate(180deg); }
    .provider-config { padding: 2px 1px 11px 31px; }
    .provider-config .settings-grid { margin-bottom: 7px; }
    .provider-note { margin: 5px 0 0; color: var(--muted); font-size: 9.5px; line-height: 1.4; }
    .provider-note.error { color: var(--danger); }
    .settings-auto-save { min-height: 18px; margin: 0; color: var(--muted); font-size: 10px; text-align: center; }
    .settings-auto-save[data-state="saving"] { color: var(--accent-link); }
    .settings-auto-save[data-state="error"] { color: var(--danger); }
    .card { background: var(--surface); border: 1px solid var(--border); border-radius: 13px; padding: 13px; margin: 0 0 10px; box-shadow: 0 4px 14px rgba(20,20,35,.04); }
    .card-head { display: flex; align-items: center; gap: 9px; margin-bottom: 12px; }
    .card-head strong { flex: 1; font-size: 13px; }
    .badge { border-radius: 99px; padding: 3px 7px; background: var(--badge-bg); color: var(--muted); font-size: 10px; text-transform: uppercase; letter-spacing: .05em; }
    .badge.connected { background: var(--success-bg); color: var(--success); }
    .provider-title { min-width: 0; flex: 1; display: flex; align-items: center; gap: 9px; }
    .provider-title strong { flex: 0 1 auto; }
    .provider-icon { flex: 0 0 auto; display: block; }
    .provider-icon.github { color: var(--text); }
    .field { display: block; margin: 10px 0; }
    .field > span { display: block; color: var(--text); font-size: 12px; margin-bottom: 5px; }
    .field input:not([type="checkbox"]), .field select { width: 100%; height: 36px; border: 1px solid var(--border); border-radius: 8px; background: var(--input-bg); color: var(--text); padding: 0 9px; }
    .field input[type="checkbox"] { width: 16px; height: 16px; margin: 0 7px 0 0; vertical-align: -3px; accent-color: var(--accent-solid); }
    .field-help { color: var(--muted); font-size: 11px; margin: -3px 0 10px; }
    .button-row { display: flex; gap: 7px; flex-wrap: wrap; margin-top: 12px; }
    .button { min-height: 35px; border: 1px solid var(--border); background: var(--surface-2); border-radius: 8px; padding: 0 10px; cursor: pointer; display: inline-flex; align-items: center; justify-content: center; gap: 6px; font-size: 12px; }
    .button:hover { border-color: var(--hover-border); }
    .button.primary { background: var(--accent-solid); border-color: var(--accent); color: white; }
    .button.danger { color: var(--danger); }
    .button.provider-button { display: inline-flex; align-items: center; gap: 7px; }
    .button:disabled { opacity: .55; cursor: wait; }
    .provider-status { font-size: 11px; color: var(--muted); margin-top: 9px; overflow-wrap: anywhere; }
    .provider-status.error { color: var(--danger); }
    .notification-list { display: grid; gap: 9px; }
    .notification-item { display: grid; grid-template-columns: 24px 1fr; gap: 10px; padding: 12px; border: 1px solid var(--border); border-radius: 11px; background: var(--surface); }
    .notification-item.pending { border-color: #d99b22; }
    .notification-item.stale, .notification-item.error { border-color: var(--danger); }
    .notification-item svg { margin-top: 1px; }
    .notification-copy strong { display: block; font-size: 13px; }
    .notification-copy span { display: block; color: var(--muted); font-size: 11px; margin-top: 2px; }
    .notification-copy time { display: block; color: var(--muted); font-size: 9.5px; margin-top: 5px; }
    .trash-list { display: grid; gap: 7px; }
    .trash-item { display: grid; grid-template-columns: 30px minmax(0, 1fr) auto; align-items: center; gap: 9px; padding: 10px; border: 1px solid var(--border); border-radius: 10px; background: var(--surface); }
    .trash-item-icon { width: 30px; height: 30px; display: grid; place-items: center; border-radius: 8px; background: var(--danger-soft); color: var(--danger); }
    .trash-item-copy { min-width: 0; }
    .trash-item-copy strong { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 11.5px; }
    .trash-item-copy small { display: block; margin-top: 2px; color: var(--muted); font-size: 9.5px; }
    .trash-item.folder-backup { display: block; }
    .trash-tree { display: grid; gap: 5px; }
    .trash-tree-children { margin-left: 15px; padding-left: 8px; border-left: 1px solid var(--border); }
    .trash-tree-row { display: grid; grid-template-columns: 24px minmax(0, 1fr) auto; align-items: center; gap: 7px; min-height: 34px; }
    .trash-tree-row + .trash-tree-children { margin-top: 3px; }
    .trash-tree-row .trash-item-icon { width: 24px; height: 24px; border-radius: 7px; }
    .trash-tree-row .button { min-height: 29px; padding: 0 8px; font-size: 10px; }
    .setup-guide { margin-top: 9px; border: 1px solid var(--border); border-radius: 9px; background: var(--subtle-hover); }
    .setup-guide summary { cursor: pointer; padding: 8px 10px; color: var(--accent-link); font-size: 11px; font-weight: 650; }
    .setup-guide ol { margin: 0; padding: 0 12px 10px 29px; color: var(--muted); font-size: 10.5px; }
    .setup-guide li + li { margin-top: 5px; }
    .vault-path { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; color: var(--accent-link); }
    .device-code { margin: 10px 0; padding: 12px; border: 1px dashed var(--accent); border-radius: 9px; text-align: center; background: var(--active-bg); }
    .device-code strong { display: block; font-size: 24px; letter-spacing: .12em; color: var(--accent-text); }
    .text-link { color: var(--accent-link); text-decoration: none; }
    .text-link:hover { text-decoration: underline; }
    .dialog-layer { position: fixed; inset: 0; z-index: 2147483001; display: grid; place-items: center; padding: 20px; background: var(--overlay); font-family: ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; color: var(--text); }
    .dialog { width: min(390px, 94vw); border: 1px solid var(--border); border-radius: 15px; background: var(--dialog-bg); padding: 19px; box-shadow: 0 22px 75px var(--dialog-shadow); color-scheme: inherit; }
    .dialog h2 { margin: 0 0 7px; font-size: 19px; }
    .dialog p { color: var(--muted); margin: 0 0 14px; font-size: 14px; }
    .dialog .field input, .dialog .field select { background: var(--dialog-input); }
    .dialog-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 18px; }
    .menu-root { position: fixed; inset: 0; z-index: 2147483001; pointer-events: none; }
    .action-dropdown { position: fixed; min-width: 190px; max-width: min(260px, calc(100vw - 16px)); padding: 5px; border: 1px solid var(--border); border-radius: 10px; background: var(--dialog-bg); box-shadow: 0 14px 38px var(--dialog-shadow); color: var(--text); pointer-events: auto; font: 11px/1.35 Inter, ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    .action-dropdown button { width: 100%; min-height: 34px; display: flex; align-items: center; gap: 9px; border: 0; border-radius: 7px; background: transparent; color: inherit; padding: 7px 9px; text-align: left; cursor: pointer; }
    .action-dropdown button:hover, .action-dropdown button:focus-visible { background: var(--surface-2); }
    .action-dropdown button.danger { color: var(--danger); }
    .toast { position: fixed; left: 50%; bottom: 24px; z-index: 2147483002; transform: translate(-50%, 18px); opacity: 0; max-width: min(430px, 88vw); border: 1px solid var(--toast-border); border-radius: 10px; background: var(--toast-bg); color: var(--toast-text); padding: 10px 14px; box-shadow: 0 12px 34px var(--panel-shadow); font: 13px/1.4 ui-sans-serif, -apple-system, sans-serif; transition: opacity .18s ease, transform .18s ease; }
    .toast.show { opacity: 1; transform: translate(-50%, 0); }
    .toast.error { border-color: var(--error-border); }
    @media (max-width: 600px) {
      .launcher { right: 8px; top: 70px; width: 60px; min-width: 60px; max-width: 60px; height: 58px; min-height: 58px; max-height: 58px; }
      .panel { width: min(350px, 94vw); }
      .row-action { width: 34px; height: 34px; }
    }
    @media (prefers-reduced-motion: reduce) {
      *, *::before, *::after { transition: none !important; animation: none !important; }
      .launcher.needs-introduction { filter: brightness(1.3); outline: 5px solid rgba(124,120,236,.62); outline-offset: 4px; }
    }
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
    <button class="launcher" type="button" aria-label="Open ExcaliSync. Drag to move." aria-keyshortcuts="Alt+ArrowLeft Alt+ArrowRight Alt+ArrowUp Alt+ArrowDown" title="Drag to move · Click to open">${icon("logo", 24)}<span class="launcher-label">ExcaliSync</span></button>
    <div class="backdrop" aria-hidden="true"></div>
    <aside class="panel collapsed" aria-label="Excalidraw Sync sidebar">
      <div class="collapsed-brand" aria-hidden="true">${icon("logo", 22)}<span>ExcaliSync</span></div>
      <button class="sidebar-toggle" type="button" data-action="toggle-sidebar" aria-label="Expand sidebar" aria-expanded="false" title="Expand sidebar">${icon("chevron", 18)}<span class="sidebar-toggle-label">Collapse</span></button>
      <header class="panel-header"></header>
      <main class="panel-body"></main>
      <footer class="panel-footer"><span class="dot"></span><span class="footer-status">Saved locally</span></footer>
    </aside>
    <div class="menu-root"></div>
    <div class="modal-root"></div>
    <div class="toast" role="status" aria-live="polite"></div>
    <input class="file-picker" type="file" accept=".excalidraw,application/json" multiple hidden>
  `);
  const styleElement = document.createElement("style");
  styleElement.textContent = styles;
  shadow.prepend(styleElement);

  const hostStyleElement = document.createElement("style");
  hostStyleElement.id = "excalidraw-sync-host-styles";
  hostStyleElement.textContent = `
    .excalidraw .layer-ui__wrapper__footer-left,
    .excalidraw .App-menu_top > .App-menu_top__left {
      margin-left: var(--excalidraw-sync-left-offset, 0px) !important;
      transition: margin-left .23s cubic-bezier(.2,.7,.2,1);
    }
  `;
  (document.head || document.documentElement).append(hostStyleElement);

  const elements = {
    launcher: shadow.querySelector(".launcher"),
    backdrop: shadow.querySelector(".backdrop"),
    panel: shadow.querySelector(".panel"),
    header: shadow.querySelector(".panel-header"),
    body: shadow.querySelector(".panel-body"),
    footer: shadow.querySelector(".panel-footer"),
    footerStatus: shadow.querySelector(".footer-status"),
    menuRoot: shadow.querySelector(".menu-root"),
    modalRoot: shadow.querySelector(".modal-root"),
    toast: shadow.querySelector(".toast"),
    filePicker: shadow.querySelector(".file-picker"),
  };

  function showToast(message, type = "info") {
    elements.toast.textContent = t(message);
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
    elements.footerStatus.textContent = t(state.status);
    for (const button of shadow.querySelectorAll("[data-action='sync']")) {
      button.classList.toggle("syncing", busy && state.status === "Syncing…");
      button.disabled = busy && state.status === "Syncing…";
    }
  }

  function hasConnectedCloud() {
    const authority = state.providers?.syncAuthority;
    return Boolean(authority && authority !== "local" && state.providers?.[authority]?.connected);
  }

  function formatRelativeTime(dateValue) {
    return ExcalidrawSyncI18n.formatRelativeTime(dateValue, state.language);
  }

  function saveHealth() {
    const health = ExcalidrawSyncUIEvents.getSaveHealth({
      dirtySince: state.dirtySince,
      unsyncedSince: hasConnectedCloud() ? state.unsyncedSince : null,
      staleMinutes: state.saveSettings.staleMinutes,
    });
    return health;
  }

  function healthMessage(health = saveHealth()) {
    if (health.kind === "error") {
      return "Save or sync needs attention";
    }
    if (health.kind === "unsaved") {
      return health.level === "stale"
        ? `Changes have not been saved for ${Math.max(1, Math.floor(health.ageMs / 60_000))} minutes`
        : "Unsaved changes";
    }
    if (health.kind === "unsynced") {
      return health.level === "stale"
        ? `Local changes have not synced for ${Math.max(1, Math.floor(health.ageMs / 60_000))} minutes`
        : "Saved locally · Cloud sync pending";
    }
    return `Saved ${formatRelativeTime(state.lastSavedAt)}`;
  }

  function currentNotifications() {
    const result = [...state.notifications];
    const health = saveHealth();
    if (health.kind) {
      result.unshift({
        id: `health-${health.kind}`,
        level: health.level,
        title: health.kind === "unsaved" ? "Drawing has unsaved changes" : "Cloud sync is pending",
        message: healthMessage(health),
      });
    }
    return result;
  }

  function persistNotifications() {
    void storageSet(NOTIFICATIONS_KEY, state.notifications).catch(() => {});
  }

  function markNotificationsRead() {
    const readAt = ExcalidrawSyncCore.nowIso();
    state.notifications = state.notifications.map((item) => item.readAt ? item : { ...item, readAt });
    persistNotifications();
  }

  function addNotification(level, title, message) {
    const duplicate = state.notifications.find((item) => item.title === title && item.message === message);
    if (!duplicate) {
      state.notifications.unshift({ id: ExcalidrawSyncCore.makeId("notification"), level, title, message, createdAt: ExcalidrawSyncCore.nowIso(), readAt: null });
      state.notifications = state.notifications.slice(0, 20);
      persistNotifications();
    }
  }

  function recordError(context, error) {
    void sendMessage({
      type: "native:logError",
      error: {
        context,
        message: String(error?.message || error),
        extensionVersion: extensionApi.runtime.getManifest().version,
      },
    }).catch(() => {});
  }

  async function persistSaveState() {
    await storageSet(SAVE_STATE_KEY, {
      lastSavedAt: state.lastSavedAt,
      lastSyncedAt: state.lastSyncedAt,
      unsyncedSince: state.unsyncedSince,
    });
  }

  function updateSaveIndicators({ rerenderHeader = true } = {}) {
    const health = saveHealth();
    state.status = healthMessage(health);
    elements.footerStatus.textContent = t(state.status);
    elements.footer.classList.toggle("pending", health.level === "pending");
    elements.footer.classList.toggle("stale", health.level === "stale");
    elements.launcher.setAttribute("aria-label", health.level === "ok"
      ? "Open ExcaliSync. Drag to move."
      : `Open ExcaliSync. ${state.status}. Drag to move.`);
    const syncRow = elements.body.querySelector(".sync-row");
    if (syncRow) {
      syncRow.classList.toggle("pending", health.level === "pending");
      syncRow.classList.toggle("stale", health.level === "stale");
      const label = syncRow.querySelector("span");
      if (label) label.textContent = state.status;
    }
    updateFileSyncIndicators();
    const providerStatus = elements.body.querySelector(".cloud-status");
    if (providerStatus) {
      replaceMarkup(providerStatus, providerHomeStatus());
    }
    if (rerenderHeader && state.workspace) {
      renderHeader();
    }
  }

  function setOpen(open, { home = false, acknowledge = false } = {}) {
    if (open && home) {
      state.view = ExcalidrawSyncUIEvents.sidebarViewForOpen();
      state.query = "";
    }
    if (open && acknowledge) {
      acknowledgeLauncherIntroduction();
    }
    state.open = open;
    updateExcalidrawControlsOffset();
    elements.panel.classList.toggle("open", open);
    elements.panel.classList.toggle("collapsed", !open);
    elements.backdrop.classList.toggle("open", open);
    elements.launcher.classList.toggle("is-hidden", open);
    const sidebarToggle = elements.panel.querySelector("[data-action='toggle-sidebar']");
    const sidebarToggleLabel = state.open ? "Collapse sidebar" : "Expand sidebar";
    sidebarToggle?.setAttribute("aria-label", t(sidebarToggleLabel));
    sidebarToggle?.setAttribute("title", t(sidebarToggleLabel));
    sidebarToggle?.setAttribute("aria-expanded", String(state.open));
    if (open) {
      render();
      requestAnimationFrame(() => elements.panel.querySelector("button, input")?.focus());
    }
  }

  function applyTheme(value) {
    state.theme = ExcalidrawSyncUIEvents.normalizeTheme(value);
    if (state.theme === "excalidraw") {
      syncThemeWithExcalidraw();
    } else {
      rootHost.dataset.theme = state.theme;
    }
    return state.theme;
  }

  function syncThemeWithExcalidraw() {
    if (state.theme !== "excalidraw") return;
    rootHost.dataset.theme = ExcalidrawSyncUIEvents.excalidrawThemeFromClassName(
      document.querySelector(".excalidraw")?.className,
    );
  }

  ExcalidrawSyncUIEvents.observeExcalidrawTheme({
    documentRoot: document,
    MutationObserverCtor: MutationObserver,
    onTheme: (theme) => {
      if (state.theme === "excalidraw") rootHost.dataset.theme = theme;
    },
  });

  function applyLauncherVisibility(visible) {
    state.launcherVisible = visible !== false;
    elements.launcher.classList.toggle("user-hidden", !state.launcherVisible);
    updateLauncherIntroduction();
    return state.launcherVisible;
  }

  function applySidebarRailVisibility(hidden) {
    state.sidebarRailHidden = hidden === true;
    elements.panel.classList.toggle("rail-hidden", state.sidebarRailHidden);
    updateExcalidrawControlsOffset();
    return state.sidebarRailHidden;
  }

  function updateExcalidrawControlsOffset() {
    const offset = ExcalidrawSyncUIEvents.excalidrawControlsOffset({
      open: state.open,
      railHidden: state.sidebarRailHidden,
    });
    document.documentElement.style.setProperty("--excalidraw-sync-left-offset", offset);
  }

  updateExcalidrawControlsOffset();

  function updateLauncherIntroduction() {
    const highlighted = ExcalidrawSyncUIEvents.shouldHighlightLauncher({
      introduced: state.launcherIntroduced,
      visible: state.launcherVisible,
    });
    elements.launcher.classList.toggle("needs-introduction", highlighted);
    elements.launcher.title = highlighted
      ? "New: click to open ExcaliSync · Drag to move"
      : "Drag to move · Click to open";
    if (highlighted) {
      elements.launcher.setAttribute("aria-description", "New extension. Open it once to dismiss this highlight.");
    } else {
      elements.launcher.removeAttribute("aria-description");
    }
  }

  function acknowledgeLauncherIntroduction() {
    if (state.launcherIntroduced) return;
    state.launcherIntroduced = true;
    updateLauncherIntroduction();
    void storageSet(LAUNCHER_INTRODUCED_KEY, true).catch(() => {});
  }

  function launcherSize() {
    const bounds = elements.launcher.getBoundingClientRect();
    const fallbackWidth = window.innerWidth <= 600 ? 60 : 64;
    const fallbackHeight = window.innerWidth <= 600 ? 58 : 62;
    return {
      width: bounds.width || fallbackWidth,
      height: bounds.height || fallbackHeight,
    };
  }

  function defaultLauncherPosition() {
    const size = launcherSize();
    return ExcalidrawSyncUIEvents.clampLauncherPosition(
      { x: window.innerWidth - size.width - 12, y: 70 },
      { width: window.innerWidth, height: window.innerHeight },
      size,
    );
  }

  function startupLauncherPosition(savedPosition) {
    const legacyTopRight = savedPosition
      && Number(savedPosition.y) <= 20
      && Number(savedPosition.x) >= window.innerWidth - 240;
    return !savedPosition || legacyTopRight ? defaultLauncherPosition() : savedPosition;
  }

  function applyLauncherPosition(position) {
    const next = ExcalidrawSyncUIEvents.clampLauncherPosition(
      position,
      { width: window.innerWidth, height: window.innerHeight },
      launcherSize(),
    );
    state.launcherPosition = next;
    ExcalidrawSyncUIEvents.positionLauncherElement(elements.launcher, next);
    return next;
  }

  function rememberLauncherPosition(position) {
    void storageSet(LAUNCHER_POSITION_KEY, position).catch(() => {
      showToast("Could not remember the icon position.", "error");
    });
  }

  const launcherDrag = ExcalidrawSyncUIEvents.attachDraggableLauncher(elements.launcher, {
    getPosition: () => state.launcherPosition,
    getViewport: () => ({ width: window.innerWidth, height: window.innerHeight }),
    getSize: launcherSize,
    onMove: applyLauncherPosition,
    onCommit: rememberLauncherPosition,
    onActivate: () => setOpen(true, { home: true, acknowledge: true }),
  });

  let launcherResizeTimer = null;
  window.addEventListener("resize", () => {
    clearTimeout(launcherResizeTimer);
    launcherResizeTimer = setTimeout(() => {
      const next = launcherDrag.constrain(state.launcherPosition);
      if (next.x !== state.launcherPosition.x || next.y !== state.launcherPosition.y) {
        applyLauncherPosition(next);
        rememberLauncherPosition(next);
      }
    }, 100);
  });

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

  function openDurableBackupDatabase() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DURABLE_BACKUP_DB, 1);
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains(DURABLE_BACKUP_STORE)) {
          request.result.createObjectStore(DURABLE_BACKUP_STORE);
        }
      };
      request.onerror = () => reject(request.error || new Error("Could not open the reinstall recovery backup."));
      request.onsuccess = () => resolve(request.result);
    });
  }

  async function readDurableWorkspaceBackup() {
    const database = await openDurableBackupDatabase();
    try {
      return await new Promise((resolve, reject) => {
        const request = database
          .transaction(DURABLE_BACKUP_STORE, "readonly")
          .objectStore(DURABLE_BACKUP_STORE)
          .get(DURABLE_BACKUP_KEY);
        request.onsuccess = () => resolve(request.result || null);
        request.onerror = () => reject(request.error || new Error("Could not read the reinstall recovery backup."));
      });
    } finally {
      database.close();
    }
  }

  async function writeDurableWorkspaceBackup(workspace) {
    const database = await openDurableBackupDatabase();
    try {
      await new Promise((resolve, reject) => {
        const transaction = database.transaction(DURABLE_BACKUP_STORE, "readwrite");
        transaction.objectStore(DURABLE_BACKUP_STORE).put(workspace, DURABLE_BACKUP_KEY);
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error || new Error("Could not update the reinstall recovery backup."));
        transaction.onabort = () => reject(transaction.error || new Error("Could not update the reinstall recovery backup."));
      });
    } finally {
      database.close();
    }
  }

  async function deleteDurableWorkspaceBackup() {
    const database = await openDurableBackupDatabase();
    try {
      await new Promise((resolve, reject) => {
        const transaction = database.transaction(DURABLE_BACKUP_STORE, "readwrite");
        transaction.objectStore(DURABLE_BACKUP_STORE).delete(DURABLE_BACKUP_KEY);
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error || new Error("Could not delete the reinstall recovery backup."));
        transaction.onabort = () => reject(transaction.error || new Error("Could not delete the reinstall recovery backup."));
      });
    } finally {
      database.close();
    }
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

  async function applySceneInPlace(sceneInput) {
    const scene = ExcalidrawSyncCore.normalizeScene(sceneInput);
    await writeSceneFiles(scene.files);
    const blobUrl = URL.createObjectURL(new Blob([JSON.stringify(scene)], { type: "application/json" }));
    localStorage.setItem("excalidraw", "[]");
    localStorage.setItem("excalidraw-state", "{}");
    const version = JSON.stringify(Date.now());
    localStorage.setItem("version-dataState", version);
    localStorage.setItem("version-files", version);
    window.location.hash = `url=${encodeURIComponent(blobUrl)}`;
    await new Promise((resolve) => window.setTimeout(resolve, 300));
    URL.revokeObjectURL(blobUrl);
    await applyScene(scene);
    state.lastBrowserFingerprint = browserFingerprint();
  }

  async function persistLocalVault() {
    await storageSet(LOCAL_VAULT_KEY, ExcalidrawSyncCore.buildLocalVault(state.workspace));
  }

  async function persistWorkspace({ sync = true } = {}) {
    state.workspace = ExcalidrawSyncCore.purgeExpiredTrash(state.workspace);
    state.workspace.updatedAt = ExcalidrawSyncCore.nowIso();
    await storageSet(WORKSPACE_KEY, state.workspace);
    await writeDurableWorkspaceBackup(state.workspace).catch((error) => {
      addNotification("error", "Reinstall backup needs attention", error.message);
    });
    await persistLocalVault();
    try {
      const nativeResult = await sendMessage({ type: "native:syncWorkspace", workspace: state.workspace });
      state.nativeStorage = { available: true, root: nativeResult.root };
    } catch (error) {
      state.nativeStorage.available = false;
      addNotification("error", "Local disk helper needs attention", "Install or reconnect the ExcaliSync native helper to write ~/.excalidraw-sync.");
      recordError("native-storage-sync", error);
    }
    state.lastSavedAt = state.workspace.updatedAt;
    state.dirtySince = null;
    if (hasConnectedCloud()) {
      state.unsyncedSince ||= state.lastSavedAt;
    }
    await persistSaveState();
    updateSaveIndicators({ rerenderHeader: false });
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
      state.dirtySince = null;
      updateSaveIndicators();
      return false;
    }
    file.scene = scene;
    file.hash = hash;
    file.updatedAt = ExcalidrawSyncCore.nowIso();
    await persistWorkspace({ sync });
    return true;
  }

  function scheduleCloudSync(delayMs = state.saveSettings.syncDelaySeconds * 1000) {
    clearTimeout(state.syncTimer);
    if (!hasConnectedCloud()) {
      return;
    }
    state.syncTimer = setTimeout(() => syncNow({ quiet: true }), delayMs);
  }

  async function syncNow({ quiet = false } = {}) {
    if (state.busy) {
      return;
    }
    setBusy(true, "Syncing…");
    try {
      await captureAndSaveActive({ sync: false });
      const previousActive = state.workspace.files.find((file) => file.id === state.workspace.activeFileId);
      const previousActiveId = state.workspace.activeFileId;
      const previousActiveHash = previousActive?.hash;
      const result = await sendMessage({ type: "sync:workspace", workspace: state.workspace });
      state.providers = result.providers;
      if (result.workspace) {
        state.workspace = ExcalidrawSyncCore.normalizeWorkspace(result.workspace);
        ensureWorkspaceHasFile();
        const mergedActive = state.workspace.files.find((file) => file.id === state.workspace.activeFileId);
        const remoteSceneChanged = previousActiveId !== state.workspace.activeFileId
          || previousActiveHash !== mergedActive?.hash;
        await persistWorkspace({ sync: false });
        if (remoteSceneChanged && mergedActive) {
          await applySceneInPlace(mergedActive.scene);
        }
      }
      const retryableFailure = [result.result.github, result.result.googleDrive]
        .find((providerResult) => providerResult?.retryable);
      if (retryableFailure) {
        state.status = retryableFailure.message || "Cloud changed remotely · retrying…";
        state.unsyncedSince ||= ExcalidrawSyncCore.nowIso();
        await persistSaveState();
        scheduleCloudSync(5000);
        if (!quiet) showToast(state.status);
        return;
      }
      const errors = [result.result.github?.error, result.result.googleDrive?.error].filter(Boolean);
      if (errors.length) {
        throw new Error(errors.join(" "));
      }
      if (hasConnectedCloud()) {
        state.lastSyncedAt = ExcalidrawSyncCore.nowIso();
        for (const file of state.workspace.files) {
          file.syncedAt = state.lastSyncedAt;
        }
        state.unsyncedSince = null;
        await storageSet(WORKSPACE_KEY, state.workspace);
        await persistLocalVault();
      }
      await persistSaveState();
      updateSaveIndicators({ rerenderHeader: false });
      if (!quiet) {
        showToast(hasConnectedCloud() ? "Your drawings are up to date." : "Saved locally.");
      }
    } catch (error) {
      if (ExcalidrawSyncUIEvents.isExtensionContextInvalidated(error)) {
        await recoverInvalidatedContext(error);
        return;
      }
      state.status = "Sync needs attention";
      addNotification("error", "Cloud sync needs attention", error.message);
      recordError("cloud-sync", error);
      updateSaveIndicators({ rerenderHeader: false });
      if (!quiet) {
        showToast(error.message, "error");
      }
    } finally {
      setBusy(false, state.status);
      if (state.open && (state.view === "files" || state.view === "manage")) {
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
        parentId: null,
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
    const currentFileId = state.workspace.activeFileId;
    setBusy(true, "Saving current file…");
    try {
      await new Promise((resolve) => setTimeout(resolve, 380));
      await captureAndSaveActive({ sync: false, force: true });
      state.workspace.activeFileId = next.id;
      await persistWorkspace({ sync: false });
      await applySceneInPlace(next.scene);
      scheduleCloudSync();
      state.status = "Saved locally";
      setBusy(false, state.status);
      setOpen(true);
      render();
    } catch (error) {
      if (ExcalidrawSyncUIEvents.isExtensionContextInvalidated(error)) {
        await recoverInvalidatedContext(error, { switchToFileId: fileId, currentFileId });
        return;
      }
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
                      : `<input type="${escapeHtml(field.type || "text")}" name="${escapeHtml(field.name)}" value="${escapeHtml(field.value || "")}" placeholder="${escapeHtml(field.placeholder || "")}" ${field.required ? "required" : ""} maxlength="${escapeHtml(field.maxLength || 120)}">`
                  }
                </label>`,
            )
            .join("")}
          <div class="dialog-actions">
            <button class="button cancel" type="button">Cancel</button>
            <button class="button ${danger ? "danger" : "primary"}" type="submit">${escapeHtml(confirmLabel)}</button>
          </div>
        </form>`);
      localizeUi(layer);
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

  function dismissActionDropdown(value = null) {
    const menu = elements.menuRoot.firstElementChild;
    if (!menu) return;
    menu._cleanup?.();
    menu._anchor?.setAttribute("aria-expanded", "false");
    menu.remove();
    menu._resolve?.(value);
  }

  function showActionDropdown(anchor, { label, actions }) {
    dismissActionDropdown();
    return new Promise((resolve) => {
      const menu = document.createElement("div");
      menu.className = "action-dropdown";
      menu.setAttribute("role", "menu");
      menu.setAttribute("aria-label", label);
      menu._resolve = resolve;
      menu._anchor = anchor;
      replaceMarkup(menu, actions.map((action) => `<button class="${action.danger ? "danger" : ""}" type="button" role="menuitem" data-menu-action="${escapeHtml(action.value)}">${icon(action.icon, 16)} <span>${escapeHtml(action.label)}</span></button>`).join(""));
      localizeUi(menu);
      elements.menuRoot.append(menu);
      anchor.setAttribute("aria-haspopup", "menu");
      anchor.setAttribute("aria-expanded", "true");
      const anchorBounds = anchor.getBoundingClientRect();
      const menuBounds = menu.getBoundingClientRect();
      const left = Math.min(window.innerWidth - menuBounds.width - 8, Math.max(8, anchorBounds.right - menuBounds.width));
      const below = anchorBounds.bottom + 4;
      const top = below + menuBounds.height <= window.innerHeight - 8
        ? below
        : Math.max(8, anchorBounds.top - menuBounds.height - 4);
      menu.style.left = `${Math.round(left)}px`;
      menu.style.top = `${Math.round(top)}px`;
      const closeFromOutside = (event) => {
        const path = event.composedPath();
        if (!path.includes(menu) && !path.includes(anchor)) dismissActionDropdown();
      };
      const handleKeys = (event) => {
        const items = [...menu.querySelectorAll('[role="menuitem"]')];
        const index = items.indexOf(shadow.activeElement);
        if (event.key === "Escape") {
          event.preventDefault();
          dismissActionDropdown();
          anchor.focus();
        } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
          event.preventDefault();
          const offset = event.key === "ArrowDown" ? 1 : -1;
          items[(index + offset + items.length) % items.length]?.focus();
        }
      };
      menu._cleanup = () => {
        document.removeEventListener("pointerdown", closeFromOutside, true);
        menu.removeEventListener("keydown", handleKeys);
      };
      document.addEventListener("pointerdown", closeFromOutside, true);
      menu.addEventListener("keydown", handleKeys);
      menu.addEventListener("click", (event) => {
        const action = event.target.closest("[data-menu-action]");
        if (action) dismissActionDropdown(action.dataset.menuAction);
      });
      requestAnimationFrame(() => menu.querySelector("button")?.focus());
    });
  }

  async function openFolderSectionMenu(anchor) {
    const action = await showActionDropdown(anchor, {
      label: "Folder actions",
      actions: [
        { value: "new-file", label: "New file", icon: "file" },
        { value: "new-folder", label: "New folder", icon: "folder" },
        { value: "import-file", label: "Import from file", icon: "import" },
        { value: "import-link", label: "Import from link", icon: "link" },
        { value: "sort", label: "Order folders and files", icon: "more" },
      ],
    });
    if (action === "new-file") await createFile();
    if (action === "new-folder") await createFolder();
    if (action === "import-file") {
      state.importFolderId = null;
      elements.filePicker.click();
    }
    if (action === "import-link") await importSharedLink();
    if (action === "sort") await chooseSortMode();
  }

  async function openFolderMenu(folderId, anchor) {
    const folder = state.workspace.folders.find((item) => item.id === folderId);
    if (!folder) return;
    const action = await showActionDropdown(anchor, {
      label: `Actions for ${folder.name}`,
      actions: [
        { value: "add", label: "New file", icon: "plus" },
        { value: "subfolder", label: "New subfolder", icon: "folder" },
        { value: "move", label: "Move folder", icon: "folder" },
        { value: "rename", label: "Rename folder", icon: "edit" },
        { value: "delete", label: "Delete folder", icon: "trash", danger: true },
      ],
    });
    if (action === "add") await createFile(folderId);
    if (action === "subfolder") await createFolder(folderId);
    if (action === "move") await moveFolderToParent(folderId);
    if (action === "rename") await renameEntry("folder", folderId);
    if (action === "delete") await confirmDelete("folder", folderId);
  }

  function folderLabel(folderId) {
    const foldersById = new Map(state.workspace.folders.map((folder) => [folder.id, folder]));
    const labels = [];
    const seen = new Set();
    let folder = foldersById.get(folderId);
    while (folder && !seen.has(folder.id)) {
      seen.add(folder.id);
      labels.unshift(folder.name);
      folder = foldersById.get(folder.parentId);
    }
    return labels.join(" / ");
  }

  function folderOptions({ excludeId = null, includeRoot = false } = {}) {
    const excluded = new Set();
    if (excludeId) {
      excluded.add(excludeId);
      let changed = true;
      while (changed) {
        changed = false;
        for (const folder of state.workspace.folders) {
          if (folder.parentId && excluded.has(folder.parentId) && !excluded.has(folder.id)) {
            excluded.add(folder.id);
            changed = true;
          }
        }
      }
    }
    return [
      ...(includeRoot ? [{ value: "", label: "Top level" }] : []),
      ...state.workspace.folders
        .filter((folder) => !excluded.has(folder.id))
        .map((folder) => ({ value: folder.id, label: folderLabel(folder.id) })),
    ];
  }

  async function moveFolderToParent(folderId) {
    const folder = state.workspace.folders.find((item) => item.id === folderId);
    if (!folder) return;
    const result = await showFormDialog({
      title: "Move folder",
      fields: [{
        name: "parentId",
        label: "Parent folder",
        type: "select",
        value: folder.parentId || "",
        options: folderOptions({ excludeId: folderId, includeRoot: true }),
      }],
      confirmLabel: "Move",
    });
    if (!result) return;
    state.workspace = ExcalidrawSyncCore.moveFolderToParent(state.workspace, folderId, result.parentId || null);
    await persistWorkspace();
    render();
  }

  async function editFileDetails(fileId) {
    const file = state.workspace.files.find((item) => item.id === fileId);
    if (!file) return;
    const result = await showFormDialog({
      title: "File details",
      fields: [
        {
          name: "folderId", label: "Folder", type: "select", value: file.folderId,
          options: folderOptions(),
        },
        { name: "name", label: "File name", value: file.name, required: true },
      ],
      confirmLabel: "Save",
    });
    if (!result) return;
    file.folderId = result.folderId;
    file.name = result.name.trim() || file.name;
    file.updatedAt = ExcalidrawSyncCore.nowIso();
    await persistWorkspace();
    render();
  }

  async function openFileMenu(fileId, anchor) {
    const file = state.workspace.files.find((item) => item.id === fileId);
    if (!file) return;
    const action = await showActionDropdown(anchor, {
      label: `Actions for ${file.name}`,
      actions: [
        { value: "details", label: "File details", icon: "edit" },
        { value: "share", label: "Copy read-only link", icon: "link" },
        { value: "pin", label: file.pinned ? "Unpin file" : "Pin file", icon: "pin" },
        { value: "delete", label: "Delete file", icon: "trash", danger: true },
      ],
    });
    if (action === "details") await editFileDetails(fileId);
    if (action === "share") await copyShareLink(fileId);
    if (action === "pin") {
      file.pinned = !file.pinned;
      file.updatedAt = ExcalidrawSyncCore.nowIso();
      await persistWorkspace();
      render();
    }
    if (action === "delete") await confirmDelete("file", fileId);
  }

  async function createFile(folderId = null) {
    const folders = state.workspace.folders;
    if (!folders.length) {
      await createFolder();
    }
    const result = await showFormDialog({
      title: "New file",
      fields: [
        { name: "name", label: "File name", value: "", placeholder: "New File", required: true },
        {
          name: "folderId",
          label: "Folder",
          type: "select",
          value: folderId || state.workspace.folders[0]?.id,
          options: folderOptions(),
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

  async function createFolder(parentId = null) {
    const result = await showFormDialog({
      title: "New folder",
      fields: [
        { name: "name", label: "Folder name", value: "", placeholder: "New Folder", required: true },
        {
          name: "parentId", label: "Parent folder", type: "select", value: parentId || "",
          options: folderOptions({ includeRoot: true }),
        },
      ],
      confirmLabel: "Create folder",
    });
    if (!result) {
      return null;
    }
    const now = ExcalidrawSyncCore.nowIso();
    const folder = {
      id: ExcalidrawSyncCore.makeId("folder"),
      parentId: result.parentId || null,
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
      ? `Move “${entry.name}” and its ${childCount} file${childCount === 1 ? "" : "s"} to Trash? They are kept for 30 days.`
      : `Move “${entry.name}” to Trash? It is kept for 30 days.`;
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
    state.workspace = ExcalidrawSyncCore.trashEntry(state.workspace, kind, id);
    ensureWorkspaceHasFile();
    const activeChanged = activeBefore !== state.workspace.activeFileId;
    await persistWorkspace();
    render();
    showToast(`${kind === "folder" ? "Folder" : "File"} moved to Trash for 30 days.`);
    if (activeChanged) {
      const next = state.workspace.files.find((file) => file.id === state.workspace.activeFileId);
      await applySceneInPlace(next.scene);
      setOpen(true);
    }
  }

  async function restoreTrashItem(kind, id) {
    state.workspace = ExcalidrawSyncCore.restoreTrashEntry(state.workspace, kind, id);
    await persistWorkspace();
    render();
    showToast(`${kind === "folder" ? "Folder" : "File"} restored from Trash.`);
  }

  async function restoreTrashedFileItem(trashFolderId, fileId) {
    state.workspace = ExcalidrawSyncCore.restoreTrashedFile(state.workspace, trashFolderId, fileId);
    await persistWorkspace();
    render();
    showToast("File restored from Trash.");
  }

  async function restoreTrashedFolderItem(trashFolderId, folderId) {
    state.workspace = ExcalidrawSyncCore.restoreTrashedFolder(state.workspace, trashFolderId, folderId);
    await persistWorkspace();
    render();
    showToast("Folder restored from Trash.");
  }

  async function deleteAllLocalFiles() {
    const result = await showFormDialog({
      title: "Delete all local files?",
      description: "This permanently removes every ExcaliSync drawing, folder, local-vault file, and reinstall recovery copy. A new blank drawing will be created. Future cloud syncs may also reflect this deletion.",
      fields: [
        { name: "confirmation", label: 'Type "delete" to confirm', value: "", required: true },
      ],
      confirmLabel: "Delete all files",
      danger: true,
    });
    if (!result) {
      return;
    }
    if (result.confirmation.trim() !== "delete") {
      showToast('Type "delete" exactly to confirm.', "error");
      return;
    }

    await sendMessage({ type: "native:clearVault" }).catch(() => {});
    await storageRemove([WORKSPACE_KEY, LOCAL_VAULT_KEY, SAVE_STATE_KEY, NOTIFICATIONS_KEY]);
    await deleteDurableWorkspaceBackup();
    state.workspace = ExcalidrawSyncCore.createWorkspace(state.workspace?.name || "My Excalidraw");
    const active = state.workspace.files[0];
    active.hash = ExcalidrawSyncCore.hashScene(active.scene);
    state.notifications = [];
    state.dirtySince = null;
    state.unsyncedSince = null;
    state.lastSavedAt = null;
    state.lastSyncedAt = null;
    await applyScene(active.scene);
    await persistWorkspace({ sync: false });
    state.query = "";
    state.view = "files";
    render();
    showToast("All local files were deleted. A new blank drawing is ready.");
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

  async function waitFor(predicate, timeoutMs = 10_000, intervalMs = 120) {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      const result = predicate();
      if (result) return result;
      await new Promise((resolve) => window.setTimeout(resolve, intervalMs));
    }
    throw new Error("Excalidraw did not finish the request in time.");
  }

  async function importSharedLink(folderId = null) {
    const destinationFields = folderId ? [] : [{
      name: "folderId", label: "Folder", type: "select", value: state.workspace.folders[0]?.id,
      options: state.workspace.folders.map((folder) => ({ value: folder.id, label: folder.name })),
    }];
    const result = await showFormDialog({
      title: "Import shared drawing",
      description: "Paste an Excalidraw read-only share link and choose its destination.",
      fields: [
        { name: "url", label: "Excalidraw link", type: "url", value: "", required: true, maxLength: 4096 },
        { name: "name", label: "File name", value: "Imported drawing", required: true },
        ...destinationFields,
      ],
      confirmLabel: "Import link",
    });
    if (!result) return;
    const url = new URL(result.url.trim());
    if (url.origin !== "https://excalidraw.com" || !/^#(?:json|url)=/.test(url.hash)) {
      throw new Error("Paste a valid Excalidraw read-only share link.");
    }
    setBusy(true, "Importing shared drawing…");
    await captureAndSaveActive({ sync: false, force: true });
    const current = state.workspace.files.find((file) => file.id === state.workspace.activeFileId);
    try {
      localStorage.setItem("excalidraw", "[]");
      localStorage.setItem("excalidraw-state", "{}");
      window.location.hash = url.hash.slice(1);
      await waitFor(() => !window.location.hash, 15_000);
      await new Promise((resolve) => window.setTimeout(resolve, 900));
      const scene = await captureScene();
      const now = ExcalidrawSyncCore.nowIso();
      state.workspace.files.push({
        id: ExcalidrawSyncCore.makeId("file"), folderId: folderId || result.folderId,
        name: result.name.trim() || "Imported drawing", pinned: false, scene,
        hash: ExcalidrawSyncCore.hashScene(scene), createdAt: now, updatedAt: now,
      });
      await persistWorkspace();
      showToast("Shared drawing imported.");
    } finally {
      if (current) await applySceneInPlace(current.scene);
      setBusy(false, "Saved locally");
      setOpen(true);
      render();
    }
  }

  function nativeShareControl() {
    const controls = [...document.querySelectorAll("button")];
    return controls.find((button) => {
      const label = `${button.getAttribute("aria-label") || ""} ${button.title || ""} ${button.textContent || ""}`;
      return /share|export/i.test(label) && !/collaborat/i.test(label);
    });
  }

  function controlWithLabel(pattern) {
    return [...document.querySelectorAll("button")].find((button) => {
      const label = `${button.getAttribute("aria-label") || ""} ${button.title || ""} ${button.textContent || ""}`.trim();
      return pattern.test(label);
    });
  }

  async function copyShareLink(fileId) {
    if (fileId !== state.workspace.activeFileId) await switchFile(fileId);
    setOpen(false);
    try {
      let exportButton = nativeShareControl();
      if (!exportButton) {
        const mainMenu = document.querySelector('[data-testid="main-menu-trigger"]');
        if (!mainMenu) throw new Error("Excalidraw's main menu is unavailable.");
        mainMenu.click();
        const saveMenu = await waitFor(() => controlWithLabel(/^Save to\.\.\.$/i), 3000);
        saveMenu.click();
        exportButton = await waitFor(() => controlWithLabel(/Export to Link/i), 3000);
      }
      exportButton.click();
      const link = await waitFor(() => {
        const values = [...document.querySelectorAll("input, textarea, a")].map((item) => item.value || item.href || "");
        return values.find((value) => /^https:\/\/excalidraw\.com\/#json=/.test(value));
      }, 15_000);
      await navigator.clipboard.writeText(link);
      showToast("Read-only Excalidraw link copied.");
    } finally {
      setOpen(true);
    }
  }

  async function chooseSortMode() {
    const result = await showFormDialog({
      title: "Order folders and files",
      fields: [
        {
          name: "folderSortMode", label: "Folder order", type: "select", value: state.workspace.folderSortMode,
          options: [
            { value: "manual", label: "Custom (drag and drop)" },
            { value: "alphabetical", label: "Alphabetically" },
            { value: "updated", label: "Last updated" },
          ],
        },
        {
          name: "sortMode", label: "File order", type: "select", value: state.workspace.sortMode,
          options: [
            { value: "manual", label: "Custom (drag and drop)" },
            { value: "alphabetical", label: "Alphabetically" },
            { value: "updated", label: "Last updated" },
          ],
        },
      ],
      confirmLabel: "Apply",
    });
    if (!result) return;
    state.workspace.folderSortMode = result.folderSortMode;
    state.workspace.sortMode = result.sortMode;
    await persistWorkspace();
    render();
  }

  function formatUpdated(dateValue) {
    if (!dateValue) {
      return "Not saved yet";
    }
    const date = new Date(dateValue);
    const today = new Date();
    const sameDay = date.toDateString() === today.toDateString();
    return sameDay
      ? date.toLocaleTimeString(state.language, { hour: "2-digit", minute: "2-digit" })
      : date.toLocaleDateString(state.language, { month: "short", day: "numeric" });
  }

  function fileSyncDetails(file) {
    const health = ExcalidrawSyncUIEvents.getFileSyncHealth({
      updatedAt: file.updatedAt,
      syncedAt: file.syncedAt || state.lastSyncedAt,
      dirtySince: state.dirtySince,
      active: file.id === state.workspace.activeFileId,
      connected: hasConnectedCloud(),
      staleMinutes: state.saveSettings.staleMinutes,
    });
    const message = health.level === "ok"
      ? ""
      : health.kind === "unsaved"
        ? `Not saved or synced yet${health.level === "stale" ? " for longer than the warning limit" : ""}.`
        : `Saved locally but not synced yet${health.level === "stale" ? " for longer than the warning limit" : ""}.`;
    return { health, message };
  }

  function updateFileSyncIndicators() {
    if (!state.workspace || state.view !== "files") return;
    for (const row of elements.body.querySelectorAll(".file-row[data-id]")) {
      const file = state.workspace.files.find((item) => item.id === row.dataset.id);
      if (!file) continue;
      const { health, message } = fileSyncDetails(file);
      row.classList.toggle("sync-pending", health.level === "pending");
      row.classList.toggle("sync-stale", health.level === "stale");
      if (message) row.title = message;
      else row.removeAttribute("title");
      let warning = row.querySelector(":scope > .sync-warning");
      if (!message) {
        warning?.remove();
        continue;
      }
      if (!warning) {
        warning = document.createElement("span");
        warning.className = "sync-warning has-tooltip";
        warning.setAttribute("role", "img");
        replaceMarkup(warning, icon("alert", 17));
        row.querySelector(":scope > .row-actions")?.before(warning);
      }
      warning.setAttribute("aria-label", message);
      warning.title = message;
      warning.dataset.tooltip = message;
    }
  }

  function providerHomeCard(providerName, label, provider) {
    const connected = Boolean(provider?.connected);
    const automatic = connected && state.providers?.syncAuthority === providerName;
    const hasError = ExcalidrawSyncCore.hasActiveProviderError(provider);
    const lastSync = provider?.lastSyncAt
      ? `Last sync ${formatRelativeTime(provider.lastSyncAt)}`
      : connected ? "Waiting for first sync" : "Not connected";
    const automaticLabel = automatic ? "Automatic sync on" : "Automatic sync off";
    const statusMessage = hasError ? `${provider.lastError} · ${lastSync}` : lastSync;
    return `
      <div class="cloud-provider ${hasError ? "has-error" : ""}" data-provider-status="${providerName}" title="${escapeHtml(`${automaticLabel}. ${statusMessage}.`)}">
        ${providerIcon(providerName, 18)}
        <span class="cloud-provider-copy"><strong>${escapeHtml(label)} <span class="auto-state ${automatic ? "on" : ""}" aria-label="${automaticLabel}">${automatic ? "Auto on" : "Auto off"}</span></strong><small>${escapeHtml(statusMessage)}</small></span>
      </div>`;
  }

  function providerHomeStatus() {
    return `${providerHomeCard("github", "GitHub", state.providers?.github)}${providerHomeCard("googleDrive", "Google Drive", state.providers?.googleDrive)}`;
  }

  function fileRow(file, { pinned = false } = {}) {
    const { health: syncHealth, message: syncWarning } = fileSyncDetails(file);
    return `
      <div class="file-row ${file.id === state.workspace.activeFileId ? "active" : ""} ${syncHealth.level === "ok" ? "" : `sync-${syncHealth.level}`}" data-deletable data-kind="file" data-id="${escapeHtml(file.id)}" draggable="true" ${syncWarning ? `title="${escapeHtml(syncWarning)}"` : ""}>
        <button class="file-main" type="button" data-action="open-file" data-id="${escapeHtml(file.id)}" aria-label="Open ${escapeHtml(file.name)}">
          ${icon("file", 19)}
          <span class="file-copy"><strong data-i18n-skip>${escapeHtml(file.name)}</strong><small>${file.id === state.workspace.activeFileId ? "Open now" : `Saved ${escapeHtml(formatUpdated(file.updatedAt))}`}</small></span>
        </button>
        ${syncWarning ? `<span class="sync-warning has-tooltip" role="img" tabindex="0" aria-label="${escapeHtml(syncWarning)}" data-tooltip="${escapeHtml(syncWarning)}">${icon("alert", 17)}</span>` : ""}
        <div class="row-actions">
          <button class="row-action" type="button" data-action="file-more" data-id="${escapeHtml(file.id)}" aria-label="File actions for ${escapeHtml(file.name)}" aria-haspopup="menu" aria-expanded="false">${icon("more", 17)}</button>
        </div>
      </div>`;
  }

  function renderFilesView() {
    const health = saveHealth();
    const query = state.query.trim().toLocaleLowerCase();
    const matches = (name) => !query || name.toLocaleLowerCase().includes(query);
    const sortedFiles = ExcalidrawSyncCore.sortedFiles(state.workspace.files, state.workspace.sortMode);
    const sortedFolders = ExcalidrawSyncCore.sortedFolders(state.workspace.folders, state.workspace.folderSortMode);
    const pinnedFiles = sortedFiles.filter((file) => file.pinned && matches(file.name));
    const matchingFolderIds = new Set(sortedFolders.filter((folder) =>
      matches(folder.name) || sortedFiles.some((file) => file.folderId === folder.id && matches(file.name)),
    ).map((folder) => folder.id));
    const foldersById = new Map(sortedFolders.map((folder) => [folder.id, folder]));
    for (const folderId of [...matchingFolderIds]) {
      let parentId = foldersById.get(folderId)?.parentId;
      while (parentId && !matchingFolderIds.has(parentId)) {
        matchingFolderIds.add(parentId);
        parentId = foldersById.get(parentId)?.parentId;
      }
    }
    const folders = sortedFolders.filter((folder) => matchingFolderIds.has(folder.id));
    const rootFolders = folders.filter((folder) => !folder.parentId || !foldersById.has(folder.parentId));
    const orphaned = sortedFiles.filter((file) => !state.workspace.folders.some((folder) => folder.id === file.folderId) && matches(file.name));
    const renderFolder = (folder) => {
      const folderFiles = sortedFiles.filter((file) => file.folderId === folder.id && matches(file.name));
      const childFolders = folders.filter((candidate) => candidate.parentId === folder.id);
      const collapsed = state.collapsedFolders.has(folder.id);
      return `
        <div class="folder ${collapsed ? "collapsed" : ""}" data-deletable data-kind="folder" data-id="${escapeHtml(folder.id)}" data-drop-folder="${escapeHtml(folder.id)}" draggable="true">
          <div class="folder-head">
            <button class="folder-toggle" type="button" data-action="toggle-folder" data-id="${escapeHtml(folder.id)}" aria-expanded="${String(!collapsed)}">
              <span class="chevron">${icon("chevron", 16)}</span>${icon("folder", 18)}<span data-i18n-skip>${escapeHtml(folder.name)}</span>
            </button>
            <div class="row-actions">
              <button class="row-action" type="button" data-action="folder-menu" data-id="${escapeHtml(folder.id)}" aria-label="Actions for ${escapeHtml(folder.name)}" aria-haspopup="menu" aria-expanded="false">${icon("more", 17)}</button>
            </div>
          </div>
          <div class="folder-files">
            ${folderFiles.map((file) => fileRow(file)).join("")}
            ${childFolders.length ? `<div class="folder-children">${childFolders.map(renderFolder).join("")}</div>` : ""}
            ${!folderFiles.length && !childFolders.length ? '<div class="empty">No files in this folder.</div>' : ""}
          </div>
        </div>`;
    };
    return `
      <nav class="quick-grid" aria-label="File actions">
        <button class="quick-action" type="button" data-action="new-file">${icon("file", 19)}<span>New file</span></button>
        <button class="quick-action" type="button" data-action="new-folder">${icon("folder", 19)}<span>New folder</span></button>
        <button class="quick-action" type="button" data-action="manage">${icon("settings", 19)}<span>Manage</span></button>
      </nav>
      <div class="sync-row ${health.level === "ok" ? "" : health.level}">${icon(health.level === "stale" ? "alert" : "cloud", 18)}<span>${escapeHtml(healthMessage(health))}</span><button type="button" data-action="sync" aria-label="Sync all documents now" title="Sync all documents now">${icon("sync", 18)}</button></div>
      <div class="cloud-status" aria-label="Automatic cloud sync status">${providerHomeStatus()}</div>
      ${pinnedFiles.length ? `<section class="section pinned"><div class="section-title">${icon("pin", 15)} Pinned</div>${pinnedFiles.map((file) => fileRow(file, { pinned: true })).join("")}</section>` : ""}
      <div class="search-wrap">${icon("search", 18)}<input class="search" type="search" placeholder="Search files and folders" value="${escapeHtml(state.query)}" aria-label="Search files and folders"></div>
      <section class="section">
        <div class="section-title" data-drop-root>Folders <span class="root-drop-hint">Drop here to move to top level</span><span class="section-title-spacer"></span><button class="row-action" type="button" data-action="folder-section-menu" aria-label="Folder section actions" title="Folder section actions" aria-haspopup="menu" aria-expanded="false">${icon("more", 17)}</button></div>
        ${rootFolders.map(renderFolder).join("")}
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
    const trashCount = ExcalidrawSyncCore.activeTrashItems(state.workspace).length;
    const githubHasError = ExcalidrawSyncCore.hasActiveProviderError(github);
    const driveHasError = ExcalidrawSyncCore.hasActiveProviderError(drive);
    const githubStatus = github?.connected
      ? github.account?.login || "Connected"
      : githubHasError ? "Needs attention" : "Not connected";
    const driveStatus = drive?.connected
      ? drive.account?.email || "Connected"
      : driveHasError ? "Needs attention" : "Not connected";
    return `
      <div class="manage-title">
        <button class="icon-button" type="button" data-action="back" aria-label="Back to files">${icon("back", 19)}</button>
        <div><h2>Settings</h2><span class="settings-subtitle">Simple, local-first controls</span></div>
      </div>
      <form class="providers-form settings-form">
        <section class="settings-card">
          <div class="settings-heading">${icon("settings", 17)}<div><strong>General</strong><small>Appearance and launcher</small></div></div>
          <div class="settings-grid">
            <label class="compact-field wide"><span>Language</span><select name="language">${ExcalidrawSyncI18n.SUPPORTED_LANGUAGES.map((language) => `<option value="${language}" ${state.language === language ? "selected" : ""}>${ExcalidrawSyncI18n.LANGUAGE_NAMES[language]}</option>`).join("")}</select></label>
            <label class="compact-field wide"><span>Theme</span><select name="theme"><option value="excalidraw" ${state.theme === "excalidraw" ? "selected" : ""}>Follow Excalidraw</option><option value="system" ${state.theme === "system" ? "selected" : ""}>System</option><option value="light" ${state.theme === "light" ? "selected" : ""}>Light</option><option value="dark" ${state.theme === "dark" ? "selected" : ""}>Dark</option></select></label>
          </div>
          <label class="toggle-row"><span class="toggle-copy"><strong>Floating launcher</strong><small>Show ExcaliSync on the canvas</small></span><input type="checkbox" name="launcherVisible" ${state.launcherVisible ? "checked" : ""}><span class="toggle-ui" aria-hidden="true"></span></label>
          <label class="toggle-row"><span class="toggle-copy"><strong>Hide collapsed sidebar</strong><small>Open it from the ExcaliSync icon or browser extension button</small></span><input type="checkbox" name="sidebarRailHidden" ${state.sidebarRailHidden ? "checked" : ""}><span class="toggle-ui" aria-hidden="true"></span></label>
        </section>

        <section class="settings-card">
          <div class="settings-heading">${icon("check", 17)}<div><strong>Saving</strong><small>Local copies are always written first</small></div><span class="badge connected">Local first</span></div>
          <div class="settings-grid">
            <label class="compact-field"><span>Autosave</span><select name="saveMode"><option value="edit" ${state.saveSettings.mode === "edit" ? "selected" : ""}>After every edit</option><option value="interval" ${state.saveSettings.mode === "interval" ? "selected" : ""}>On a timer</option><option value="manual" ${state.saveSettings.mode === "manual" ? "selected" : ""}>Manual</option></select></label>
            <label class="compact-field"><span>Interval</span><select name="saveInterval" ${state.saveSettings.mode !== "interval" ? "disabled" : ""}><option value="5" ${state.saveSettings.intervalSeconds === 5 ? "selected" : ""}>5 seconds</option><option value="15" ${state.saveSettings.intervalSeconds === 15 ? "selected" : ""}>15 seconds</option><option value="30" ${state.saveSettings.intervalSeconds === 30 ? "selected" : ""}>30 seconds</option><option value="60" ${state.saveSettings.intervalSeconds === 60 ? "selected" : ""}>1 minute</option><option value="300" ${state.saveSettings.intervalSeconds === 300 ? "selected" : ""}>5 minutes</option></select></label>
            <label class="compact-field wide"><span>Cloud sync after editing</span><select name="syncDelay"><option value="30" ${state.saveSettings.syncDelaySeconds === 30 ? "selected" : ""}>30 seconds</option><option value="60" ${state.saveSettings.syncDelaySeconds === 60 ? "selected" : ""}>1 minute</option><option value="300" ${state.saveSettings.syncDelaySeconds === 300 ? "selected" : ""}>5 minutes</option></select></label>
            <label class="compact-field wide"><span>Warn if pending</span><select name="staleMinutes"><option value="1" ${state.saveSettings.staleMinutes === 1 ? "selected" : ""}>After 1 minute</option><option value="5" ${state.saveSettings.staleMinutes === 5 ? "selected" : ""}>After 5 minutes</option><option value="10" ${state.saveSettings.staleMinutes === 10 ? "selected" : ""}>After 10 minutes</option><option value="30" ${state.saveSettings.staleMinutes === 30 ? "selected" : ""}>After 30 minutes</option></select></label>
          </div>
          <label class="toggle-row"><span class="toggle-copy"><strong>Notifications</strong><small>Show save and sync alerts</small></span><input type="checkbox" name="notificationsEnabled" ${state.saveSettings.notificationsEnabled ? "checked" : ""}><span class="toggle-ui" aria-hidden="true"></span></label>
          <div class="save-summary"><span class="status-chip"><strong>Local save</strong>${escapeHtml(formatRelativeTime(state.lastSavedAt))}</span><span class="status-chip"><strong>Cloud sync</strong>${hasConnectedCloud() ? escapeHtml(formatRelativeTime(state.lastSyncedAt)) : "Not connected"}</span></div>
        </section>

        <section class="settings-card">
          <div class="settings-heading">${icon("folder", 17)}<div><strong>Local storage</strong><small>Disk copy plus browser recovery copy</small></div><span class="badge ${state.nativeStorage.available ? "connected" : ""}">${state.nativeStorage.available ? "Connected" : "Helper needed"}</span></div>
          <p class="storage-copy">Drawings are synchronized to <span class="vault-path">${escapeHtml(state.nativeStorage.root)}</span>. Deleted items remain in <span class="vault-path">.trash</span> for 30 days; error-only diagnostics remain in <span class="vault-path">.logs</span> for 7 days.</p>
          <div class="compact-actions"><button class="button" type="button" data-action="open-vault">${icon("openFolder", 15)} Open vault</button><button class="button danger" type="button" data-action="delete-local-files">${icon("trash", 14)} Delete files</button></div>
        </section>

        <section class="settings-card cloud-settings">
          <div class="settings-heading">${icon("cloud", 17)}<div><strong>Cloud sync</strong><small>Expand a provider to configure it</small></div></div>
          <div class="settings-grid">
            <label class="compact-field wide"><span>Sync authority</span><select name="syncAuthority"><option value="local" ${state.providers?.syncAuthority === "local" ? "selected" : ""}>Local only</option><option value="github" ${state.providers?.syncAuthority === "github" ? "selected" : ""}>GitHub</option><option value="googleDrive" ${state.providers?.syncAuthority === "googleDrive" ? "selected" : ""}>Google Drive</option></select></label>
          </div>
          <p class="provider-note">Choose one cloud authority. Local storage remains the offline fallback; pending local changes merge when the selected provider is available again.</p>
          <details class="provider-disclosure" ${github?.pendingAuth || githubHasError ? "open" : ""}>
            <summary>${providerIcon("github", 20)}<span class="provider-summary-copy"><strong>GitHub</strong><small>${escapeHtml(githubStatus)}</small></span><span class="badge ${github?.connected ? "connected" : ""}">${github?.connected ? "On" : "Off"}</span><span class="chevron">${icon("chevron", 15)}</span></summary>
            <div class="provider-config">
              <div class="settings-grid">
                <label class="compact-field wide"><span>Client ID</span><input name="githubClientId" value="${escapeHtml(github?.config.clientId || "")}" placeholder="Iv1…"></label>
                <label class="compact-field wide"><span>Repository</span><input name="githubRepoName" value="${escapeHtml(github?.config.repoName || "excalidraw-diagrams")}"></label>
                <label class="compact-field"><span>Visibility</span><select name="githubVisibility"><option value="private" ${github?.config.visibility !== "public" ? "selected" : ""}>Private</option><option value="public" ${github?.config.visibility === "public" ? "selected" : ""}>Public</option></select></label>
                <label class="compact-field"><span>Root folder</span><input name="githubRoot" value="${escapeHtml(github?.config.rootDirectory || "Excalidraw")}"></label>
              </div>
              <p class="provider-note">Public client ID only. Device Flow is required; never enter a client secret.</p>
              <details class="setup-guide"><summary>Create a GitHub OAuth App</summary><ol><li>Open GitHub Settings → Developer settings → OAuth Apps → <strong>New OAuth App</strong>.</li><li><strong>Application name:</strong> enter <code>ExcaliSync</code> (or another name you will recognize).</li><li><strong>Homepage URL:</strong> enter <code>https://excalidraw.com/</code>.</li><li><strong>Application description:</strong> optional; for example, <code>Sync Excalidraw drawings to my GitHub repository.</code></li><li><strong>Redirect URI:</strong> enter <code>https://excalidraw.com/</code>. GitHub requires this field, although ExcaliSync uses Device Flow and does not redirect to it.</li><li>Leave <strong>Allow wildcard matching</strong> off.</li><li>Turn <strong>Enable Device Flow</strong> on.</li><li>Keep <strong>Expire user access tokens</strong> on. ExcaliSync securely rotates Device Flow access and refresh tokens when GitHub expires them.</li><li>Select <strong>Register application</strong>, then copy only the <strong>Client ID</strong> into ExcaliSync.</li><li>Do not generate, paste, or share a client secret. A client ID is public; access tokens remain in extension-owned storage and are never added to drawings, logs, or Git commits.</li><li>On another machine, use the same GitHub account, Client ID, repository name, and root folder. The first sync downloads and merges the existing library.</li></ol></details>
              ${github?.pendingAuth ? `<div class="device-code"><span>Enter this code on GitHub</span><strong>${escapeHtml(github.pendingAuth.userCode)}</strong><a class="text-link" href="${escapeHtml(github.pendingAuth.verificationUri)}" target="_blank" rel="noreferrer">Open GitHub ${icon("external", 12)}</a></div>` : ""}
              <div class="compact-actions"><button class="button primary" type="button" data-action="github-connect">${github?.connected ? "Reconnect" : "Connect"}</button>${github?.connected ? '<button class="button danger" type="button" data-action="disconnect" data-provider="github">Disconnect</button>' : ""}</div>
              <p class="provider-note ${githubHasError ? "error" : ""}">${githubHasError ? escapeHtml(github.lastError) : github?.account ? `Signed in as ${escapeHtml(github.account.login)}. ${providerLink(github.repositoryUrl, "Repository")}` : "A private repository is created on first sync."}</p>
            </div>
          </details>
          <details class="provider-disclosure" ${driveHasError ? "open" : ""}>
            <summary>${providerIcon("googleDrive", 20)}<span class="provider-summary-copy"><strong>Google Drive</strong><small>${escapeHtml(driveStatus)}</small></span><span class="badge ${drive?.connected ? "connected" : ""}">${drive?.connected ? "On" : "Off"}</span><span class="chevron">${icon("chevron", 15)}</span></summary>
            <div class="provider-config">
              <div class="settings-grid">
                <label class="compact-field wide"><span>Client ID</span><input name="googleClientId" value="${escapeHtml(drive?.config.clientId || "")}" placeholder="…apps.googleusercontent.com"></label>
                <label class="compact-field"><span>Folder</span><input name="googleFolderName" value="${escapeHtml(drive?.config.folderName || "Excalidraw")}"></label>
                <label class="compact-field"><span>Visibility</span><select name="googleVisibility"><option value="private" ${drive?.config.visibility !== "public" ? "selected" : ""}>Private</option><option value="public" ${drive?.config.visibility === "public" ? "selected" : ""}>Link sharing</option></select></label>
              </div>
              <p class="provider-note">Use a browser-specific OAuth client ID. Never enter a client secret.</p>
              <details class="setup-guide"><summary>Create a Google OAuth client</summary><ol><li>Open Google Cloud Console and create or select a project.</li><li>Enable the Google Drive API.</li><li>Configure the OAuth consent screen and add yourself as a test user while the app is in testing.</li><li>Open Credentials → Create credentials → OAuth client ID → Chrome extension.</li><li>Enter this extension's ID from <strong>chrome://extensions</strong>, then copy the Client ID here.</li><li>No client secret belongs in this extension.</li><li>On another machine, use the same Google account, OAuth Client ID, and Drive folder name. The first sync downloads and merges the existing library.</li></ol></details>
              <div class="compact-actions"><button class="button primary" type="button" data-action="google-connect">${drive?.connected ? "Reconnect" : "Connect"}</button>${drive?.connected ? '<button class="button danger" type="button" data-action="disconnect" data-provider="googleDrive">Disconnect</button>' : ""}</div>
              <p class="provider-note ${driveHasError ? "error" : ""}">${driveHasError ? escapeHtml(drive.lastError) : drive?.account ? `Signed in as ${escapeHtml(drive.account.email)}. ${providerLink(drive.folderUrl, "Drive folder")}` : "The folder stays private by default."}</p>
            </div>
          </details>
        </section>
        <section class="settings-card">
          <div class="settings-heading">${icon("trash", 17)}<div><strong>Trash</strong><small>Recover items deleted during the last 30 days</small></div><span class="badge">${trashCount}</span></div>
          <p class="storage-copy">Deleted files and folders stay hidden from your library while their backup remains recoverable for 30 days.</p>
          <div class="compact-actions"><button class="button" type="button" data-action="open-trash">${icon("trash", 14)} Review Trash</button></div>
        </section>
        <p class="settings-auto-save" role="status" aria-live="polite">Changes save automatically</p>
      </form>`;
  }

  function renderTrashedFolderTree(item, daysRemaining) {
    const folders = item.folders?.length
      ? item.folders
      : item.entry?.name
        ? [item.entry]
        : [];
    const foldersById = new Map(folders.map((folder) => [folder.id, folder]));
    const childrenByParent = new Map();
    const filesByFolder = new Map();
    const explicitlyRestoredFolders = new Set(folders
      .filter((folder) => {
        const marker = ExcalidrawSyncCore.trashChildRestoration(item, "folder", folder.id);
        return marker && !marker.structural;
      })
      .map((folder) => folder.id));
    const restoredFiles = new Set((item.files || [])
      .filter((file) => ExcalidrawSyncCore.trashChildRestoration(item, "file", file.id))
      .map((file) => file.id));

    const belongsToRestoredSubtree = (folder) => {
      const visited = new Set();
      let current = folder;
      while (current && !visited.has(current.id)) {
        if (explicitlyRestoredFolders.has(current.id)) return true;
        visited.add(current.id);
        current = foldersById.get(current.parentId);
      }
      return false;
    };
    const visibleFolders = folders.filter((folder) => !belongsToRestoredSubtree(folder));
    const visibleFolderIds = new Set(visibleFolders.map((folder) => folder.id));

    for (const folder of visibleFolders) {
      const parentId = visibleFolderIds.has(folder.parentId) ? folder.parentId : null;
      if (!childrenByParent.has(parentId)) childrenByParent.set(parentId, []);
      childrenByParent.get(parentId).push(folder);
    }
    for (const file of item.files || []) {
      if (restoredFiles.has(file.id) || !visibleFolderIds.has(file.folderId)) continue;
      if (!filesByFolder.has(file.folderId)) filesByFolder.set(file.folderId, []);
      filesByFolder.get(file.folderId).push(file);
    }

    const subtreeHasUnavailableFile = (folderId, visited = new Set()) => {
      if (visited.has(folderId)) return false;
      visited.add(folderId);
      if ((filesByFolder.get(folderId) || []).some((file) => !file.scene)) return true;
      return (childrenByParent.get(folderId) || [])
        .some((folder) => subtreeHasUnavailableFile(folder.id, visited));
    };
    const renderFolder = (folder, ancestry = new Set()) => {
      if (ancestry.has(folder.id)) return "";
      const nextAncestry = new Set(ancestry).add(folder.id);
      const childFolders = childrenByParent.get(folder.id) || [];
      const files = filesByFolder.get(folder.id) || [];
      const canRestore = !subtreeHasUnavailableFile(folder.id);
      const childMarkup = [
        ...childFolders.map((child) => renderFolder(child, nextAncestry)),
        ...files.map((file) => {
          const fileCanRestore = Boolean(file.scene);
          return `<div class="trash-tree-row">
            <span class="trash-item-icon">${icon("file", 14)}</span>
            <span class="trash-item-copy"><strong data-i18n-skip>${escapeHtml(file.name || "Deleted file")}</strong><small>File</small></span>
            <button class="button" type="button" data-action="restore-trash-file" data-trash-id="${escapeHtml(item.entry.id)}" data-id="${escapeHtml(file.id)}" ${fileCanRestore ? "" : "disabled"} title="${fileCanRestore ? "Restore file" : "Backup unavailable on this device"}">${icon("sync", 13)} Restore</button>
          </div>`;
        }),
      ].join("");
      return `<div class="trash-tree-node">
        <div class="trash-tree-row">
          <span class="trash-item-icon">${icon("folder", 14)}</span>
          <span class="trash-item-copy"><strong data-i18n-skip>${escapeHtml(folder.name || "Deleted folder")}</strong><small>Folder</small></span>
          <button class="button" type="button" data-action="restore-trash-folder" data-trash-id="${escapeHtml(item.entry.id)}" data-id="${escapeHtml(folder.id)}" ${canRestore ? "" : "disabled"} title="${canRestore ? "Restore folder" : "A file backup is unavailable on this device"}">${icon("sync", 13)} Restore</button>
        </div>
        ${childMarkup ? `<div class="trash-tree-children">${childMarkup}</div>` : ""}
      </div>`;
    };
    const roots = childrenByParent.get(null) || [];
    return `<article class="trash-item folder-backup">
      <div class="trash-item-copy"><small>Deleted ${escapeHtml(formatRelativeTime(item.deletedAt))} · ${daysRemaining} day${daysRemaining === 1 ? "" : "s"} remaining</small></div>
      <div class="trash-tree">${roots.map((folder) => renderFolder(folder)).join("")}</div>
    </article>`;
  }

  function renderTrashView() {
    const trash = ExcalidrawSyncCore.activeTrashItems(state.workspace);
    return `
      <div class="manage-title">
        <button class="icon-button" type="button" data-action="back-manage" aria-label="Back to settings">${icon("back", 19)}</button>
        <div><h2>Trash</h2><span class="settings-subtitle">Recover deleted items for up to 30 days</span></div>
      </div>
      <div class="trash-list">
        ${trash.length ? trash.map((item) => {
          const isFolder = item.kind === "folder";
          const expiresAt = new Date(item.deletedAt).getTime() + ExcalidrawSyncCore.TRASH_RETENTION_MS;
          const daysRemaining = Math.max(1, Math.ceil((expiresAt - Date.now()) / 86_400_000));
          if (isFolder) return renderTrashedFolderTree(item, daysRemaining);
          const canRestore = isFolder
            ? Boolean(item.folders?.length || item.entry?.name)
            : Boolean(item.entry?.scene);
          const itemName = item.entry?.name || (isFolder ? "Deleted folder" : "Deleted file");
          const contents = isFolder && item.files?.length
            ? ` · ${item.files.length} file${item.files.length === 1 ? "" : "s"}`
            : "";
          return `<article class="trash-item">
            <span class="trash-item-icon">${icon(isFolder ? "folder" : "file", 17)}</span>
            <span class="trash-item-copy"><strong data-i18n-skip>${escapeHtml(itemName)}</strong><small>Deleted ${escapeHtml(formatRelativeTime(item.deletedAt))}${contents} · ${daysRemaining} day${daysRemaining === 1 ? "" : "s"} remaining</small></span>
            <button class="button" type="button" data-action="restore-trash" data-kind="${escapeHtml(item.kind)}" data-id="${escapeHtml(item.entry.id)}" ${canRestore ? "" : "disabled"} title="${canRestore ? "Restore" : "Backup unavailable on this device"}">${icon("sync", 14)} Restore</button>
          </article>`;
        }).join("") : '<div class="empty">Trash is empty.</div>'}
      </div>`;
  }

  function renderNotificationsView() {
    const notifications = currentNotifications();
    return `
      <div class="manage-title"><button class="icon-button" type="button" data-action="back" aria-label="Back to files">${icon("back", 20)}</button><h2>Notifications</h2>${state.notifications.length ? '<button class="button" type="button" data-action="clear-notifications">Clear</button>' : ""}</div>
      <div class="notification-list">
        ${notifications.length ? notifications.map((item) => `
          <div class="notification-item ${escapeHtml(item.level)}">
            ${icon(item.level === "stale" || item.level === "error" ? "alert" : "bell", 20)}
            <div class="notification-copy"><strong>${escapeHtml(item.title)}</strong><span>${escapeHtml(item.message)}</span>${item.createdAt ? `<time datetime="${escapeHtml(item.createdAt)}">${escapeHtml(formatRelativeTime(item.createdAt))}</time>` : ""}</div>
          </div>`).join("") : '<div class="empty">No alerts. Your drawings are up to date.</div>'}
      </div>`;
  }

  function renderHeader() {
    const notificationCount = state.notifications.filter((item) => !item.readAt).length + (saveHealth().kind ? 1 : 0);
    replaceMarkup(elements.header, `
      <div class="brand-mark">${icon("logo", 22)}</div>
      <div class="brand"><strong>ExcaliSync</strong><span>${escapeHtml(state.workspace?.name || "My Excalidraw")}</span></div>
      <button class="icon-button header-sync" type="button" data-action="sync" aria-label="Sync all documents now" title="Sync all documents now">${icon("sync", 19)}</button>
      <button class="icon-button notification-button" type="button" data-action="notifications" aria-label="Notifications${notificationCount ? `, ${notificationCount} alert${notificationCount === 1 ? "" : "s"}` : ""}">${icon("bell", 20)}${notificationCount ? `<span class="notification-badge">${Math.min(99, notificationCount)}</span>` : ""}</button>
      <button class="icon-button" type="button" data-action="close" aria-label="Close sidebar">${icon("close", 21)}</button>`);
    localizeUi(elements.header);
  }

  function render() {
    if (!state.workspace) {
      return;
    }
    dismissActionDropdown();
    renderHeader();
    const markup = state.view === "manage"
      ? renderManageView()
      : state.view === "trash"
        ? renderTrashView()
      : state.view === "notifications"
        ? renderNotificationsView()
        : renderFilesView();
    replaceMarkup(elements.body, markup);
    localizeUi(elements.body);
    bindSwipeHandlers();
    bindFileDragHandlers();
    updateSaveIndicators({ rerenderHeader: false });
  }

  function bindFileDragHandlers() {
    const clearFolderDragState = () => {
      state.draggedFolderId = null;
      elements.body.classList.remove("folder-dragging");
      for (const target of elements.body.querySelectorAll(".drag-target, .nest-target, .dragging")) {
        target.classList.remove("drag-target", "nest-target", "dragging");
      }
    };
    for (const folder of elements.body.querySelectorAll(".folder[draggable='true']")) {
      const head = folder.querySelector(":scope > .folder-head");
      folder.addEventListener("dragstart", (event) => {
        if (event.target.closest(".file-row")) return;
        state.draggedFolderId = folder.dataset.id;
        elements.body.classList.add("folder-dragging");
        folder.classList.add("dragging");
        event.dataTransfer?.setData("text/plain", folder.dataset.id);
        event.stopPropagation();
      });
      folder.addEventListener("dragend", () => {
        if (state.draggedFolderId !== folder.dataset.id) return;
        clearFolderDragState();
      });
      head?.addEventListener("dragover", (event) => {
        if (!state.draggedFolderId || state.draggedFolderId === folder.dataset.id) return;
        event.preventDefault();
        event.stopPropagation();
        const dropMode = ExcalidrawSyncUIEvents.folderDropMode(event.clientY, head.getBoundingClientRect());
        folder.classList.add("drag-target");
        folder.classList.toggle("nest-target", dropMode === "inside");
      });
      head?.addEventListener("dragleave", (event) => {
        if (!head.contains(event.relatedTarget)) folder.classList.remove("drag-target", "nest-target");
      });
      head?.addEventListener("drop", async (event) => {
        if (!state.draggedFolderId || state.draggedFolderId === folder.dataset.id) return;
        event.preventDefault();
        event.stopPropagation();
        const dropMode = ExcalidrawSyncUIEvents.folderDropMode(event.clientY, head.getBoundingClientRect());
        if (dropMode === "inside") {
          state.workspace = ExcalidrawSyncCore.moveFolderToParent(
            state.workspace,
            state.draggedFolderId,
            folder.dataset.id,
          );
          state.collapsedFolders.delete(folder.dataset.id);
        } else {
          const workspaceInDisplayedOrder = {
            ...state.workspace,
            folders: ExcalidrawSyncCore.sortedFolders(state.workspace.folders, state.workspace.folderSortMode),
          };
          state.workspace = ExcalidrawSyncCore.moveFolder(
            workspaceInDisplayedOrder,
            state.draggedFolderId,
            folder.dataset.id,
            dropMode,
          );
        }
        clearFolderDragState();
        await persistWorkspace();
        render();
      });
    }
    const rootDropTarget = elements.body.querySelector("[data-drop-root]");
    rootDropTarget?.addEventListener("dragover", (event) => {
      const draggedFolder = state.workspace.folders.find((folder) => folder.id === state.draggedFolderId);
      if (!draggedFolder?.parentId) return;
      event.preventDefault();
      event.stopPropagation();
      rootDropTarget.classList.add("drag-target");
    });
    rootDropTarget?.addEventListener("dragleave", (event) => {
      if (!rootDropTarget.contains(event.relatedTarget)) rootDropTarget.classList.remove("drag-target");
    });
    rootDropTarget?.addEventListener("drop", async (event) => {
      const draggedFolder = state.workspace.folders.find((folder) => folder.id === state.draggedFolderId);
      if (!draggedFolder?.parentId) return;
      event.preventDefault();
      event.stopPropagation();
      state.workspace = ExcalidrawSyncCore.moveFolderToParent(state.workspace, state.draggedFolderId, null);
      clearFolderDragState();
      await persistWorkspace();
      render();
    });
    for (const row of elements.body.querySelectorAll(".file-row[draggable='true']")) {
      row.addEventListener("dragstart", (event) => {
        state.draggedFileId = row.dataset.id;
        row.classList.add("dragging");
        event.dataTransfer?.setData("text/plain", row.dataset.id);
        event.stopPropagation();
      });
      row.addEventListener("dragend", () => {
        state.draggedFileId = null;
        for (const target of elements.body.querySelectorAll(".drag-target")) target.classList.remove("drag-target");
      });
    }
    for (const target of elements.body.querySelectorAll(".file-row[data-id], .folder[data-drop-folder]")) {
      target.addEventListener("dragover", (event) => {
        if (!state.draggedFileId) return;
        event.preventDefault();
        target.classList.add("drag-target");
      });
      target.addEventListener("dragleave", () => target.classList.remove("drag-target"));
      target.addEventListener("drop", async (event) => {
        if (!state.draggedFileId) return;
        event.preventDefault();
        event.stopPropagation();
        const fileId = state.draggedFileId || event.dataTransfer?.getData("text/plain");
        const targetFile = target.matches(".file-row")
          ? state.workspace.files.find((file) => file.id === target.dataset.id)
          : null;
        const folderId = targetFile?.folderId || target.dataset.dropFolder;
        if (!fileId || fileId === targetFile?.id || !folderId) return;
        state.workspace = ExcalidrawSyncCore.moveFile(state.workspace, fileId, folderId, targetFile?.id || null);
        await persistWorkspace();
        render();
      });
    }
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

  function readProviderForm() {
    const form = elements.body.querySelector(".providers-form");
    if (!form) {
      return null;
    }
    return Object.fromEntries(new FormData(form));
  }

  async function saveProviderForm(formData = null) {
    const data = formData || readProviderForm();
    if (!data) {
      return;
    }
    applyLanguage(data.language || state.language);
    await storageSet(LANGUAGE_KEY, state.language);
    applyTheme(data.theme);
    await storageSet(THEME_KEY, state.theme);
    applyLauncherVisibility(data.launcherVisible === "on");
    await storageSet(LAUNCHER_VISIBLE_KEY, state.launcherVisible);
    applySidebarRailVisibility(data.sidebarRailHidden === "on");
    await storageSet(SIDEBAR_RAIL_HIDDEN_KEY, state.sidebarRailHidden);
    state.saveSettings = ExcalidrawSyncUIEvents.normalizeSaveSettings({
      mode: data.saveMode,
      intervalSeconds: data.saveInterval || state.saveSettings.intervalSeconds,
      syncDelaySeconds: data.syncDelay || state.saveSettings.syncDelaySeconds,
      staleMinutes: data.staleMinutes,
      notificationsEnabled: data.notificationsEnabled === "on",
    });
    await storageSet(SAVE_SETTINGS_KEY, state.saveSettings);
    state.providers = await sendMessage({
      type: "providers:save",
      syncAuthority: data.syncAuthority,
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

  function setSettingsAutoSaveStatus(message, status = "") {
    const indicator = elements.body.querySelector(".settings-auto-save");
    if (!indicator) return;
    indicator.textContent = t(message);
    indicator.dataset.state = status;
  }

  function scheduleSettingsSave(formData, delayMs = 450) {
    if (!formData) return;
    clearTimeout(settingsSaveTimer);
    setSettingsAutoSaveStatus("Saving changes…", "saving");
    settingsSaveTimer = setTimeout(() => {
      settingsSaveTimer = null;
      settingsSaveQueue = settingsSaveQueue
        .catch(() => {})
        .then(async () => {
          try {
            await saveProviderForm(formData);
            setSettingsAutoSaveStatus("Settings saved automatically", "saved");
            if (hasConnectedCloud()) scheduleCloudSync();
          } catch (error) {
            if (ExcalidrawSyncUIEvents.isExtensionContextInvalidated(error)) {
              await recoverInvalidatedContext(error, { providerFormDraft: formData });
              return;
            }
            setSettingsAutoSaveStatus("Could not save settings automatically", "error");
            showToast(error.message, "error");
          }
        });
    }, delayMs);
  }

  async function connectGitHub() {
    const providerFormDraft = readProviderForm();
    setBusy(true, "Starting GitHub sign-in…");
    try {
      await saveProviderForm(providerFormDraft);
      const github = await sendMessage({ type: "github:startAuth" });
      state.providers.github = github;
      render();
      window.open(github.pendingAuth.verificationUri, "_blank", "noopener,noreferrer");
      startGitHubPolling(github.pendingAuth.interval);
    } catch (error) {
      if (ExcalidrawSyncUIEvents.isExtensionContextInvalidated(error)) {
        await recoverInvalidatedContext(error, { providerFormDraft });
        return;
      }
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
        state.providers.syncAuthority = "github";
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
      state.providers.syncAuthority = "googleDrive";
      showToast(`Connected to Google Drive as ${state.providers.googleDrive.account.email}.`);
      render();
      syncNow({ quiet: true });
    } catch (error) {
      showToast(error.message, "error");
    } finally {
      setBusy(false, "Saved locally");
    }
  }

  elements.backdrop.addEventListener("click", () => setOpen(false));
  elements.filePicker.addEventListener("change", async () => {
    const files = [...elements.filePicker.files];
    elements.filePicker.value = "";
    const targetFolderId = state.importFolderId;
    state.importFolderId = null;
    await importFiles(files, targetFolderId);
  });

  elements.panel.addEventListener("input", (event) => {
    if (event.target.matches(".search")) {
      state.query = event.target.value;
      const position = event.target.selectionStart;
      render();
      const search = elements.body.querySelector(".search");
      search.focus();
      search.setSelectionRange(position, position);
      return;
    }
    if (event.target.closest(".providers-form") && event.target.matches("input:not([type='checkbox'])")) {
      scheduleSettingsSave(readProviderForm());
    }
  });

  elements.panel.addEventListener("change", (event) => {
    const settingsDraft = event.target.closest(".providers-form") ? readProviderForm() : null;
    if (event.target.matches("select[name='language']")) {
      applyLanguage(event.target.value);
      render();
    }
    if (event.target.matches("select[name='theme']")) {
      applyTheme(event.target.value);
    }
    if (event.target.matches("select[name='saveMode']")) {
      const interval = elements.body.querySelector("select[name='saveInterval']");
      if (interval) interval.disabled = event.target.value !== "interval";
    }
    if (event.target.matches("input[name='launcherVisible']")) {
      applyLauncherVisibility(event.target.checked);
    }
    if (event.target.matches("input[name='sidebarRailHidden']")) {
      applySidebarRailVisibility(event.target.checked);
    }
    if (settingsDraft) scheduleSettingsSave(settingsDraft, 0);
  });

  elements.panel.addEventListener("submit", (event) => {
    if (!event.target.matches(".providers-form")) {
      return;
    }
    event.preventDefault();
    scheduleSettingsSave(readProviderForm(), 0);
  });

  elements.panel.addEventListener("click", async (event) => {
    if (!state.open) {
      setOpen(true, { home: true, acknowledge: true });
      return;
    }
    const button = event.target.closest("[data-action]");
    if (!button) {
      return;
    }
    const action = button.dataset.action;
    try {
      await ExcalidrawSyncUIEvents.runWithInvalidationRecovery(async () => {
        if (action === "close") setOpen(false);
        if (action === "toggle-sidebar") setOpen(!state.open, { home: !state.open, acknowledge: !state.open });
        if (action === "new-file") await createFile();
        if (action === "new-folder") await createFolder();
        if (action === "import") { state.importFolderId = null; elements.filePicker.click(); }
        if (action === "import-link") await importSharedLink();
        if (action === "folder-section-menu") await openFolderSectionMenu(button);
        if (action === "folder-menu") await openFolderMenu(button.dataset.id, button);
        if (action === "manage") { state.view = "manage"; render(); }
        if (action === "open-trash") { state.view = "trash"; render(); }
        if (action === "back-manage") { state.view = "manage"; render(); }
        if (action === "restore-trash") await restoreTrashItem(button.dataset.kind, button.dataset.id);
        if (action === "restore-trash-file") await restoreTrashedFileItem(button.dataset.trashId, button.dataset.id);
        if (action === "restore-trash-folder") await restoreTrashedFolderItem(button.dataset.trashId, button.dataset.id);
        if (action === "notifications") { state.view = "notifications"; markNotificationsRead(); render(); }
        if (action === "back") { state.view = "files"; render(); }
        if (action === "clear-notifications") { state.notifications = []; persistNotifications(); render(); }
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
        if (action === "copy-share-link") await copyShareLink(button.dataset.id);
        if (action === "sort-files") await chooseSortMode();
        if (action === "file-more") await openFileMenu(button.dataset.id, button);
        if (action === "sync") await syncNow();
        if (action === "open-vault") {
          try {
            await sendMessage({ type: "native:openVault" });
          } catch (_error) {
            await sendMessage({ type: "vault:open" });
            showToast("Native helper unavailable; opened the browser recovery vault instead.", "error");
          }
        }
        if (action === "delete-local-files") await deleteAllLocalFiles();
        if (action === "github-connect") await connectGitHub();
        if (action === "google-connect") await connectGoogle();
        if (action === "disconnect") {
          state.providers = await sendMessage({ type: "provider:disconnect", provider: button.dataset.provider });
          showToast("Provider disconnected from this browser.");
          render();
        }
      }, recoverInvalidatedContext);
    } catch (error) {
      showToast(error.message, "error");
    }
  });

  document.addEventListener("keydown", async (event) => {
    if (ExcalidrawSyncUIEvents.isSaveShortcut(event)) {
      event.preventDefault();
      event.stopPropagation();
      await ExcalidrawSyncUIEvents.runWithInvalidationRecovery(
        async () => { await syncNow(); },
        recoverInvalidatedContext,
      );
      return;
    }
    if (event.key === "Escape" && state.open && !elements.modalRoot.children.length) {
      setOpen(false);
    }
  });

  extensionApi.runtime.onMessage.addListener((message) => {
    if (message?.type === "sidebar:toggle") {
      const opening = !state.open;
      setOpen(opening, { home: opening, acknowledge: opening });
    }
  });

  async function checkForDrawingChanges() {
    if (document.hidden || state.busy) {
      return;
    }
    const fingerprint = browserFingerprint();
    if (fingerprint !== state.lastBrowserFingerprint) {
      state.lastBrowserFingerprint = fingerprint;
      state.dirtySince ||= ExcalidrawSyncCore.nowIso();
      updateSaveIndicators();
    }
    if (!state.dirtySince || state.saveSettings.mode === "manual") {
      return;
    }
    const dirtyAgeMs = Date.now() - new Date(state.dirtySince).getTime();
    const shouldSave = state.saveSettings.mode === "edit"
      || dirtyAgeMs >= state.saveSettings.intervalSeconds * 1000;
    if (!shouldSave) {
      return;
    }
    try {
      await ExcalidrawSyncUIEvents.runWithInvalidationRecovery(
        () => captureAndSaveActive(),
        recoverInvalidatedContext,
      );
    } catch (error) {
      addNotification("error", "Autosave needs attention", error.message);
      updateSaveIndicators();
    }
  }

  async function initialize() {
    try {
      let recovery = null;
      let durableRestoreNotice = false;
      try {
        recovery = JSON.parse(sessionStorage.getItem(CONTEXT_RECOVERY_KEY) || "null");
        sessionStorage.removeItem(CONTEXT_RECOVERY_KEY);
        durableRestoreNotice = sessionStorage.getItem(DURABLE_RESTORE_NOTICE_KEY) === "true";
        sessionStorage.removeItem(DURABLE_RESTORE_NOTICE_KEY);
      } catch (_error) {
        sessionStorage.removeItem(CONTEXT_RECOVERY_KEY);
        sessionStorage.removeItem(DURABLE_RESTORE_NOTICE_KEY);
      }
      const [stored, durableBackup, savedLauncherPosition, savedLauncherVisible, savedSidebarRailHidden, launcherIntroduced, savedTheme, savedLanguage, savedSettings, savedState, openRequested, savedNotifications, nativeStatus] = await Promise.all([
        storageGet(WORKSPACE_KEY),
        readDurableWorkspaceBackup().catch(() => null),
        storageGet(LAUNCHER_POSITION_KEY),
        storageGet(LAUNCHER_VISIBLE_KEY),
        storageGet(SIDEBAR_RAIL_HIDDEN_KEY),
        storageGet(LAUNCHER_INTRODUCED_KEY),
        storageGet(THEME_KEY),
        storageGet(LANGUAGE_KEY),
        storageGet(SAVE_SETTINGS_KEY),
        storageGet(SAVE_STATE_KEY),
        storageGet(SIDEBAR_OPEN_REQUEST_KEY),
        storageGet(NOTIFICATIONS_KEY),
        sendMessage({ type: "native:status" }).catch(() => null),
      ]);
      const notificationHistory = Array.isArray(savedNotifications) ? savedNotifications : [];
      state.notifications = notificationHistory.filter(
        (item) => !ExcalidrawSyncUIEvents.isExtensionContextInvalidated(item?.message),
      );
      if (state.notifications.length !== notificationHistory.length) persistNotifications();
      state.nativeStorage = nativeStatus
        ? { available: true, root: nativeStatus.root }
        : { available: false, root: "~/.excalidraw-sync" };
      state.launcherIntroduced = launcherIntroduced !== false;
      applyLauncherPosition(startupLauncherPosition(savedLauncherPosition));
      applyLauncherVisibility(savedLauncherVisible !== false);
      applySidebarRailVisibility(savedSidebarRailHidden === true);
      applyLanguage(savedLanguage || state.language);
      applyTheme(savedTheme);
      state.saveSettings = ExcalidrawSyncUIEvents.normalizeSaveSettings(savedSettings);
      const workspaceSource = ExcalidrawSyncUIEvents.workspaceForRecovery({
        recovery,
        stored,
        durable: durableBackup || nativeStatus?.workspace,
      });
      const restoredFromDurable = !recovery && !stored && Boolean(durableBackup || nativeStatus?.workspace);
      state.workspace = ExcalidrawSyncCore.purgeExpiredTrash(
        ExcalidrawSyncCore.normalizeWorkspace(workspaceSource),
      );
      state.lastSavedAt = recovery?.lastSavedAt || savedState?.lastSavedAt || (workspaceSource ? state.workspace.updatedAt : null);
      state.lastSyncedAt = recovery?.lastSyncedAt || savedState?.lastSyncedAt || null;
      state.unsyncedSince = recovery?.unsyncedSince || savedState?.unsyncedSince || null;
      state.dirtySince = recovery?.dirtySince || null;
      state.view = recovery?.view || "files";
      if (!workspaceSource) {
        await new Promise((resolve) => setTimeout(resolve, 500));
        const scene = await captureScene();
        const active = state.workspace.files[0];
        active.scene = scene;
        active.hash = ExcalidrawSyncCore.hashScene(scene);
        await persistWorkspace({ sync: false });
      }
      ensureWorkspaceHasFile();
      if (recovery || restoredFromDurable) {
        await storageSet(WORKSPACE_KEY, state.workspace);
      }
      await writeDurableWorkspaceBackup(state.workspace).catch((error) => {
        addNotification("error", "Reinstall backup needs attention", error.message);
      });
      await persistLocalVault();
      try {
        const nativeResult = await sendMessage({ type: "native:syncWorkspace", workspace: state.workspace });
        state.nativeStorage = { available: true, root: nativeResult.root };
      } catch (error) {
        recordError("native-storage-initialize", error);
      }
      if (restoredFromDurable) {
        const recoveredActive = state.workspace.files.find((file) => file.id === state.workspace.activeFileId);
        if (recoveredActive) {
          await applyScene(recoveredActive.scene);
        }
        sessionStorage.setItem(DURABLE_RESTORE_NOTICE_KEY, "true");
        location.reload();
        return;
      }
      state.providers = await sendMessage({ type: "providers:get" });
      if (recovery?.providerFormDraft) {
        await saveProviderForm(recovery.providerFormDraft);
      }
      const providerSyncTimes = [state.providers.github?.lastSyncAt, state.providers.googleDrive?.lastSyncAt]
        .filter(Boolean)
        .sort();
      state.lastSyncedAt ||= providerSyncTimes.at(-1) || null;
      state.lastBrowserFingerprint = browserFingerprint();
      render();
      if (durableRestoreNotice) {
        showToast("Recovered your ExcaliSync files from local recovery storage.");
      }
      if (openRequested) {
        await storageSet(SIDEBAR_OPEN_REQUEST_KEY, false);
      }
      if (recovery) {
        state.unsyncedSince ||= hasConnectedCloud() ? recovery.recoveredAt : null;
        await persistSaveState();
        showToast(recovery.providerFormDraft
          ? "GitHub settings restored. Click Connect again to continue."
          : "ExcaliSync reloaded and restored your change.");
      }
      if (openRequested || recovery?.open) {
        setOpen(true, { home: Boolean(openRequested), acknowledge: Boolean(openRequested) });
      }
      setInterval(checkForDrawingChanges, CHANGE_CHECK_INTERVAL_MS);
      setInterval(() => {
        if (state.open && state.view === "notifications") render();
        else updateSaveIndicators();
      }, 30_000);
      window.addEventListener("pagehide", () => {
        captureAndSaveActive({ sync: false, force: true }).catch(() => {});
      });
    } catch (error) {
      showToast(`Excalidraw Sync could not start: ${error.message}`, "error");
    }
  }

  initialize();
})();
