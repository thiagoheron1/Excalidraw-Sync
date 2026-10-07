"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { workspaceForRecovery } = require("../shared/ui-events.js");

const content = fs.readFileSync(path.join(__dirname, "..", "content.js"), "utf8");

test("a reinstall restores the durable site or native-disk workspace when extension storage is empty", () => {
  const durable = { id: "survived-uninstall", files: [{ id: "drawing-1" }] };
  assert.equal(workspaceForRecovery({ stored: null, durable }), durable);
  assert.equal(workspaceForRecovery({ stored: { id: "live" }, durable }).id, "live");
  assert.equal(workspaceForRecovery({ recovery: { workspace: { id: "pending" } }, stored: { id: "live" }, durable }).id, "pending");

  assert.match(content, /indexedDB\.open\(DURABLE_BACKUP_DB, 1\)/);
  assert.ok((content.match(/writeDurableWorkspaceBackup\(state\.workspace\)/g) || []).length >= 2);
  assert.match(content, /readDurableWorkspaceBackup\(\)\.catch\(\(\) => null\)/);
  assert.match(content, /durable: durableBackup \|\| nativeStatus\?\.workspace/);
  assert.match(content, /restoredFromDurable = !recovery && !stored && Boolean\(durableBackup \|\| nativeStatus\?\.workspace\)/);
  assert.match(content, /if \(restoredFromDurable\) \{[\s\S]*applyScene\(recoveredActive\.scene\)[\s\S]*location\.reload\(\)/);
  assert.match(content, /Recovered your ExcaliSync files from local recovery storage/);
});
