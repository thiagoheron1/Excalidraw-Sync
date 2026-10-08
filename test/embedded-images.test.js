"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {
  liveImageFileIds,
  waitForEmbeddedFiles,
  waitForImportedScene,
} = require("../shared/ui-events.js");

const content = fs.readFileSync(path.join(__dirname, "..", "content.js"), "utf8");
const pngFile = {
  id: "screenshot-file",
  mimeType: "image/png",
  dataURL: "data:image/png;base64,iVBORw0KGgo=",
  created: 1,
};

test("capture waits for a newly pasted screenshot payload instead of saving an incomplete scene", async () => {
  const elements = [
    { id: "live-image", type: "image", fileId: "screenshot-file", isDeleted: false },
    { id: "deleted-image", type: "image", fileId: "old-file", isDeleted: true },
  ];
  const fileIds = liveImageFileIds(elements);
  let reads = 0;
  const files = await waitForEmbeddedFiles(
    fileIds,
    async () => (++reads === 1 ? {} : { "screenshot-file": pngFile }),
    { attempts: 2, delayMs: 0, wait: async () => {} },
  );

  assert.deepEqual(fileIds, ["screenshot-file"]);
  assert.equal(reads, 2);
  assert.equal(files["screenshot-file"].dataURL, pngFile.dataURL);
});

test("capture rejects a scene when a live image payload never reaches IndexedDB", async () => {
  await assert.rejects(
    waitForEmbeddedFiles(["missing-image"], async () => ({}), {
      attempts: 2,
      delayMs: 0,
      wait: async () => {},
    }),
    /still saving 1 embedded image/,
  );
});

test("receiving machine keeps the scene blob alive until Excalidraw imports its image elements", async () => {
  const target = [
    { id: "shape", type: "rectangle", isDeleted: false },
    { id: "image", type: "image", fileId: "screenshot-file", isDeleted: false },
  ];
  const snapshots = [
    JSON.stringify([{ id: "old-shape", type: "ellipse", isDeleted: false }]),
    JSON.stringify(target),
  ];
  let reads = 0;

  const imported = await waitForImportedScene(
    target,
    async () => snapshots[Math.min(reads++, snapshots.length - 1)],
    { attempts: 2, delayMs: 0, wait: async () => {} },
  );

  assert.equal(reads, 2);
  assert.equal(imported[1].fileId, "screenshot-file");
});

test("scene capture and in-place loading use complete image storage boundaries", () => {
  const captureStart = content.indexOf("async function captureScene");
  const captureEnd = content.indexOf("async function applyScene", captureStart);
  const storageApplyStart = content.indexOf("async function applyScene(");
  const storageApplyEnd = content.indexOf("async function applySceneInPlace", storageApplyStart);
  const applyStart = content.indexOf("async function applySceneInPlace");
  const applyEnd = content.indexOf("async function persistLocalVault", applyStart);
  const captureScene = content.slice(captureStart, captureEnd);
  const storageApplyScene = content.slice(storageApplyStart, storageApplyEnd);
  const applyScene = content.slice(applyStart, applyEnd);

  assert.match(captureScene, /liveImageFileIds\(elementsValue\)/);
  assert.match(captureScene, /waitForEmbeddedFiles\(fileIds, readSceneFiles\)/);
  assert.match(applyScene, /await writeSceneFiles\(scene\.files\)/);
  assert.match(applyScene, /waitForImportedScene/);
  assert.ok(applyScene.indexOf("waitForImportedScene") < applyScene.indexOf("URL.revokeObjectURL"));
  assert.ok(storageApplyScene.indexOf("await writeSceneFiles") < storageApplyScene.indexOf('window.dispatchEvent(new Event("focus"))'));
});
