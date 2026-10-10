"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const core = require("../shared/core.js");

const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "manifest.json"), "utf8"));
const background = fs.readFileSync(path.join(__dirname, "..", "background.js"), "utf8");
const content = fs.readFileSync(path.join(__dirname, "..", "content.js"), "utf8");

test("automatic squash defaults to enabled every 30 days and validates custom frequency", () => {
  assert.deepEqual(core.normalizeAutoSquashSettings(), { enabled: true, intervalDays: 30 });
  assert.deepEqual(
    core.normalizeAutoSquashSettings({ enabled: false, intervalDays: 7 }),
    { enabled: false, intervalDays: 7 },
  );
  assert.deepEqual(
    core.normalizeAutoSquashSettings({ enabled: true, intervalDays: 0 }),
    { enabled: true, intervalDays: 30 },
  );
});

test("GitHub settings explain and persist the automatic squash schedule", () => {
  assert.ok(manifest.permissions.includes("alarms"));
  assert.match(content, /name="githubAutoSquashEnabled"/);
  assert.match(content, /name="githubAutoSquashDays"/);
  assert.match(content, /permanently replaces older commits with one baseline commit/i);
  assert.match(background, /GITHUB_AUTO_SQUASH_ALARM/);
  assert.match(background, /extensionApi\.alarms\.onAlarm\.addListener/);
  assert.match(background, /configureAutoSquashAlarm/);
});
