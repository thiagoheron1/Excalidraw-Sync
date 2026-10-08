"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { getFileSyncHealth, getSaveHealth, normalizeSaveSettings } = require("../shared/ui-events.js");

const content = fs.readFileSync(path.join(__dirname, "..", "content.js"), "utf8");

test("save settings support edit, interval, manual modes, and a debounced cloud sync", () => {
  assert.deepEqual(normalizeSaveSettings({ mode: "interval", intervalSeconds: "15", syncDelaySeconds: "60", staleMinutes: "10" }), {
    mode: "interval",
    intervalSeconds: 15,
    syncDelaySeconds: 60,
    staleMinutes: 10,
    notificationsEnabled: true,
  });
  assert.equal(normalizeSaveSettings({ mode: "invalid", intervalSeconds: 7 }).mode, "edit");
  assert.equal(normalizeSaveSettings({ syncDelaySeconds: 7 }).syncDelaySeconds, 30);
  assert.equal(normalizeSaveSettings({ notificationsEnabled: false }).notificationsEnabled, false);
});

test("after-edit health stays neutral for 30 seconds, then becomes yellow and later red", () => {
  const now = Date.parse("2026-10-07T12:10:00.000Z");
  assert.deepEqual(getSaveHealth({ staleMinutes: 5, now }), { level: "ok", kind: null, ageMs: 0 });
  assert.equal(getSaveHealth({ dirtySince: "2026-10-07T12:09:30.000Z", mode: "edit", staleMinutes: 5, now }).level, "ok");
  assert.equal(getSaveHealth({ dirtySince: "2026-10-07T12:09:29.000Z", mode: "edit", staleMinutes: 5, now }).level, "pending");
  assert.equal(getSaveHealth({ unsyncedSince: "2026-10-07T12:04:29.000Z", mode: "edit", staleMinutes: 5, now }).level, "stale");
});

test("interval autosave adds its interval before the 30-second warning grace", () => {
  const now = Date.parse("2026-10-07T12:10:00.000Z");
  assert.equal(getSaveHealth({
    dirtySince: "2026-10-07T12:08:30.000Z",
    mode: "interval",
    intervalSeconds: 60,
    staleMinutes: 5,
    now,
  }).level, "ok");
  assert.equal(getSaveHealth({
    dirtySince: "2026-10-07T12:08:29.000Z",
    mode: "interval",
    intervalSeconds: 60,
    staleMinutes: 5,
    now,
  }).level, "pending");
});

test("only the document awaiting sync receives yellow or red sync health", () => {
  const now = Date.parse("2026-10-07T12:10:00.000Z");
  assert.equal(getFileSyncHealth({
    connected: true,
    updatedAt: "2026-10-07T12:09:30.000Z",
    syncedAt: "2026-10-07T12:08:00.000Z",
    staleMinutes: 5,
    now,
  }).level, "ok");
  assert.equal(getFileSyncHealth({
    connected: true,
    updatedAt: "2026-10-07T12:09:29.000Z",
    syncedAt: "2026-10-07T12:08:00.000Z",
    staleMinutes: 5,
    now,
  }).level, "pending");
  assert.equal(getFileSyncHealth({
    connected: true,
    updatedAt: "2026-10-07T12:02:00.000Z",
    syncedAt: "2026-10-07T12:01:00.000Z",
    staleMinutes: 5,
    now,
  }).level, "stale");
  assert.equal(getFileSyncHealth({
    connected: true,
    updatedAt: "2026-10-07T12:02:00.000Z",
    syncedAt: "2026-10-07T12:03:00.000Z",
    staleMinutes: 5,
    now,
  }).level, "ok");
  assert.equal(getFileSyncHealth({
    connected: false,
    updatedAt: "2026-10-07T12:09:00.000Z",
    syncedAt: null,
    staleMinutes: 5,
    now,
  }).level, "ok");
});

test("an active interval-saved document does not turn yellow before interval plus grace", () => {
  const now = Date.parse("2026-10-07T12:10:00.000Z");
  const base = {
    connected: true,
    active: true,
    updatedAt: "2026-10-07T12:00:00.000Z",
    syncedAt: "2026-10-07T12:00:00.000Z",
    mode: "interval",
    intervalSeconds: 300,
    staleMinutes: 5,
    now,
  };
  assert.equal(getFileSyncHealth({ ...base, dirtySince: "2026-10-07T12:04:30.000Z" }).level, "ok");
  assert.equal(getFileSyncHealth({ ...base, dirtySince: "2026-10-07T12:04:29.000Z" }).level, "pending");
});

test("the sidebar passes the selected autosave policy into global and document health", () => {
  const saveHealthStart = content.indexOf("function saveHealth");
  const saveHealthEnd = content.indexOf("function healthMessage", saveHealthStart);
  const fileHealthStart = content.indexOf("function fileSyncDetails");
  const fileHealthEnd = content.indexOf("function updateFileSyncIndicators", fileHealthStart);
  for (const source of [
    content.slice(saveHealthStart, saveHealthEnd),
    content.slice(fileHealthStart, fileHealthEnd),
  ]) {
    assert.match(source, /mode: state\.saveSettings\.mode/);
    assert.match(source, /intervalSeconds: state\.saveSettings\.intervalSeconds/);
  }
});
