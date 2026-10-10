"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const core = require("../shared/core.js");

const background = fs.readFileSync(path.join(__dirname, "..", "background.js"), "utf8");
const content = fs.readFileSync(path.join(__dirname, "..", "content.js"), "utf8");

test("GitHub direction distinguishes remote, local, both, and synchronized states", () => {
  const common = "1111111111111111111111111111111111111111";
  const remote = "2222222222222222222222222222222222222222";

  assert.equal(core.githubSyncDirection({ localCommitSha: common, remoteCommitSha: common }), "synced");
  assert.equal(core.githubSyncDirection({ localCommitSha: common, remoteCommitSha: remote }), "remote");
  assert.equal(core.githubSyncDirection({ localCommitSha: common, remoteCommitSha: common, hasLocalChanges: true }), "local");
  assert.equal(core.githubSyncDirection({ localCommitSha: common, remoteCommitSha: remote, hasLocalChanges: true }), "both");
  assert.equal(core.githubSyncDirection({ localCommitSha: null, remoteCommitSha: remote }), "unknown");
});

test("the GitHub card shows commit IDs with red remote and purple local states", () => {
  assert.match(content, /githubSyncDirection\(/);
  assert.match(content, /\? "remote-ahead"/);
  assert.match(content, /\? "local-ahead"/);
  assert.match(content, /This machine .* GitHub .*/);
  assert.match(content, /GitHub has newer commits/);
  assert.match(content, /Local changes ready to push/);
  assert.match(content, /\.cloud-provider\.remote-ahead/);
  assert.match(content, /\.cloud-provider\.local-ahead/);
});

test("commit status refresh compares the remembered machine commit with GitHub HEAD", () => {
  assert.match(background, /async function githubCommitStatus/);
  assert.match(background, /localCommitSha: providers\.github\.lastKnownCommitSha/);
  assert.match(background, /remoteCommitSha: reference\?\.object\?\.sha/);
  assert.match(background, /case "github:commitStatus"/);
  assert.match(content, /type: "github:commitStatus"/);
  assert.match(content, /setInterval\(\(\) => \{ void refreshGitHubCommitStatus/);
});

test("successful sync and pull remember the resulting GitHub HEAD on this machine", () => {
  assert.match(background, /providers\.github\.lastKnownCommitSha = reference\?\.object\?\.sha/);
  assert.match(background, /await rememberGitHubHead\(providers, repository, token\)/);
  assert.match(background, /lastKnownCommitSha: providers\.github\.lastKnownCommitSha/);
});
