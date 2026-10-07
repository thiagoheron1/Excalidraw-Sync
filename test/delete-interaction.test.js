"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const content = fs.readFileSync(path.join(__dirname, "..", "content.js"), "utf8");

test("file and folder rows expose keyboard-accessible delete controls", () => {
  assert.match(content, /data-action=\"delete\" data-kind=\"file\"/);
  assert.match(content, /data-action=\"delete\" data-kind=\"folder\"/);
  assert.match(content, /aria-label=\"Delete/);
});

test("swipe and delete button both route through confirmation", () => {
  assert.match(content, /isDeleteSwipe/);
  assert.match(content, /confirmDelete\(row\.dataset\.kind, row\.dataset\.id\)/);
  assert.match(content, /if \(!result\) \{\s+return;\s+\}/);
  assert.match(content, /showFormDialog\(\{[\s\S]*confirmLabel: \"Delete\"[\s\S]*danger: true/);
});

test("a file swipe cannot bubble into its parent folder deletion gesture", () => {
  const ownershipGuard = /event\.target\.closest\(\"\[data-deletable\]\"\) !== row/g;
  assert.equal(content.match(ownershipGuard)?.length, 2);
});
