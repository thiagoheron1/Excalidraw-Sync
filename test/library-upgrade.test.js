"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const core = require("../shared/core.js");

const content = fs.readFileSync(path.join(__dirname, "..", "content.js"), "utf8");
const background = fs.readFileSync(path.join(__dirname, "..", "background.js"), "utf8");
const manifest = require("../manifest.json");

test("deletion moves files to a recoverable 30-day trash record", () => {
  const workspace = core.createWorkspace();
  const file = workspace.files[0];
  const deletedAt = "2026-10-07T12:00:00.000Z";
  const result = core.trashEntry(workspace, "file", file.id, deletedAt);
  assert.equal(result.files.length, 0);
  assert.equal(result.trash.length, 1);
  assert.equal(result.trash[0].entry.id, file.id);
  assert.equal(result.trash[0].deletedAt, deletedAt);
  assert.equal(core.purgeExpiredTrash(result, new Date("2026-11-05T12:00:00.000Z")).trash.length, 1);
  assert.equal(core.purgeExpiredTrash(result, new Date("2026-11-07T12:00:01.000Z")).trash.length, 0);
});

test("notification history is persisted and opening it only marks items read", () => {
  assert.match(content, /NOTIFICATIONS_KEY/);
  assert.match(content, /persistNotifications/);
  assert.match(content, /markNotificationsRead/);
  assert.doesNotMatch(content, /notifications = state\.notifications\.filter\(\(item\) => item\.level !== "error"\)/);
});

test("library exposes native disk sync, link import, sharing, sorting, and drag/drop", () => {
  assert.ok(manifest.permissions.includes("nativeMessaging"));
  assert.match(background, /native:syncWorkspace/);
  assert.match(content, /data-action="import-link"/);
  assert.match(content, /data-action="copy-share-link"/);
  assert.match(content, /data-testid="main-menu-trigger"/);
  assert.match(content, /Export to Link/);
  assert.match(content, /data-action="sort-files"/);
  assert.match(content, /draggable="true"/);
  assert.match(content, /dragstart/);
  assert.match(content, /drop/);
});

test("OAuth setup instructions are available inside both provider settings", () => {
  assert.match(content, /Create a GitHub OAuth App/);
  assert.match(content, /Create a Google OAuth client/);
  assert.match(content, /Enable the Google Drive API/);
});

test("GitHub OAuth instructions explain every registration field and required toggle", () => {
  assert.match(content, /Application name:/);
  assert.match(content, /Homepage URL:/);
  assert.match(content, /Application description:/);
  assert.match(content, /Redirect URI:/);
  assert.match(content, /Allow wildcard matching/);
  assert.match(content, /Enable Device Flow/);
  assert.match(content, /Expire user access tokens/);
  assert.match(content, /https:\/\/excalidraw\.com\//);
  assert.match(content, /does not yet refresh an expired GitHub token/);
  assert.match(content, /Do not generate, paste, or share a client secret/);
});
