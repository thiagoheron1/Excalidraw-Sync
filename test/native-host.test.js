"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

test("native host is pinned to the user home vault and retention folders", () => {
  const host = fs.readFileSync(path.join(__dirname, "..", "native-host", "host.js"), "utf8");
  assert.match(host, /os\.homedir\(\)/);
  assert.match(host, /\.excalidraw-sync/);
  assert.match(host, /\.trash/);
  assert.match(host, /30 \* DAY_MS/);
  assert.match(host, /\.logs/);
  assert.match(host, /7 \* DAY_MS/);
  assert.doesNotMatch(host, /accessToken|refreshToken|clientSecret/);
});

test("native host purges expired trash and logs", () => {
  const { purgeExpiredEntries } = require("../native-host/host.js");
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "excalisync-retention-"));
  const oldFile = path.join(root, "old.json");
  const freshFile = path.join(root, "fresh.json");
  fs.writeFileSync(oldFile, "old");
  fs.writeFileSync(freshFile, "fresh");
  const now = Date.now();
  fs.utimesSync(oldFile, new Date(now - 31 * 86400000), new Date(now - 31 * 86400000));
  purgeExpiredEntries(root, 30 * 86400000, now);
  assert.equal(fs.existsSync(oldFile), false);
  assert.equal(fs.existsSync(freshFile), true);
  fs.rmSync(root, { recursive: true });
});
