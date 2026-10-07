"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const core = require("../shared/core.js");

test("normalizes an Excalidraw file and preserves embedded files", () => {
  const scene = core.normalizeScene({
    type: "excalidraw",
    version: 2,
    source: "https://excalidraw.com",
    elements: [{ id: "shape-1", type: "rectangle" }],
    appState: { viewBackgroundColor: "#ffffff" },
    files: { image: { id: "image", dataURL: "data:image/png;base64,AA==" } },
  });
  assert.equal(scene.elements[0].id, "shape-1");
  assert.equal(scene.files.image.id, "image");
});

test("scene hashes ignore Excalidraw's mutable lastRetrieved metadata", () => {
  const first = core.emptyScene();
  first.files.image = { id: "image", dataURL: "data:image/png;base64,AA==", lastRetrieved: 1 };
  const second = structuredClone(first);
  second.files.image.lastRetrieved = 999;
  assert.equal(core.hashScene(first), core.hashScene(second));
});

test("provider files mirror workspace folders with unique safe paths", () => {
  const workspace = core.createWorkspace("Architecture");
  workspace.folders[0].name = "Work / Architecture";
  workspace.files[0].name = "API: v2";
  workspace.files.push({
    ...workspace.files[0],
    id: "second",
    name: "API: v2",
  });
  const files = core.buildProviderFiles(workspace, "Team Drawings");
  const drawingPaths = files.filter((file) => file.id !== "workspace-index").map((file) => file.path);
  assert.deepEqual(drawingPaths, [
    "team-drawings/work-architecture/api-v2.excalidraw",
    "team-drawings/work-architecture/api-v2-2.excalidraw",
  ]);
  assert.equal(files.at(-1).path, "team-drawings/.excalidraw-sync.json");
});

test("deleting a folder removes only that folder and its children", () => {
  const workspace = core.createWorkspace();
  const retainedFolder = { id: "retained", name: "Retained", createdAt: core.nowIso(), updatedAt: core.nowIso() };
  const retainedFile = {
    ...workspace.files[0],
    id: "retained-file",
    folderId: retainedFolder.id,
  };
  workspace.folders.push(retainedFolder);
  workspace.files.push(retainedFile);
  const result = core.removeEntry(workspace, "folder", workspace.folders[0].id);
  assert.deepEqual(result.folders.map((folder) => folder.id), ["retained"]);
  assert.deepEqual(result.files.map((file) => file.id), ["retained-file"]);
  assert.equal(result.activeFileId, "retained-file");
});

test("only a deliberate left swipe requests deletion", () => {
  assert.equal(core.isDeleteSwipe(160, 80, 100, 112), true);
  assert.equal(core.isDeleteSwipe(160, 120, 100, 102), false);
  assert.equal(core.isDeleteSwipe(160, 80, 100, 160), false);
  assert.equal(core.isDeleteSwipe(80, 160, 100, 100), false);
});

