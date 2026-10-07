"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  isExtensionContextInvalidated,
  runWithInvalidationRecovery,
} = require("../shared/ui-events.js");

test("an invalidated extension context invokes recovery instead of losing a new-folder action", async () => {
  const workspace = { folders: [{ id: "folder_new", name: "Recovered folder" }] };
  let recoveredWorkspace = null;

  const result = await runWithInvalidationRecovery(
    async () => {
      throw new Error("Extension context invalidated.");
    },
    async () => {
      recoveredWorkspace = structuredClone(workspace);
    },
  );

  assert.equal(result, undefined);
  assert.deepEqual(recoveredWorkspace, workspace);
  assert.equal(isExtensionContextInvalidated(new Error("Extension context invalidated.")), true);
});

test("unrelated failures are not mistaken for an invalidated extension context", async () => {
  const failure = new Error("Storage quota exceeded");
  await assert.rejects(
    runWithInvalidationRecovery(async () => { throw failure; }, async () => {}),
    failure,
  );
});
