"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const content = fs.readFileSync(path.join(__dirname, "..", "content.js"), "utf8");

test("timer autosave safely recovers an invalidated extension context", () => {
  const start = content.indexOf("async function checkForDrawingChanges");
  const end = content.indexOf("async function initialize", start);
  const autosave = content.slice(start, end);

  assert.match(autosave, /runWithInvalidationRecovery/);
  assert.match(autosave, /recoverInvalidatedContext/);
  assert.doesNotMatch(autosave, /Autosave needs attention[\s\S]*Extension context invalidated/);
});

test("manual and scheduled cloud sync recover invalidated contexts before reporting an error", () => {
  const start = content.indexOf("async function syncNow");
  const end = content.indexOf("function ensureWorkspaceHasFile", start);
  const sync = content.slice(start, end);

  assert.match(sync, /isExtensionContextInvalidated\(error\)/);
  assert.match(sync, /await recoverInvalidatedContext\(error\)/);
});

test("startup removes obsolete invalidated-context alerts created by older versions", () => {
  assert.match(content, /notificationHistory\.filter\(/);
  assert.match(content, /isExtensionContextInvalidated\(item\?\.message\)/);
  assert.match(content, /state\.notifications\.length !== notificationHistory\.length/);
});
