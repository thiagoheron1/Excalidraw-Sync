"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const content = fs.readFileSync(path.join(__dirname, "..", "content.js"), "utf8");

test("GitHub Connect recovers an invalidated extension context without losing the entered Client ID", () => {
  const connectStart = content.indexOf("async function connectGitHub");
  const connectEnd = content.indexOf("function startGitHubPolling", connectStart);
  const connectGitHub = content.slice(connectStart, connectEnd);
  const recoveryStart = content.indexOf("async function recoverInvalidatedContext");
  const recoveryEnd = content.indexOf("function escapeHtml", recoveryStart);
  const recovery = content.slice(recoveryStart, recoveryEnd);
  const initializeStart = content.indexOf("async function initialize");
  const initialize = content.slice(initializeStart);

  assert.match(connectGitHub, /const providerFormDraft = readProviderForm\(\)/);
  assert.match(connectGitHub, /isExtensionContextInvalidated\(error\)/);
  assert.match(connectGitHub, /recoverInvalidatedContext\(error, \{ providerFormDraft \}\)/);
  assert.match(recovery, /providerFormDraft/);
  assert.match(recovery, /state\.view = "manage"/);
  assert.match(recovery, /state\.open = true/);
  assert.match(initialize, /saveProviderForm\(recovery\.providerFormDraft\)/);
  assert.match(initialize, /GitHub settings restored\. Click Connect again to continue\./);
});
