"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { JSDOM } = require("jsdom");
const { protectEditableEvents } = require("../shared/ui-events.js");

test("typing and Backspace in a Shadow DOM file-name field do not reach Excalidraw shortcuts", () => {
  const dom = new JSDOM("<!doctype html><body><button id='canvas'>Canvas</button></body>", {
    pretendToBeVisual: true,
  });
  const { document, KeyboardEvent } = dom.window;
  const host = document.createElement("div");
  document.documentElement.append(host);
  const shadow = host.attachShadow({ mode: "open" });
  const input = document.createElement("input");
  input.value = "Deltais";
  shadow.append(input);

  let pageShortcutCount = 0;
  document.addEventListener("keydown", () => {
    pageShortcutCount += 1;
    document.querySelector("#canvas").focus();
  });
  protectEditableEvents(shadow);

  input.focus();
  input.dispatchEvent(new KeyboardEvent("keydown", { key: "A", bubbles: true, composed: true }));
  input.dispatchEvent(new KeyboardEvent("keydown", { key: "Backspace", bubbles: true, composed: true }));

  assert.equal(pageShortcutCount, 0);
  assert.equal(shadow.activeElement, input);
});
