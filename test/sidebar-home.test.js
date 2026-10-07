"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { sidebarViewForOpen } = require("../shared/ui-events.js");

const content = fs.readFileSync(path.join(__dirname, "..", "content.js"), "utf8");

test("reopening the sidebar from Manage or Notifications always returns to Files home", () => {
  assert.equal(sidebarViewForOpen("manage"), "files");
  assert.equal(sidebarViewForOpen("notifications"), "files");
  assert.match(content, /onActivate: \(\) => setOpen\(true, \{ home: true, acknowledge: true \}\)/);
  assert.match(content, /setOpen\(opening, \{ home: opening, acknowledge: opening \}\)/);
});
