"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const core = require("../shared/core.js");
const { isExtensionContextInvalidated, requireActionResult } = require("../shared/ui-events.js");

const background = fs.readFileSync(path.join(__dirname, "..", "background.js"), "utf8");
const content = fs.readFileSync(path.join(__dirname, "..", "content.js"), "utf8");

test("GitHub safe push downloads and merges the remote workspace before uploading", () => {
  assert.match(background, /async function readGitHubWorkspace/);
  assert.match(background, /workspaceFromProviderIndex\(index, scenes\)/);
  assert.match(background, /reconcileWorkspaces\([\s\S]*force \? "force-push" : "merge"/);
  assert.match(background, /case "github:push"[\s\S]*force: Boolean\(message\.force\)/);
});

test("explicit GitHub pull warns before replacing local data and applies the remote workspace", () => {
  const pullStart = content.indexOf("async function pullFromGitHub");
  const pullEnd = content.indexOf("async function pushToGitHub", pullStart);
  const pull = content.slice(pullStart, pullEnd);

  assert.match(pull, /This replaces the local ExcaliSync folders and files/);
  assert.match(pull, /Local changes that were not pushed can be overwritten/);
  assert.match(pull, /danger: true/);
  assert.match(pull, /type: "github:pull"/);
  assert.match(content, /state\.workspace = ExcalidrawSyncCore\.reconcileWorkspaces\(/);
  assert.match(content, /await persistWorkspace\(\{ sync: false \}\)/);
  assert.match(content, /await applySceneInPlace\(active\.scene\)/);
});

test("force push requires typed confirmation and intentionally skips the remote merge", () => {
  assert.match(content, /label: 'Type "force push" to confirm'/);
  assert.match(content, /confirmed\.confirmation\.trim\(\)\.toLowerCase\(\) !== "force push"/);
  assert.match(content, /type: "github:push", workspace: state\.workspace, force/);
  assert.match(background, /force \? "force-push" : "merge"/);
});

test("manual GitHub push confirms before overwriting repository drawings", () => {
  const pushStart = content.indexOf("async function pushToGitHub");
  const pushEnd = content.indexOf("async function squashGitHubHistory", pushStart);
  const push = content.slice(pushStart, pushEnd);

  assert.match(push, /title: "Push to GitHub\?"/);
  assert.match(push, /can overwrite changed drawing files/);
  assert.match(push, /confirmLabel: "Push and overwrite"/);
  assert.ok(push.indexOf("showFormDialog") < push.indexOf('type: "github:push"'));
});

test("GitHub history squash requires typed confirmation and creates a root commit", () => {
  assert.match(content, /data-action="github-squash"/);
  assert.match(content, /label: 'Type "squash" to confirm'/);
  assert.match(content, /confirmation\.trim\(\)\.toLowerCase\(\) !== "squash"/);
  assert.match(content, /type: "github:squash"/);
  assert.match(background, /message: "ExcaliSync squashed workspace"[\s\S]*parents: \[\]/);
  assert.match(background, /updateGitHubReference\(owner, repo, branch, token, squashedCommit\.sha, reference\)/);
});

test("an empty squash response becomes an actionable recovery error instead of a null providers crash", () => {
  let error;
  try {
    requireActionResult(null, ["providers", "branch"], "Squash GitHub history");
  } catch (caught) {
    error = caught;
  }
  assert.ok(error);
  assert.match(error.message, /Reload the extension and refresh Excalidraw/);
  assert.equal(isExtensionContextInvalidated(error), true);
  assert.match(content, /requireActionResult\(response, \["providers", "branch"\], "Squash GitHub history"\)/);
});

test("read-only link creation activates Excalidraw export and falls back when Clipboard API rejects", () => {
  const manifest = fs.readFileSync(path.join(__dirname, "..", "manifest.json"), "utf8");
  assert.match(content, /readOnlyLinkAction/);
  assert.match(content, /await ExcalidrawSyncUIEvents\.copyTextToClipboard\(link/);
  assert.match(manifest, /clipboardWrite/);
});

test("GitHub home card opens and scrolls to expanded settings", () => {
  assert.match(content, /data-action="open-github-settings"/);
  assert.match(content, /data-provider-settings="github"/);
  assert.match(content, /githubSettings\.open = true/);
  assert.match(content, /githubSettings\.scrollIntoView\(\{ behavior: "smooth", block: "start" \}\)/);
});

test("two-machine reconciliation keeps the selected side authoritative", () => {
  const local = core.createWorkspace();
  const remote = core.createWorkspace();
  local.id = remote.id = "shared-workspace";
  local.files[0].id = "local-file";
  local.files[0].name = "Only on laptop A";
  remote.files[0].id = "remote-file";
  remote.files[0].name = "Only on laptop B";

  const merged = core.reconcileWorkspaces(local, remote, "merge");
  assert.deepEqual(new Set(merged.files.map((file) => file.id)), new Set(["local-file", "remote-file"]));

  const pulled = core.reconcileWorkspaces(local, remote, "pull");
  assert.deepEqual(pulled.files.map((file) => file.id), ["remote-file"]);

  const forcePushed = core.reconcileWorkspaces(local, remote, "force-push");
  assert.deepEqual(forcePushed.files.map((file) => file.id), ["local-file"]);
});

test("GitHub controls and setup guide support a second machine", () => {
  assert.match(content, /data-action="github-pull">Pull/);
  assert.match(content, /data-action="github-push">Push/);
  assert.match(content, /data-action="github-force-push">Force push/);
  assert.match(content, /same GitHub account, Client ID, repository name, and root folder/);
  assert.match(content, /first sync downloads and merges the existing library/);
});

test("GitHub pull and push arrows sit beside Auto on/off and disable when disconnected", () => {
  const cardStart = content.indexOf("function providerHomeCard");
  const cardEnd = content.indexOf("function providerHomeStatus", cardStart);
  const providerCard = content.slice(cardStart, cardEnd);
  const filesStart = content.indexOf("function renderFilesView");
  const filesEnd = content.indexOf("function providerLink", filesStart);
  const filesView = content.slice(filesStart, filesEnd);

  assert.match(providerCard, /class="auto-state/);
  assert.match(providerCard, /class="cloud-provider-actions"/);
  assert.match(providerCard, /data-action="github-pull"[\s\S]*icon\("pull", 16\)/);
  assert.match(providerCard, /data-action="github-push"[\s\S]*icon\("push", 16\)/);
  assert.match(providerCard, /connected \? "" : "disabled"/);
  assert.ok(providerCard.indexOf('class="auto-state') < providerCard.indexOf('class="cloud-provider-actions"'));
  assert.doesNotMatch(filesView, /folder-sync-actions/);
  assert.match(content, /pull: '<path/);
  assert.match(content, /push: '<path/);
});

test("Google Drive implementation, permissions, and settings are removed", () => {
  const manifest = fs.readFileSync(path.join(__dirname, "..", "manifest.json"), "utf8");
  for (const source of [background, content, manifest]) {
    assert.doesNotMatch(source, /googleDrive|Google Drive|googleapis\.com|accounts\.google\.com/);
  }
  assert.doesNotMatch(manifest, /"identity"/);
});
