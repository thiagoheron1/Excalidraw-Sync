"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { JSDOM } = require("jsdom");
const {
  excalidrawThemeFromClassName,
  normalizeTheme,
  observeExcalidrawTheme,
} = require("../shared/ui-events.js");

const content = fs.readFileSync(path.join(__dirname, "..", "content.js"), "utf8");

test("theme preference defaults to following Excalidraw and resolves its live theme", () => {
  assert.equal(normalizeTheme("excalidraw"), "excalidraw");
  assert.equal(normalizeTheme("system"), "system");
  assert.equal(normalizeTheme("light"), "light");
  assert.equal(normalizeTheme("dark"), "dark");
  assert.equal(normalizeTheme("unknown"), "excalidraw");
  assert.equal(normalizeTheme(), "excalidraw");
  assert.equal(excalidrawThemeFromClassName("excalidraw theme--dark"), "dark");
  assert.equal(excalidrawThemeFromClassName("excalidraw"), "light");
  assert.match(content, /option value="excalidraw"[^>]*selected[^>]*>Follow Excalidraw/);
  assert.match(content, /ExcalidrawSyncUIEvents\.observeExcalidrawTheme/);
});

test("follow-Excalidraw mode reacts when Excalidraw switches between light and dark", async () => {
  const dom = new JSDOM('<div class="excalidraw"></div>');
  const observedThemes = [];
  const stop = observeExcalidrawTheme({
    documentRoot: dom.window.document,
    MutationObserverCtor: dom.window.MutationObserver,
    onTheme: (theme) => observedThemes.push(theme),
  });
  const excalidraw = dom.window.document.querySelector(".excalidraw");

  assert.deepEqual(observedThemes, ["light"]);
  excalidraw.classList.add("theme--dark");
  await new Promise((resolve) => dom.window.setTimeout(resolve, 0));
  assert.equal(observedThemes.at(-1), "dark");

  excalidraw.classList.remove("theme--dark");
  await new Promise((resolve) => dom.window.setTimeout(resolve, 0));
  assert.equal(observedThemes.at(-1), "light");
  stop();
  dom.window.close();
});

test("manage sync exposes theme selection and a recognizable GitHub icon", () => {
  assert.match(content, /select name="theme"/);
  assert.match(content, /providerIcon\("github", 20\)/);
  assert.match(content, /class="provider-icon github"/);
  assert.doesNotMatch(content, /class="provider-icon google-drive"/);
});

test("settings use compact groups and collapsible cloud providers without duplicate sync actions", () => {
  const start = content.indexOf("function renderManageView");
  const end = content.indexOf("function renderNotificationsView", start);
  const manageView = content.slice(start, end);

  assert.match(manageView, /<h2>Settings<\/h2>/);
  assert.match(manageView, /class="providers-form settings-form"/);
  assert.match(manageView, /class="provider-disclosure"/);
  assert.match(manageView, /<strong>General<\/strong>/);
  assert.match(manageView, /<strong>Saving<\/strong>/);
  assert.match(manageView, /<strong>Local storage<\/strong>/);
  assert.match(manageView, /<strong>Cloud sync<\/strong>/);
  assert.doesNotMatch(manageView, /Sync all now/);
  assert.doesNotMatch(manageView, />Save changes<\/button>/);
  assert.match(manageView, /class="settings-auto-save" role="status"/);
});

test("settings save automatically after selects, toggles, and debounced text edits", () => {
  assert.match(content, /function scheduleSettingsSave\(formData, delayMs = 450\)/);
  assert.match(content, /settingsSaveTimer = setTimeout/);
  assert.match(content, /settingsSaveQueue = settingsSaveQueue/);
  assert.match(content, /event\.target\.closest\("\.providers-form"\)/);
  assert.match(content, /scheduleSettingsSave\(readProviderForm\(\)\)/);
  assert.match(content, /scheduleSettingsSave\(settingsDraft, 0\)/);
});

test("local vault persistence completes before optional cloud synchronization", () => {
  const start = content.indexOf("async function persistWorkspace");
  const end = content.indexOf("async function captureAndSaveActive", start);
  const persistWorkspace = content.slice(start, end);

  assert.ok(persistWorkspace.indexOf("await storageSet(WORKSPACE_KEY") >= 0);
  assert.ok(persistWorkspace.indexOf("await persistLocalVault()") > persistWorkspace.indexOf("await storageSet(WORKSPACE_KEY"));
  assert.ok(persistWorkspace.indexOf("scheduleCloudSync()") > persistWorkspace.indexOf("await persistLocalVault()"));
});

test("save controls, timestamps, stale indicators, and notification center are exposed", () => {
  assert.match(content, /select name="saveMode"/);
  assert.match(content, /select name="saveInterval"/);
  assert.match(content, /select name="syncDelay"/);
  assert.match(content, /Cloud sync after editing/);
  assert.match(content, /state\.saveSettings\.syncDelaySeconds \* 1000/);
  assert.match(content, /select name="staleMinutes"/);
  assert.match(content, /<strong>Local save<\/strong>/);
  assert.match(content, /<strong>Cloud sync<\/strong>/);
  assert.match(content, /file-row\.sync-pending/);
  assert.match(content, /file-row\.sync-stale/);
  assert.match(content, /class="sync-warning[^"]*"/);
  assert.match(content, /data-tooltip=/);
  assert.match(content, /data-action="notifications"/);
  assert.match(content, /markNotificationsRead/);
  assert.match(content, /readAt/);
});

test("primary file controls use the requested order and expose one-click sync", () => {
  const renderStart = content.indexOf("function renderFilesView");
  const renderEnd = content.indexOf("function providerLink", renderStart);
  const filesView = content.slice(renderStart, renderEnd);
  assert.ok(filesView.indexOf('class="quick-grid"') < filesView.indexOf('class="sync-row'));
  assert.ok(filesView.indexOf('class="sync-row') < filesView.indexOf('class="search-wrap"'));
  assert.match(filesView, /aria-label="Sync all documents now"/);
  assert.match(content, /class="icon-button header-sync"/);
});

test("primary file actions render as stacked full-width menu rows", () => {
  assert.match(content, /\.quick-grid \{[^}]*display: flex;[^}]*flex-direction: column;[^}]*gap: 2px/);
  assert.match(content, /\.quick-action \{[^}]*width: 100%;[^}]*border: 0;[^}]*background: transparent/);
  assert.match(content, /\.quick-action:hover \{[^}]*background: var\(--surface-2\);[^}]*transform: none/);
  assert.match(content, /<nav class="quick-grid" aria-label="File actions">/);
});

test("home sections have dividers after Manage and cloud providers", () => {
  assert.match(content, /\.quick-grid \{[^}]*border-bottom: 1px solid var\(--border\)/);
  assert.match(content, /\.cloud-status \{[^}]*border-bottom: 1px solid var\(--border\)/);
});

test("files home shows automatic sync and last-sync status for GitHub", () => {
  const renderStart = content.indexOf("function renderFilesView");
  const renderEnd = content.indexOf("function providerLink", renderStart);
  const filesView = content.slice(renderStart, renderEnd);

  assert.match(content, /function providerHomeCard/);
  assert.match(content, /Automatic sync on/);
  assert.match(content, /Automatic sync off/);
  assert.match(content, /Last sync \$\{formatRelativeTime\(provider\.lastSyncAt\)\}/);
  assert.match(content, /providerHomeCard\("github", "GitHub"/);
  assert.doesNotMatch(content, /providerHomeCard\("googleDrive"/);
  assert.match(filesView, /aria-label="Automatic cloud sync status"/);
  assert.ok(filesView.indexOf('class="sync-row') < filesView.indexOf('class="cloud-status"'));
  assert.ok(filesView.indexOf('class="cloud-status"') < filesView.indexOf('class="search-wrap"'));
});

test("launcher can be hidden while the browser toolbar remains an opening path", () => {
  assert.match(content, /class="launcher-label">ExcaliSync/);
  assert.match(content, /name="launcherVisible"/);
  assert.match(content, /LAUNCHER_VISIBLE_KEY/);
  assert.match(content, /user-hidden/);
});

test("manage view can open the browser-local vault", () => {
  assert.match(content, /data-action="open-vault"/);
  assert.match(content, /type: "vault:open"/);
});

test("a version-marker-only change clears the dirty warning when the scene hash is unchanged", () => {
  assert.match(content, /if \(!force && hash === file\.hash\) \{\s+state\.dirtySince = null;\s+updateSaveIndicators\(\);\s+return false;/);
});
