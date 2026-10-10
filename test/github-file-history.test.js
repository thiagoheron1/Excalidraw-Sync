"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const core = require("../shared/core.js");

const content = fs.readFileSync(path.join(__dirname, "..", "content.js"), "utf8");
const background = fs.readFileSync(path.join(__dirname, "..", "background.js"), "utf8");

test("restoring a GitHub version replaces only the selected file", () => {
  const workspace = core.createWorkspace();
  const selected = workspace.files[0];
  selected.name = "Selected drawing";
  selected.pinned = true;
  const untouched = {
    ...selected,
    id: "file-untouched",
    name: "Untouched",
    pinned: false,
    scene: { ...core.emptyScene(), elements: [{ id: "keep", type: "rectangle" }] },
  };
  untouched.hash = core.hashScene(untouched.scene);
  workspace.files.push(untouched);
  workspace.trash.push({
    id: "trash-record",
    kind: "file",
    deletedAt: "2026-10-08T12:00:00.000Z",
    file: { id: "deleted-file", name: "Deleted drawing" },
  });
  const selectedMetadata = {
    id: selected.id,
    folderId: selected.folderId,
    name: selected.name,
    pinned: selected.pinned,
    createdAt: selected.createdAt,
  };
  const untouchedSnapshot = structuredClone(untouched);
  const foldersSnapshot = structuredClone(workspace.folders);
  const trashSnapshot = structuredClone(workspace.trash);
  const inputSnapshot = structuredClone(workspace);
  const restoredScene = {
    ...core.emptyScene(),
    elements: [{ id: "restored", type: "ellipse" }],
  };

  const restored = core.restoreFileVersion(
    workspace,
    selected.id,
    restoredScene,
    "2026-10-09T12:00:00.000Z",
  );

  assert.deepEqual(restored.files.find((file) => file.id === selected.id).scene, core.normalizeScene(restoredScene));
  assert.deepEqual(restored.files.find((file) => file.id === untouched.id), untouchedSnapshot);
  assert.deepEqual(restored.folders, foldersSnapshot);
  assert.deepEqual(restored.trash, trashSnapshot);
  assert.deepEqual(workspace, inputSnapshot, "restoring must not mutate the source workspace");
  assert.deepEqual(
    Object.fromEntries(Object.entries(restored.files.find((file) => file.id === selected.id))
      .filter(([key]) => Object.hasOwn(selectedMetadata, key))),
    selectedMetadata,
  );
  assert.equal(restored.activeFileId, selected.id);
});

test("syncing a restored version uploads only that drawing and the workspace index", async () => {
  const workspace = core.createWorkspace();
  const selected = workspace.files[0];
  selected.name = "Selected";
  selected.hash = core.hashScene(selected.scene);
  const untouched = {
    ...selected,
    id: "file-untouched-sync",
    name: "Untouched",
    scene: { ...core.emptyScene(), elements: [{ id: "keep-sync", type: "diamond" }] },
  };
  untouched.hash = core.hashScene(untouched.scene);
  workspace.files.push(untouched);

  const before = core.buildProviderFiles(workspace, "Excalidraw", { includeFolderPlaceholders: true });
  const remoteTree = new Map(await Promise.all(before.map(async (file) => [file.path, await core.gitBlobSha(file.content)])));
  const restored = core.restoreFileVersion(
    workspace,
    selected.id,
    { ...core.emptyScene(), elements: [{ id: "restored-sync", type: "ellipse" }] },
    "2026-10-09T13:00:00.000Z",
  );
  const desired = core.buildProviderFiles(restored, "Excalidraw", { includeFolderPlaceholders: true });
  const plan = await core.providerChangePlan(desired, remoteTree, before.map((file) => file.path));

  assert.deepEqual(
    plan.changedFiles.map((file) => file.id).sort(),
    [selected.id, "workspace-index"].sort(),
  );
  assert.deepEqual(plan.removedPaths, []);
  assert.ok(!plan.changedFiles.some((file) => file.id === untouched.id));
});

test("every file exposes GitHub history with preview and confirmed restore", () => {
  assert.match(content, /data-action="file-history"/);
  assert.match(content, /async function openFileHistory/);
  assert.match(content, /Preview this version/);
  assert.match(content, /Restore this version/);
  assert.match(content, /ExcalidrawSyncCore\.restoreFileVersion/);
  assert.match(background, /case "github:fileHistory"/);
  assert.match(background, /case "github:fileVersion"/);
  assert.match(background, /\/commits\?sha=/);
  assert.match(background, /path=\$\{encodeURIComponent\(file\.path\)\}/);
});
