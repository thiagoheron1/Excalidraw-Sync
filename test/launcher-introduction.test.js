"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { shouldHighlightLauncher } = require("../shared/ui-events.js");

const content = fs.readFileSync(path.join(__dirname, "..", "content.js"), "utf8");
const background = fs.readFileSync(path.join(__dirname, "..", "background.js"), "utf8");

test("a newly installed extension highlights its visible launcher until the first open", () => {
  assert.equal(shouldHighlightLauncher({ introduced: false, visible: true }), true);
  assert.equal(shouldHighlightLauncher({ introduced: true, visible: true }), false);
  assert.equal(shouldHighlightLauncher({ introduced: false, visible: false }), false);

  assert.match(background, /details\.reason === "install"[\s\S]*storageSet\(LAUNCHER_INTRODUCED_KEY, false\)/);
  assert.match(background, /onClicked[\s\S]*storageSet\(LAUNCHER_INTRODUCED_KEY, true\)/);
  assert.match(content, /\.launcher\.needs-introduction[\s\S]*animation: launcher-introduction/);
  assert.match(content, /onActivate: \(\) => setOpen\(true, \{ home: true, acknowledge: true \}\)/);
  assert.match(content, /setOpen\(opening, \{ home: opening, acknowledge: opening \}\)/);
  assert.match(content, /storageSet\(LAUNCHER_INTRODUCED_KEY, true\)/);
});
