"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { getFileSyncHealth, getSaveHealth, normalizeSaveSettings } = require("../shared/ui-events.js");

test("save settings support edit, interval, and manual modes", () => {
  assert.deepEqual(normalizeSaveSettings({ mode: "interval", intervalSeconds: "15", staleMinutes: "10" }), {
    mode: "interval",
    intervalSeconds: 15,
    staleMinutes: 10,
    notificationsEnabled: true,
  });
  assert.equal(normalizeSaveSettings({ mode: "invalid", intervalSeconds: 7 }).mode, "edit");
  assert.equal(normalizeSaveSettings({ notificationsEnabled: false }).notificationsEnabled, false);
});

test("save health changes from yellow pending to red stale after the configured threshold", () => {
  const now = Date.parse("2026-10-07T12:10:00.000Z");
  assert.deepEqual(getSaveHealth({ staleMinutes: 5, now }), { level: "ok", kind: null, ageMs: 0 });
  assert.equal(getSaveHealth({ dirtySince: "2026-10-07T12:08:00.000Z", staleMinutes: 5, now }).level, "pending");
  assert.equal(getSaveHealth({ unsyncedSince: "2026-10-07T12:04:00.000Z", staleMinutes: 5, now }).level, "stale");
});

test("only the document awaiting sync receives yellow or red sync health", () => {
  const now = Date.parse("2026-10-07T12:10:00.000Z");
  assert.equal(getFileSyncHealth({
    connected: true,
    updatedAt: "2026-10-07T12:09:00.000Z",
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
