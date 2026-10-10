"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const core = require("../shared/core.js");

const background = fs.readFileSync(path.join(__dirname, "..", "background.js"), "utf8");
const content = fs.readFileSync(path.join(__dirname, "..", "content.js"), "utf8");

function sharedWorkspace() {
  const workspace = core.createWorkspace();
  workspace.id = "shared-workspace";
  workspace.folders[0].id = "shared-folder";
  workspace.files[0].id = "shared-file";
  workspace.files[0].folderId = "shared-folder";
  workspace.files[0].name = "Architecture";
  workspace.files[0].hash = core.hashScene(workspace.files[0].scene);
  return workspace;
}

test("automatic sync pulls a file created on another laptop before planning an upload", () => {
  const base = sharedWorkspace();
  const local = structuredClone(base);
  const remote = structuredClone(base);
  remote.files.push({
    ...structuredClone(remote.files[0]),
    id: "remote-only-file",
    name: "Added on laptop A",
    createdAt: "2026-10-09T12:00:00.000Z",
    updatedAt: "2026-10-09T12:00:00.000Z",
  });

  const baseline = core.workspaceSyncBaseline(base);
  assert.deepEqual(core.workspaceConflicts(local, remote, baseline), []);
  const reconciled = core.resolveWorkspaceSync(local, remote, baseline);

  assert.deepEqual(
    new Set(reconciled.files.map((file) => file.id)),
    new Set(["shared-file", "remote-only-file"]),
  );
  assert.match(background, /const remoteSnapshot = await readGitHubWorkspaceSnapshot[\s\S]*workspaceConflicts\(/);
});

test("same-file edits on two laptops pause automatic upload until the user chooses a side", () => {
  const base = sharedWorkspace();
  const local = structuredClone(base);
  const remote = structuredClone(base);
  local.files[0].name = "Local architecture";
  local.files[0].updatedAt = "2026-10-09T12:01:00.000Z";
  remote.files[0].name = "Remote architecture";
  remote.files[0].updatedAt = "2026-10-09T12:02:00.000Z";

  const baseline = core.workspaceSyncBaseline(base);
  const conflicts = core.workspaceConflicts(local, remote, baseline);

  assert.equal(conflicts.length, 1);
  assert.equal(conflicts[0].kind, "file");
  assert.equal(conflicts[0].id, "shared-file");
  assert.equal(conflicts[0].local.updatedAt, "2026-10-09T12:01:00.000Z");
  assert.equal(conflicts[0].remote.updatedAt, "2026-10-09T12:02:00.000Z");
  assert.equal(conflicts[0].local.entry.name, "Local architecture");
  assert.equal(conflicts[0].remote.entry.name, "Remote architecture");
  assert.equal(core.resolveWorkspaceSync(local, remote, baseline, "local").files[0].name, "Local architecture");
  assert.equal(core.resolveWorkspaceSync(local, remote, baseline, "remote").files[0].name, "Remote architecture");
  assert.match(background, /if \(conflicts\.length && !conflictResolution\)[\s\S]*return \{[\s\S]*conflicts/);
  assert.match(background, /conflicts: conflicts\.map[\s\S]*localCommitSha,[\s\S]*remoteCommitSha,[\s\S]*remoteCommitAt,/);
  assert.match(content, /Resolve GitHub sync conflict/);
  assert.match(content, /Keep this device's conflicting versions/);
  assert.match(content, /Use GitHub's conflicting versions/);
  assert.match(content, /class="conflict-comparison"/);
  assert.match(content, /conflictScenePreview/);
  assert.match(content, /Known commit/);
  assert.match(content, /GitHub HEAD/);
});

test("a safe retry keeps the user's conflict choice instead of reopening the same dialog", () => {
  const base = sharedWorkspace();
  const local = structuredClone(base);
  const remote = structuredClone(base);
  local.files[0].name = "AWS local";
  remote.files[0].name = "AWS remote";
  const baseline = core.workspaceSyncBaseline(base);

  assert.equal(core.workspaceConflicts(local, remote, baseline).length, 1);
  assert.equal(core.resolveWorkspaceSync(local, remote, baseline, "local").files[0].name, "AWS local");
  assert.match(content, /scheduleCloudSync\(5000, conflictResolution\)/);
  assert.match(content, /setTimeout\(\(\) => syncNow\(\{ quiet: true, conflictResolution \}\), delayMs\)/);
  assert.match(content, /state\.pendingConflictResolution = choice\.resolution/);
  assert.match(content, /conflictResolution \|\| state\.pendingConflictResolution/);
  assert.match(content, /pendingConflictResolution: state\.pendingConflictResolution/);
  assert.match(content, /state\.pendingConflictResolution = null/);
});

test("a GitHub 409 aborts the stale write plan and re-pulls instead of retrying old content", () => {
  const putStart = background.indexOf("async function putGitHubContent");
  const putEnd = background.indexOf("async function deleteGitHubContent", putStart);
  const putImplementation = background.slice(putStart, putEnd);
  const deleteStart = putEnd;
  const deleteEnd = background.indexOf("async function ensureGitHubRepository", deleteStart);
  const deleteImplementation = background.slice(deleteStart, deleteEnd);

  assert.doesNotMatch(putImplementation, /retryConflict/);
  assert.doesNotMatch(deleteImplementation, /retryConflict/);
  assert.match(content, /GitHub changed while syncing · pulling the latest version before retrying/);
  assert.match(content, /scheduleCloudSync\(5000, conflictResolution\)/);
});

test("successful sync persists a new three-way baseline for the next automatic preflight", () => {
  assert.match(content, /syncBaseline: state\.syncBaseline/);
  assert.match(content, /state\.syncBaseline = ExcalidrawSyncCore\.workspaceSyncBaseline\(state\.workspace\)/);
  assert.match(content, /syncBaseline: state\.syncBaseline/);
  assert.match(content, /savedState\?\.syncBaseline/);
  assert.match(content, /pendingSyncConflicts: state\.pendingSyncConflicts/);
  assert.match(content, /savedState\?\.pendingSyncConflicts/);
});
