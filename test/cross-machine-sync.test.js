"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const background = fs.readFileSync(path.join(__dirname, "..", "background.js"), "utf8");
const content = fs.readFileSync(path.join(__dirname, "..", "content.js"), "utf8");

test("GitHub and Google Drive download and merge a remote workspace before uploading", () => {
  assert.match(background, /async function readGitHubWorkspace/);
  assert.match(background, /workspaceFromProviderIndex\(index, scenes\)/);
  assert.match(background, /readGitHubWorkspace\([\s\S]*mergeWorkspaces\(workspaceInput, remoteWorkspace\)/);
  assert.match(background, /async function listDriveWorkspaceRoots/);
  assert.match(background, /async function readDriveWorkspace/);
  assert.match(background, /readDriveWorkspace\(root, items, token\)/);
  assert.match(background, /googleDriveSync\(workspaceInput, providers\)[\s\S]*mergeWorkspaces\(workspaceInput, remoteWorkspace\)/);
});

test("a pulled cross-machine workspace is persisted and applied to the open Excalidraw canvas", () => {
  const syncStart = content.indexOf("async function syncNow");
  const syncEnd = content.indexOf("function startGitHubPolling", syncStart);
  const syncNow = content.slice(syncStart, syncEnd);

  assert.match(syncNow, /state\.workspace = ExcalidrawSyncCore\.normalizeWorkspace\(result\.workspace\)/);
  assert.match(syncNow, /await persistWorkspace\(\{ sync: false \}\)/);
  assert.match(syncNow, /await applySceneInPlace\(mergedActive\.scene\)/);
});

test("provider setup guides explain how to connect a second machine", () => {
  assert.match(content, /same GitHub account, Client ID, repository name, and root folder/);
  assert.match(content, /same Google account, OAuth Client ID, and Drive folder name/);
  assert.match(content, /first sync downloads and merges the existing library/);
});
