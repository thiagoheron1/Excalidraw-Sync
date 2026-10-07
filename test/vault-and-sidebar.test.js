"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const background = fs.readFileSync(path.join(root, "background.js"), "utf8");
const build = fs.readFileSync(path.join(root, "scripts", "build.js"), "utf8");
const vaultHtml = fs.readFileSync(path.join(root, "vault.html"), "utf8");
const vaultScript = fs.readFileSync(path.join(root, "vault.js"), "utf8");

test("browser toolbar recovers an invalidated content script and reopens the sidebar", () => {
  const clickHandler = background.slice(background.indexOf("extensionApi.action.onClicked"));
  assert.match(clickHandler, /sendMessage/);
  assert.match(clickHandler, /SIDEBAR_OPEN_REQUEST_KEY/);
  assert.match(clickHandler, /extensionApi\.tabs, "reload"/);
});

test("local vault opens as an extension page and lists downloadable drawings", () => {
  assert.match(background, /case "vault:open"/);
  assert.match(background, /runtime\.getURL\("vault\.html"\)/);
  assert.match(build, /"vault\.html", "vault\.js"/);
  assert.match(vaultHtml, /ExcaliSync local vault/);
  assert.match(vaultScript, /excalidrawSync\.localVault/);
  assert.match(vaultScript, /downloadFile/);
});
