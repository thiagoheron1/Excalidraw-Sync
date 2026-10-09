"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const core = require("../shared/core.js");
const ui = require("../shared/ui-events.js");

const content = fs.readFileSync(path.join(__dirname, "..", "content.js"), "utf8");
const background = fs.readFileSync(path.join(__dirname, "..", "background.js"), "utf8");
const manifest = require("../manifest.json");

test("deletion moves files to a recoverable 30-day trash record", () => {
  const workspace = core.createWorkspace();
  const file = workspace.files[0];
  const deletedAt = "2026-10-07T12:00:00.000Z";
  const result = core.trashEntry(workspace, "file", file.id, deletedAt);
  assert.equal(result.files.length, 0);
  assert.equal(result.trash.length, 1);
  assert.equal(result.trash[0].entry.id, file.id);
  assert.equal(result.trash[0].deletedAt, deletedAt);
  assert.equal(core.purgeExpiredTrash(result, new Date("2026-11-05T12:00:00.000Z")).trash.length, 1);
  assert.equal(core.purgeExpiredTrash(result, new Date("2026-11-07T12:00:01.000Z")).trash.length, 0);
});

test("a deletion tombstone prevents a newer-looking stale cloud copy from reappearing", () => {
  const local = core.createWorkspace();
  const deletedId = local.files[0].id;
  const trashed = core.trashEntry(local, "file", deletedId, "2026-10-07T12:00:00.000Z");
  const staleCloud = core.createWorkspace();
  staleCloud.id = trashed.id;
  staleCloud.folders = structuredClone(local.folders);
  staleCloud.files = [{
    ...structuredClone(local.files[0]),
    updatedAt: "2026-10-07T13:00:00.000Z",
  }];

  const merged = core.mergeWorkspaces(trashed, staleCloud);

  assert.equal(merged.files.some((file) => file.id === deletedId), false);
  assert.equal(core.activeTrashItems(merged).length, 1);
});

test("trash recovery restores files and propagates a newer restoration marker", () => {
  const workspace = core.createWorkspace();
  const original = structuredClone(workspace.files[0]);
  const trashed = core.trashEntry(workspace, "file", original.id, "2026-10-07T12:00:00.000Z");
  const restored = core.restoreTrashEntry(trashed, "file", original.id, "2026-10-07T13:00:00.000Z");
  const staleDeletedMachine = structuredClone(trashed);

  assert.equal(restored.files.find((file) => file.id === original.id)?.name, original.name);
  assert.equal(core.activeTrashItems(restored).length, 0);
  assert.equal(core.mergeWorkspaces(staleDeletedMachine, restored).files.some((file) => file.id === original.id), true);
});

test("deleted folder trees stay hidden and can be restored with their files", () => {
  const workspace = core.createWorkspace();
  const folder = structuredClone(workspace.folders[0]);
  const file = structuredClone(workspace.files[0]);
  const trashed = core.trashEntry(workspace, "folder", folder.id, "2026-10-07T12:00:00.000Z");
  const staleCloud = structuredClone(workspace);
  staleCloud.folders[0].updatedAt = "2026-10-07T14:00:00.000Z";
  staleCloud.files[0].updatedAt = "2026-10-07T14:00:00.000Z";

  const stillDeleted = core.mergeWorkspaces(trashed, staleCloud);
  const restored = core.restoreTrashEntry(trashed, "folder", folder.id, "2026-10-07T15:00:00.000Z");

  assert.equal(stillDeleted.folders.some((item) => item.id === folder.id), false);
  assert.equal(stillDeleted.files.some((item) => item.id === file.id), false);
  assert.equal(restored.folders.some((item) => item.id === folder.id), true);
  assert.equal(restored.files.some((item) => item.id === file.id), true);
  assert.equal(core.activeTrashItems(restored).length, 0);
});

test("settings exposes a 30-day Trash view with recovery actions", () => {
  assert.match(content, /data-action="open-trash"/);
  assert.match(content, /function renderTrashView\(\)/);
  assert.match(content, /data-action="restore-trash"/);
  assert.match(content, /ExcalidrawSyncCore\.restoreTrashEntry/);
  assert.match(content, /state\.view === "trash"/);
  assert.match(content, /native:readTrashBackup/);
  assert.doesNotMatch(content, /data-action="restore-trash"[^>]*disabled/);
  assert.doesNotMatch(content, /data-action="restore-trash-file"[^>]*disabled/);
  assert.doesNotMatch(content, /data-action="restore-trash-folder"[^>]*disabled/);
});

test("new file and folder dialogs start empty and use descriptive placeholders", () => {
  assert.match(content, /label: "File name", value: "", placeholder: "New File"/);
  assert.match(content, /label: "Folder name", value: "", placeholder: "New Folder"/);
  assert.match(content, /field\.placeholder/);
  assert.doesNotMatch(content, /label: "Folder name", value: "New folder"/);
});

test("new file dialog shows Folder first but selects the filename input on open", () => {
  const start = content.indexOf('title: "New file"');
  const end = content.indexOf('confirmLabel: "Create file"', start);
  const dialog = content.slice(start, end);

  assert.ok(start >= 0);
  assert.ok(dialog.indexOf('label: "Folder"') < dialog.indexOf('label: "File name"'));
  assert.match(dialog, /autoSelectName: "name"/);
});

test("Trash is the final settings section after cloud sync", () => {
  const start = content.indexOf("function renderManageView");
  const end = content.indexOf("function renderTrashedFolderTree", start);
  const manageView = content.slice(start, end);

  assert.ok(manageView.indexOf("<strong>Trash</strong>") > manageView.indexOf("<strong>Cloud sync</strong>"));
  assert.ok(manageView.indexOf("<strong>Trash</strong>") < manageView.indexOf("settings-auto-save"));
});

test("GitHub receives placeholders for empty folders", () => {
  const workspace = core.createWorkspace();
  workspace.files = [];
  workspace.folders.push({
    id: "empty-child",
    parentId: workspace.folders[0].id,
    name: "Empty child",
    createdAt: workspace.updatedAt,
    updatedAt: workspace.updatedAt,
  });

  const providerFiles = core.buildProviderFiles(workspace, "Excalidraw", { includeFolderPlaceholders: true });
  const placeholders = providerFiles.filter((file) => file.kind === "folder-placeholder");

  assert.deepEqual(placeholders.map((file) => file.path), [
    "excalidraw/my-diagrams/empty-child/.gitkeep",
  ]);
  assert.match(background, /includeFolderPlaceholders: true/);
  assert.doesNotMatch(background, /ensureDriveFolder/);
});

test("rich local Trash metadata survives a cloud tombstone with only an id", () => {
  const workspace = core.createWorkspace();
  const folder = workspace.folders[0];
  const trashed = core.trashEntry(workspace, "folder", folder.id, "2026-10-07T12:00:00.000Z");
  const remote = core.workspaceFromProviderIndex({
    workspaceId: trashed.id,
    generatedAt: "2026-10-07T12:00:00.000Z",
    tombstones: [{ kind: "folder", id: folder.id, deletedAt: "2026-10-07T12:00:00.000Z" }],
  });

  const mergedTrash = core.activeTrashItems(core.mergeWorkspaces(trashed, remote))[0];

  assert.equal(mergedTrash.entry.name, folder.name);
  assert.equal(mergedTrash.files[0].name, workspace.files[0].name);
});

test("cloud Trash metadata never replaces the recoverable local scene or blocks Restore", () => {
  const workspace = core.createWorkspace();
  const folder = workspace.folders[0];
  const file = structuredClone(workspace.files[0]);
  const trashed = core.trashEntry(workspace, "folder", folder.id, "2026-10-07T12:00:00.000Z");
  const metadataOnly = core.workspaceFromProviderIndex({
    workspaceId: trashed.id,
    generatedAt: "2026-10-07T12:00:00.000Z",
    tombstones: [{
      kind: "folder",
      id: folder.id,
      deletedAt: "2026-10-07T12:00:00.000Z",
      entry: { id: folder.id, name: folder.name },
      folders: trashed.trash[0].folders.map(({ scene: _scene, ...entry }) => entry),
      files: trashed.trash[0].files.map(({ scene: _scene, ...entry }) => entry),
    }],
  });

  for (const [left, right] of [[trashed, metadataOnly], [metadataOnly, trashed]]) {
    const merged = core.mergeWorkspaces(left, right);
    const mergedTrash = core.activeTrashItems(merged)[0];
    assert.deepEqual(mergedTrash.files[0].scene, file.scene);
    const restored = core.restoreTrashEntry(merged, "folder", folder.id, "2026-10-07T13:00:00.000Z");
    assert.deepEqual(restored.files.find((entry) => entry.id === file.id)?.scene, file.scene);
  }
});

test("a file can be restored from a trashed folder without restoring its siblings", () => {
  const workspace = core.createWorkspace();
  const root = workspace.folders[0];
  const child = {
    id: "trash-child",
    parentId: root.id,
    name: "Child",
    createdAt: workspace.updatedAt,
    updatedAt: workspace.updatedAt,
  };
  const childFile = {
    ...structuredClone(workspace.files[0]),
    id: "child-file",
    folderId: child.id,
    name: "Child drawing",
  };
  workspace.folders.push(child);
  workspace.files.push(childFile);
  const trashed = core.trashEntry(workspace, "folder", root.id, "2026-10-07T12:00:00.000Z");

  const restored = core.restoreTrashedFile(trashed, root.id, childFile.id, "2026-10-07T13:00:00.000Z");

  assert.equal(restored.files.some((file) => file.id === childFile.id), true);
  assert.equal(restored.files.some((file) => file.id === workspace.files[0].id), false);
  assert.equal(restored.folders.some((folder) => folder.id === root.id), true);
  assert.equal(restored.folders.some((folder) => folder.id === child.id), true);
  assert.equal(core.activeTrashItems(restored).length, 1);
  assert.match(content, /data-action="restore-trash-file"/);
  assert.match(content, /data-action="restore-trash-folder"/);
  assert.match(content, /class="trash-tree"/);
});

test("a subfolder can be restored from Trash with its tree while sibling folders stay deleted", () => {
  const workspace = core.createWorkspace();
  const root = workspace.folders[0];
  const restoredChild = {
    id: "restored-child",
    parentId: root.id,
    name: "Restore me",
    createdAt: workspace.updatedAt,
    updatedAt: workspace.updatedAt,
  };
  const deletedSibling = {
    id: "deleted-sibling",
    parentId: root.id,
    name: "Keep deleted",
    createdAt: workspace.updatedAt,
    updatedAt: workspace.updatedAt,
  };
  const restoredFile = {
    ...structuredClone(workspace.files[0]),
    id: "restored-file",
    folderId: restoredChild.id,
    name: "Recovered drawing",
  };
  const siblingFile = {
    ...structuredClone(workspace.files[0]),
    id: "sibling-file",
    folderId: deletedSibling.id,
    name: "Still deleted",
  };
  workspace.folders.push(restoredChild, deletedSibling);
  workspace.files.push(restoredFile, siblingFile);
  const trashed = core.trashEntry(workspace, "folder", root.id, "2026-10-07T12:00:00.000Z");

  const restored = core.restoreTrashedFolder(trashed, root.id, restoredChild.id, "2026-10-07T13:00:00.000Z");

  assert.equal(restored.folders.some((folder) => folder.id === root.id), true);
  assert.equal(restored.folders.some((folder) => folder.id === restoredChild.id), true);
  assert.equal(restored.folders.some((folder) => folder.id === deletedSibling.id), false);
  assert.equal(restored.files.some((file) => file.id === restoredFile.id), true);
  assert.equal(restored.files.some((file) => file.id === siblingFile.id), false);
  assert.equal(core.activeTrashItems(restored).length, 1);
});

test("notification history is persisted and opening it only marks items read", () => {
  assert.match(content, /NOTIFICATIONS_KEY/);
  assert.match(content, /persistNotifications/);
  assert.match(content, /markNotificationsRead/);
  assert.doesNotMatch(content, /notifications = state\.notifications\.filter\(\(item\) => item\.level !== "error"\)/);
});

test("library exposes native disk sync, link import, sharing, sorting, and drag/drop", () => {
  assert.ok(manifest.permissions.includes("nativeMessaging"));
  assert.match(background, /native:syncWorkspace/);
  assert.match(content, /data-action="folder-section-menu"/);
  assert.match(content, /Import from file/);
  assert.match(content, /Import from link/);
  assert.match(content, /label: "Copy read-only link"/);
  assert.match(content, /copyShareLink/);
  assert.match(content, /data-testid="main-menu-trigger"/);
  assert.match(content, /Export to Link/);
  assert.match(content, /Order folders and files/);
  assert.match(content, /chooseSortMode/);
  assert.match(content, /draggable="true"/);
  assert.match(content, /dragstart/);
  assert.match(content, /drop/);
});

test("folder contents render as an indented tree with visible connector guides", () => {
  assert.match(content, /\.folder-files \{[^}]*margin-left: 18px;[^}]*padding-left: 10px;[^}]*border-left: 1px solid var\(--border\)/);
  assert.match(content, /\.folder-files > \.file-row::before \{[^}]*left: -11px;[^}]*border-top: 1px solid var\(--border\)/);
  assert.match(content, /\.folder-files > \.folder-children > \.folder::before \{[^}]*left: -11px;[^}]*border-top: 1px solid var\(--border\)/);
  assert.match(content, /<div class="folder-files">[\s\S]*?folderFiles\.map\(\(file\) => fileRow\(file\)\)/);
  assert.match(content, /<div class="folder-children">\$\{childFolders\.map\(renderFolder\)\.join\(""\)\}<\/div>/);
});

test("folders can be drag-reordered and the order menu exposes a custom folder order", () => {
  const workspace = core.createWorkspace();
  const first = workspace.folders[0];
  const second = { id: "folder-second", name: "Second", createdAt: "2026-10-07T10:00:00.000Z", updatedAt: "2026-10-07T10:00:00.000Z" };
  const third = { id: "folder-third", name: "Third", createdAt: "2026-10-07T11:00:00.000Z", updatedAt: "2026-10-07T11:00:00.000Z" };
  workspace.folders.push(second, third);
  workspace.folderSortMode = "alphabetical";

  const reordered = core.moveFolder(workspace, third.id, first.id, "before");

  assert.deepEqual(reordered.folders.map((folder) => folder.id), [third.id, first.id, second.id]);
  assert.equal(reordered.folderSortMode, "manual");
  const restored = core.normalizeWorkspace(JSON.parse(JSON.stringify(reordered)));
  assert.deepEqual(restored.folders.map((folder) => folder.id), [third.id, first.id, second.id]);
  assert.equal(restored.folderSortMode, "manual");
  const providerIndex = JSON.parse(core.buildProviderFiles(reordered).find((file) => file.id === "workspace-index").content);
  assert.deepEqual(providerIndex.folders.map((folder) => folder.id), [third.id, first.id, second.id]);
  assert.equal(providerIndex.folderSortMode, "manual");
  assert.match(content, /data-kind="folder"[\s\S]*?draggable="true"/);
  assert.match(content, /draggedFolderId/);
  assert.match(content, /label: "Folder order"/);
  assert.match(content, /label: "Custom \(drag and drop\)"/);
});

test("dropping a folder onto the center of another folder creates a safe subfolder", () => {
  const workspace = core.createWorkspace();
  const parent = workspace.folders[0];
  const child = {
    id: "folder-child",
    parentId: null,
    name: "Child",
    createdAt: parent.createdAt,
    updatedAt: parent.updatedAt,
  };
  workspace.folders.push(child);
  workspace.files[0].folderId = child.id;

  assert.equal(ui.folderDropMode(117, { top: 100, height: 40 }), "inside");
  assert.equal(ui.folderDropMode(102, { top: 100, height: 40 }), "before");
  assert.equal(ui.folderDropMode(138, { top: 100, height: 40 }), "after");

  const nested = core.moveFolderToParent(workspace, child.id, parent.id);
  assert.equal(nested.folders.find((folder) => folder.id === child.id).parentId, parent.id);
  assert.equal(
    core.buildProviderFiles(nested).find((file) => file.id === workspace.files[0].id).path,
    "excalidraw/my-diagrams/child/untitled.excalidraw",
  );
  const refusedCycle = core.moveFolderToParent(nested, parent.id, child.id);
  assert.equal(refusedCycle.folders.find((folder) => folder.id === parent.id).parentId, null);

  assert.match(content, /folderDropMode\(event\.clientY, head\.getBoundingClientRect\(\)\)/);
  assert.match(content, /dropMode === "inside"[\s\S]*?moveFolderToParent/);
  assert.match(content, /classList\.toggle\("nest-target", dropMode === "inside"\)/);
  assert.match(content, /moveFolderToParent\([\s\S]*?await persistWorkspace\(\)/);
});

test("dropping a subfolder on the Folders header moves it back to the top level", () => {
  const workspace = core.createWorkspace();
  const parent = workspace.folders[0];
  const child = {
    id: "folder-child",
    parentId: parent.id,
    name: "Child",
    createdAt: parent.createdAt,
    updatedAt: parent.updatedAt,
  };
  workspace.folders.push(child);
  workspace.files[0].folderId = child.id;

  const lifted = core.moveFolderToParent(workspace, child.id, null);
  assert.equal(lifted.folders.find((folder) => folder.id === child.id).parentId, null);
  assert.equal(
    core.buildProviderFiles(lifted).find((file) => file.id === workspace.files[0].id).path,
    "excalidraw/child/untitled.excalidraw",
  );

  assert.match(content, /data-drop-root/);
  assert.match(content, /querySelector\("\[data-drop-root\]"\)/);
  assert.match(content, /moveFolderToParent\(state\.workspace, state\.draggedFolderId, null\)/);
  assert.match(content, /Drop here to move to top level/);
});

test("GitHub OAuth setup instructions are available in provider settings", () => {
  assert.match(content, /Create a GitHub OAuth App/);
  assert.doesNotMatch(content, /Create a Google OAuth client/);
});

test("GitHub OAuth instructions explain every registration field and required toggle", () => {
  assert.match(content, /Application name:/);
  assert.match(content, /Homepage URL:/);
  assert.match(content, /Application description:/);
  assert.match(content, /Redirect URI:/);
  assert.match(content, /Allow wildcard matching/);
  assert.match(content, /Enable Device Flow/);
  assert.match(content, /Expire user access tokens/);
  assert.match(content, /https:\/\/excalidraw\.com\//);
  assert.match(content, /securely rotates Device Flow access and refresh tokens/);
  assert.match(content, /Do not generate, paste, or share a client secret/);
});
