"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { JSDOM } = require("jsdom");
const {
  copyTextToClipboard,
  focusAndSelectFormField,
} = require("../shared/ui-events.js");

test("rename focus selects the entire filename even when folder is the first field", () => {
  const dom = new JSDOM('<form><select name="folderId"><option>Folder</option></select><input name="name" value="Diagram.excalidraw"></form>', { pretendToBeVisual: true });
  const form = dom.window.document.querySelector("form");
  const input = form.elements.namedItem("name");

  focusAndSelectFormField(form, "name");

  assert.equal(dom.window.document.activeElement, input);
  assert.equal(input.selectionStart, 0);
  assert.equal(input.selectionEnd, input.value.length);
  dom.window.close();
});

test("copying a read-only link falls back to the legacy copy command when Clipboard API rejects", async () => {
  const dom = new JSDOM("<!doctype html><body></body>");
  let copiedValue = "";
  dom.window.document.execCommand = (command) => {
    assert.equal(command, "copy");
    copiedValue = dom.window.document.activeElement.value;
    return true;
  };

  await copyTextToClipboard("https://excalidraw.com/#json=example", {
    navigatorRef: { clipboard: { writeText: async () => { throw new Error("NotAllowedError"); } } },
    documentRef: dom.window.document,
  });

  assert.equal(copiedValue, "https://excalidraw.com/#json=example");
  assert.equal(dom.window.document.querySelector("textarea"), null);
  dom.window.close();
});
