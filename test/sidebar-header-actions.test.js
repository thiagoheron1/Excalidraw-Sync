"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const content = fs.readFileSync(path.join(__dirname, "..", "content.js"), "utf8");

test("the sidebar header contains branding and close only, without notification or sync actions", () => {
  const start = content.indexOf("function renderHeader");
  const end = content.indexOf("function render()", start);
  const header = content.slice(start, end);

  assert.match(header, /data-action="home"/);
  assert.match(header, /data-action="close"/);
  assert.doesNotMatch(header, /data-action="sync"/);
  assert.doesNotMatch(header, /data-action="notifications"/);
  assert.doesNotMatch(header, /header-sync|notification-button|notification-badge/);
});

test("sync and notification history remain accessible outside the sidebar header", () => {
  const filesStart = content.indexOf("function renderFilesView");
  const filesEnd = content.indexOf("function providerLink", filesStart);
  const filesView = content.slice(filesStart, filesEnd);
  const manageStart = content.indexOf("function renderManageView");
  const manageEnd = content.indexOf("function renderTrashView", manageStart);
  const manageView = content.slice(manageStart, manageEnd);

  assert.match(filesView, /data-action="sync"/);
  assert.match(manageView, /data-action="notifications"/);
});
