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
  const untouched = {
    ...selected,
    id: "file-untouched",
    name: "Untouched",
    scene: { ...core.emptyScene(), elements: [{ id: "keep", type: "rectangle" }] },
  };
  untouched.hash = core.hashScene(untouched.scene);
  workspace.files.push(untouched);
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
  assert.deepEqual(restored.files.find((file) => file.id === untouched.id).scene, untouched.scene);
  assert.equal(restored.activeFileId, selected.id);
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
