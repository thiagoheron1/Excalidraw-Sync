"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const content = fs.readFileSync(path.join(__dirname, "..", "content.js"), "utf8");

test("switching documents updates the scene in place and keeps the sidebar open", () => {
  const start = content.indexOf("async function switchFile");
  const end = content.indexOf("function closeDialog", start);
  const switchFile = content.slice(start, end);

  const saveCurrent = switchFile.indexOf("captureAndSaveActive");
  const selectNext = switchFile.indexOf("state.workspace.activeFileId = next.id");
  const inPlace = switchFile.indexOf("applySceneInPlace(next.scene)");

  assert.ok(saveCurrent >= 0);
  assert.ok(selectNext > saveCurrent);
  assert.ok(inPlace > selectNext);
  assert.doesNotMatch(switchFile, /location\.reload\(\)/);
  assert.match(switchFile, /setOpen\(true\)/);
});

test("an invalidated extension context recovers the requested document instead of swallowing the switch", () => {
  const recoveryStart = content.indexOf("async function recoverInvalidatedContext");
  const recoveryEnd = content.indexOf("function escapeHtml", recoveryStart);
  const recovery = content.slice(recoveryStart, recoveryEnd);
  const switchStart = content.indexOf("async function switchFile");
  const switchEnd = content.indexOf("function closeDialog", switchStart);
  const switchFile = content.slice(switchStart, switchEnd);

  assert.match(recovery, /switchToFileId/);
  assert.match(recovery, /currentFileId/);
  assert.match(recovery, /state\.workspace\.activeFileId = switchToFileId/);
  assert.match(recovery, /applyScene\(target\.scene\)/);
  assert.match(switchFile, /isExtensionContextInvalidated\(error\)/);
  assert.match(switchFile, /recoverInvalidatedContext\(error, \{ switchToFileId: fileId, currentFileId \}\)/);
});
