"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { JSDOM } = require("jsdom");
const {
  attachDraggableLauncher,
  clampLauncherPosition,
  launcherPositionBesideSidebar,
  positionLauncherElement,
  rightAnchoredLauncherPosition,
} = require("../shared/ui-events.js");
const fs = require("node:fs");
const path = require("node:path");

const content = fs.readFileSync(path.join(__dirname, "..", "content.js"), "utf8");

function pointerEvent(window, type, properties) {
  const event = new window.Event(type, { bubbles: true, cancelable: true });
  for (const [name, value] of Object.entries(properties)) {
    Object.defineProperty(event, name, { value });
  }
  return event;
}

test("launcher position is constrained to the visible viewport", () => {
  assert.deepEqual(
    clampLauncherPosition({ x: -40, y: 900 }, { width: 320, height: 480 }, { width: 46, height: 46 }),
    { x: 8, y: 426 },
  );
});

test("the default top-right launcher sits below Excalidraw controls", () => {
  assert.match(content, /\.launcher \{\s*position: fixed; right: 12px; top: 70px;/);
  assert.match(content, /\{ x: window\.innerWidth - size\.width - 12, y: 70 \}/);
});

test("opening the sidebar does not hide the ExcaliSync launcher", () => {
  const setOpenSource = content.slice(
    content.indexOf("function setOpen("),
    content.indexOf("function applyTheme("),
  );

  assert.doesNotMatch(setOpenSource, /launcher\.classList\.toggle\("is-hidden", open\)/);
});

test("opening the sidebar moves a covered launcher to the safe top-right area", () => {
  assert.deepEqual(
    launcherPositionBesideSidebar(
      { x: 223, y: 13 },
      {
        open: true,
        sidebarWidth: 392,
        viewport: { width: 1040, height: 912 },
        launcherSize: { width: 64, height: 62 },
      },
    ),
    { position: { x: 964, y: 70 }, moved: true },
  );
});

test("a right-anchored launcher follows the viewport edge after resize", () => {
  assert.deepEqual(
    rightAnchoredLauncherPosition({ y: 70 }, { width: 1440, height: 900 }, { width: 64, height: 62 }),
    { x: 1364, y: 70 },
  );
  assert.match(content, /savedPosition\.anchor === "right"/);
  assert.match(content, /state\.launcherAnchoredRight \? anchoredLauncherPosition\(\) : launcherDrag\.constrain/);
});

test("positioning the launcher cannot stretch it between left and right offsets", () => {
  const dom = new JSDOM("<!doctype html><button style='right:112px;width:64px;height:62px'>Launcher</button>");
  const button = dom.window.document.querySelector("button");

  positionLauncherElement(button, { x: 620, y: 12 });

  assert.equal(button.style.left, "620px");
  assert.equal(button.style.right, "auto");
  assert.equal(button.style.width, "64px");
  assert.equal(button.style.height, "62px");
});

test("dragging moves and saves the launcher without opening the sidebar", () => {
  const dom = new JSDOM("<!doctype html><button>Launcher</button>", { pretendToBeVisual: true });
  const button = dom.window.document.querySelector("button");
  let position = { x: 12, y: 76 };
  let saved = null;
  let activationCount = 0;

  attachDraggableLauncher(button, {
    getPosition: () => position,
    getViewport: () => ({ width: 800, height: 600 }),
    getSize: () => ({ width: 46, height: 46 }),
    onMove: (next) => (position = next),
    onCommit: (next) => { saved = next; },
    onActivate: () => { activationCount += 1; },
  });

  button.dispatchEvent(pointerEvent(dom.window, "pointerdown", { pointerId: 1, button: 0, clientX: 20, clientY: 84 }));
  button.dispatchEvent(pointerEvent(dom.window, "pointermove", { pointerId: 1, clientX: 188, clientY: 210 }));
  button.dispatchEvent(pointerEvent(dom.window, "pointerup", { pointerId: 1, clientX: 188, clientY: 210 }));
  button.click();

  assert.deepEqual(position, { x: 180, y: 202 });
  assert.deepEqual(saved, position);
  assert.equal(activationCount, 0);
});

test("a normal launcher click still opens the sidebar", () => {
  const dom = new JSDOM("<!doctype html><button>Launcher</button>", { pretendToBeVisual: true });
  const button = dom.window.document.querySelector("button");
  let activationCount = 0;

  attachDraggableLauncher(button, {
    getPosition: () => ({ x: 12, y: 76 }),
    getViewport: () => ({ width: 800, height: 600 }),
    getSize: () => ({ width: 46, height: 46 }),
    onMove: (next) => next,
    onCommit: () => {},
    onActivate: () => { activationCount += 1; },
  });

  button.click();
  assert.equal(activationCount, 1);
});

test("clicking the launcher again closes an already open sidebar", () => {
  assert.match(
    content,
    /onActivate: \(\) => \{[\s\S]*const opening = !state\.open;[\s\S]*setOpen\(opening, \{ home: opening, acknowledge: opening \}\);[\s\S]*\}/,
  );
});

test("Alt+Arrow moves the launcher for keyboard users", () => {
  const dom = new JSDOM("<!doctype html><button>Launcher</button>", { pretendToBeVisual: true });
  const button = dom.window.document.querySelector("button");
  let position = { x: 12, y: 76 };
  let saved = null;

  attachDraggableLauncher(button, {
    getPosition: () => position,
    getViewport: () => ({ width: 800, height: 600 }),
    getSize: () => ({ width: 46, height: 46 }),
    onMove: (next) => (position = next),
    onCommit: (next) => { saved = next; },
    onActivate: () => {},
  });

  button.dispatchEvent(new dom.window.KeyboardEvent("keydown", {
    key: "ArrowRight",
    altKey: true,
    bubbles: true,
    cancelable: true,
  }));

  assert.deepEqual(position, { x: 24, y: 76 });
  assert.deepEqual(saved, position);
});
