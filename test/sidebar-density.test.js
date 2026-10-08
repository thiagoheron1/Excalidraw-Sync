"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const content = fs.readFileSync(path.join(__dirname, "..", "content.js"), "utf8");

test("the launcher label and sidebar use compact readable typography", () => {
  assert.match(content, /\.launcher-label \{[\s\S]*font-family: ui-rounded,[\s\S]*font-size: 9px/);
  assert.match(content, /\.panel \{[\s\S]*font-family: Inter,[\s\S]*font-size: 13px/);
  assert.match(content, /\.quick-action \{[\s\S]*min-height: 40px[\s\S]*font-size: 12px/);
  assert.match(content, /\.file-row \{[\s\S]*min-height: 40px/);
  assert.match(content, /\.settings-heading strong \{[\s\S]*font-size: 12px/);
  assert.match(content, /\.compact-field input, \.compact-field select \{[\s\S]*height: 33px[\s\S]*font-size: 11px/);
  assert.match(content, /\.provider-summary-copy small \{[\s\S]*font-size: 9\.5px/);
});
