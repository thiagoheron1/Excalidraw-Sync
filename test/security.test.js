"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const security = require("../shared/security.js");

const providers = {
  github: {
    config: { clientId: "public-github-id", repoName: "drawings" },
    auth: { accessToken: "github-secret-token" },
    account: { login: "octocat" },
    pendingAuth: { deviceCode: "secret-device-code", userCode: "ABCD-1234" },
    lastSyncAt: "2026-10-07T12:00:00.000Z",
  },
  googleDrive: {
    config: { clientId: "public-google-id", folderName: "Excalidraw" },
    auth: { accessToken: "google-secret-token", refreshToken: "google-refresh-token" },
    account: { email: "user@example.com" },
    folderId: "folder-id",
  },
};

test("persistent provider state contains public configuration but no OAuth credentials", () => {
  const persistent = security.providerPersistentState(providers);
  const serialized = JSON.stringify(persistent);

  assert.equal(persistent.github.config.clientId, "public-github-id");
  assert.equal(persistent.googleDrive.config.clientId, "public-google-id");
  assert.equal(serialized.includes("github-secret-token"), false);
  assert.equal(serialized.includes("secret-device-code"), false);
  assert.equal(serialized.includes("google-refresh-token"), false);
});

test("OAuth credentials and pending device codes are isolated to session state", () => {
  const session = security.providerSessionState(providers);

  assert.equal(session.github.auth.accessToken, "github-secret-token");
  assert.equal(session.github.pendingAuth.deviceCode, "secret-device-code");
  assert.equal(session.googleDrive.auth.refreshToken, "google-refresh-token");
  assert.equal(security.hasSensitiveProviderData(providers), true);
});
