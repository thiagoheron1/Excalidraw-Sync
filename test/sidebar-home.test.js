"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { excalidrawControlsOffset, sidebarViewForOpen } = require("../shared/ui-events.js");

const content = fs.readFileSync(path.join(__dirname, "..", "content.js"), "utf8");

test("reopening the sidebar from Manage or Notifications always returns to Files home", () => {
  assert.equal(sidebarViewForOpen("manage"), "files");
  assert.equal(sidebarViewForOpen("notifications"), "files");
  assert.match(content, /onActivate: \(\) => \{[\s\S]*setOpen\(opening, \{ home: opening, acknowledge: opening \}\)/);
  assert.match(content, /setOpen\(opening, \{ home: opening, acknowledge: opening \}\)/);
});

test("clicking the ExcaliSync icon or title in the header returns to Home", () => {
  assert.match(content, /class="brand-home"[^>]*data-action="home"/);
  assert.match(content, /aria-label="Go to ExcaliSync home"/);
  assert.match(content, /if \(action === "home"\) \{ state\.view = "files"; render\(\); \}/);
});

test("the sidebar starts as a collapsed left rail and has an expand-collapse control", () => {
  assert.match(content, /class="panel collapsed"/);
  assert.match(content, /data-action="toggle-sidebar"/);
  assert.match(content, /state\.open \? "Collapse sidebar" : "Expand sidebar"/);
  assert.match(content, /defaultLauncherPosition/);
  assert.match(content, /window\.innerWidth - size\.width - 12, y: 70/);
  assert.match(content, /\.panel\.collapsed \{[^}]*background: var\(--bg\);[^}]*color: var\(--text\);[^}]*border-right-color: var\(--border\)/);
  assert.match(content, /\.collapsed-brand \{[^}]*color: var\(--text\)/);
  assert.match(content, /\.panel\.collapsed \.sidebar-toggle \{[^}]*background: var\(--surface\);[^}]*border-color: var\(--border\);[^}]*color: var\(--text\)/);
  assert.match(content, /\.sidebar-toggle \{[^}]*left: 0;[^}]*right: 0;[^}]*bottom: 0;[^}]*width: 100%;/);
  assert.match(content, /class="sidebar-toggle-label">Collapse<\/span>/);
  assert.match(content, /\.panel\.collapsed \.sidebar-toggle-label \{ display: none; \}/);
  assert.match(content, /\.panel\.open \.sidebar-toggle \{[^}]*gap: 7px/);
  assert.match(content, /\.panel-footer \{[^}]*margin-bottom: 44px;/);
  assert.match(content, /class="collapsed-brand"[^>]*>[\s\S]*?ExcaliSync/);
  assert.match(content, /\.panel\.open \.collapsed-brand \{ display: none; \}/);
});

test("the collapsed rail is visible by default, can be hidden, and expands from any click", () => {
  assert.match(content, /sidebarRailHidden: false/);
  assert.match(content, /name="sidebarRailHidden"/);
  assert.match(content, /\.panel\.collapsed \{[^}]*cursor: pointer/);
  assert.match(content, /\.panel\.collapsed\.rail-hidden \{[^}]*translateX\(-102%\)/);
  assert.match(content, /storageGet\(SIDEBAR_RAIL_HIDDEN_KEY\)/);
  assert.match(content, /storageSet\(SIDEBAR_RAIL_HIDDEN_KEY, state\.sidebarRailHidden\)/);
  assert.match(content, /if \(!state\.open\) \{[\s\S]*?setOpen\(true, \{ home: true, acknowledge: true \}\);[\s\S]*?return;/);
});

test("Excalidraw canvas actions stay clear of the collapsed and expanded sidebar", () => {
  assert.equal(excalidrawControlsOffset({ open: false, railHidden: false }), "44px");
  assert.equal(excalidrawControlsOffset({ open: false, railHidden: true }), "0px");
  assert.equal(excalidrawControlsOffset({ open: true, railHidden: false }), "min(392px, 94vw)");
  assert.match(content, /\.excalidraw \.layer-ui__wrapper__footer-left/);
  assert.match(content, /\.excalidraw \.App-menu_top > \.App-menu_top__left/);
  assert.match(content, /\.App-menu_top > \.App-menu_top__left \{[\s\S]*?margin-left: var\(--excalidraw-sync-left-offset, 0px\) !important/);
  assert.match(content, /--excalidraw-sync-left-offset/);
  assert.match(content, /updateExcalidrawControlsOffset\(\)/);
});
