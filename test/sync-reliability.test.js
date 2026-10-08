"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const core = require("../shared/core.js");
const ui = require("../shared/ui-events.js");

const content = fs.readFileSync(path.join(__dirname, "..", "content.js"), "utf8");
const background = fs.readFileSync(path.join(__dirname, "..", "background.js"), "utf8");

test("Command-S and Control-S trigger explicit save while a plain S does not", () => {
  assert.equal(ui.isSaveShortcut({ key: "s", metaKey: true, ctrlKey: false }), true);
  assert.equal(ui.isSaveShortcut({ key: "S", metaKey: false, ctrlKey: true }), true);
  assert.equal(ui.isSaveShortcut({ key: "s", metaKey: false, ctrlKey: false }), false);
  assert.match(content, /isSaveShortcut\(event\)/);
  assert.match(content, /await syncNow/);
});

test("a stale GitHub SHA conflict refreshes state and retries instead of requiring reconnect", async () => {
  let attempts = 0;
  const result = await core.retryConflict(async () => {
    attempts += 1;
    if (attempts === 1) {
      const error = new Error("stale sha");
      error.status = 409;
      throw error;
    }
    return "updated";
  });
  assert.equal(result, "updated");
  assert.equal(attempts, 2);
  assert.match(background, /putGitHubContentWithRetry/);
  assert.match(background, /syncInFlight = syncInFlight[\s\S]*?\.then\(\(\) => syncAll\(message\.workspace\)\)/);
  assert.match(background, /body\?\.error \|\| !body\?\.access_token/);
});

test("GitHub sync survives several consecutive cross-machine SHA conflicts", async () => {
  let attempts = 0;
  const result = await core.retryConflict(async () => {
    attempts += 1;
    if (attempts <= 5) {
      const error = new Error("excalidraw/personal/bbbbbb.excalidraw does not match stale sha (409)");
      error.status = 409;
      throw error;
    }
    return "updated";
  }, { attempts: 6, delayMs: 0 });

  assert.equal(result, "updated");
  assert.equal(attempts, 6);
  assert.match(background, /getGitHubContent\(owner, repo, file\.path, token, branch, \{ fresh: true \}\)/);
  assert.match(background, /cache: "no-store"/);
  assert.match(background, /"Cache-Control": "no-cache"/);
  assert.match(background, /attempts: 8, delayMs: 200, jitterMs: 400/);
  assert.match(background, /retryable: error\.status === 409/);
  assert.match(content, /if \(retryableFailure\) \{[\s\S]*?scheduleCloudSync\(5000\)/);
});

test("GitHub sync creates no write plan when every remote blob already matches", async () => {
  const desiredFiles = [
    { id: "drawing", path: "excalidraw/work/drawing.excalidraw", content: '{"type":"excalidraw"}\n' },
    { id: "workspace-index", path: "excalidraw/.excalidraw-sync.json", content: '{"formatVersion":2}\n' },
  ];
  const remoteTree = new Map();
  for (const file of desiredFiles) {
    remoteTree.set(file.path, await core.gitBlobSha(file.content));
  }

  const plan = await core.providerChangePlan(desiredFiles, remoteTree, desiredFiles.map((file) => file.path));

  assert.deepEqual(plan.changedFiles, []);
  assert.deepEqual(plan.removedPaths, []);
  assert.match(background, /if \(!changedFiles\.length && !removedPaths\.length\)/);
});

test("provider errors are only active when newer than the last successful sync", () => {
  assert.equal(core.hasActiveProviderError({
    lastError: "old error",
    lastErrorAt: "2026-10-07T12:00:00.000Z",
    lastSyncAt: "2026-10-07T12:00:03.000Z",
  }), false);
  assert.equal(core.hasActiveProviderError({
    lastError: "new error",
    lastErrorAt: "2026-10-07T12:00:04.000Z",
    lastSyncAt: "2026-10-07T12:00:03.000Z",
  }), true);
  assert.match(content, /state\.open && \(state\.view === "files" \|\| state\.view === "manage"\)/);
});

test("one cloud authority is selected while local storage remains the offline fallback", () => {
  assert.match(background, /syncAuthority/);
  assert.match(background, /selectedSyncProvider/);
  assert.match(content, /select name="syncAuthority"/);
  assert.match(content, /Local storage remains the offline fallback/);
  assert.match(content, /state\.providers\.syncAuthority = "github"/);
  assert.match(content, /state\.providers\.syncAuthority = "googleDrive"/);
});

test("renaming files and folders produces new provider paths and queues cloud cleanup", () => {
  const workspace = core.createWorkspace();
  const folder = workspace.folders[0];
  const file = workspace.files[0];
  folder.name = "Old folder";
  file.name = "Old drawing";
  const oldPaths = core.buildProviderFiles(workspace, "Excalidraw").map((item) => item.path);
  folder.name = "New folder";
  folder.updatedAt = "2026-10-07T12:00:01.000Z";
  file.name = "New drawing";
  file.updatedAt = "2026-10-07T12:00:01.000Z";
  const newPaths = core.buildProviderFiles(workspace, "Excalidraw").map((item) => item.path);

  assert.ok(oldPaths.includes("excalidraw/old-folder/old-drawing.excalidraw"));
  assert.ok(newPaths.includes("excalidraw/new-folder/new-drawing.excalidraw"));
  assert.ok(!newPaths.includes("excalidraw/old-folder/old-drawing.excalidraw"));
  assert.match(content, /async function renameEntry[\s\S]*?await persistWorkspace\(\)/);
  assert.match(background, /providerChangePlan\([\s\S]*?previousPaths/);
  assert.match(background, /for \(const path of removedPaths\)/);
  assert.match(background, /deleteGitHubContentWithRetry/);
});

test("warning reasons use immediate accessible tooltips and provider messages do not truncate", () => {
  assert.match(content, /data-tooltip=/);
  assert.match(content, /\.has-tooltip:hover::after/);
  assert.match(content, /\.cloud-provider-copy small \{[^}]*white-space: normal/);
});

test("folder section and folder rows expose consolidated action menus", () => {
  assert.match(content, /data-action="folder-section-menu"/);
  assert.match(content, /data-action="folder-menu"/);
  assert.match(content, /Import from file/);
  assert.match(content, /Import from link/);
  assert.match(content, /value: "new-file", label: "New file"/);
  assert.match(content, /value: "new-folder", label: "New folder"/);
  assert.match(content, /if \(action === "new-file"\) await createFile\(\)/);
  assert.match(content, /if \(action === "new-folder"\) await createFolder\(\)/);
  const filesStart = content.indexOf("function renderFilesView");
  const filesEnd = content.indexOf("function providerLink", filesStart);
  const filesView = content.slice(filesStart, filesEnd);
  assert.doesNotMatch(filesView, /data-action="folder-add"/);
  assert.ok(filesView.indexOf('class="search-wrap"') < filesView.indexOf('data-drop-root>Folders'));
  assert.match(filesView, /class="search-wrap"[\s\S]*?<section class="section">[\s\S]*?data-drop-root>Folders/);
});

test("every three-dot control opens an anchored dropdown instead of an action dialog", () => {
  assert.match(content, /function showActionDropdown/);
  assert.match(content, /className = "action-dropdown"/);
  assert.doesNotMatch(content, /function showActionDialog/);
  assert.match(content, /openFolderSectionMenu\(button\)/);
  assert.match(content, /openFolderMenu\(button\.dataset\.id, button\)/);
  assert.match(content, /openFileMenu\(button\.dataset\.id, button\)/);
});

test("file details lists the folder before the file name", () => {
  const start = content.indexOf('title: "File details"');
  const end = content.indexOf('confirmLabel: "Save"', start);
  const fields = content.slice(start, end);
  assert.ok(fields.indexOf('label: "Folder"') < fields.indexOf('label: "File name"'));
});
