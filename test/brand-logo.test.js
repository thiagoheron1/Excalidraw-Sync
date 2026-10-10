"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const content = fs.readFileSync(path.join(root, "content.js"), "utf8");
const readme = fs.readFileSync(path.join(root, "README.md"), "utf8");
const manifest = JSON.parse(fs.readFileSync(path.join(root, "manifest.json"), "utf8"));
const build = fs.readFileSync(path.join(root, "scripts", "build.js"), "utf8");

test("the in-canvas launcher uses the exact README ExcaliSync logo", () => {
  assert.match(readme, /assets\/excalisync-logo\.png/);
  assert.match(content, /function brandLogo/);
  assert.match(content, /runtime\.getURL\("assets\/excalisync-logo\.png"\)/);
  assert.match(content, /class="launcher"[\s\S]*?\$\{brandLogo\(32\)\}/);
  assert.doesNotMatch(content, /class="launcher"[\s\S]*?\$\{icon\("logo"/);
});

test("the README logo is packaged and exposed only to Excalidraw", () => {
  assert.match(build, /"assets"/);
  assert.deepEqual(manifest.web_accessible_resources, [{
    resources: ["assets/excalisync-logo.png"],
    matches: ["https://excalidraw.com/*"],
  }]);
});
