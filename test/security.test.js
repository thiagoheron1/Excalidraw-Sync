"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const security = require("../shared/security.js");
const background = fs.readFileSync(path.join(__dirname, "..", "background.js"), "utf8");

const providers = {
  github: {
    config: { clientId: "public-github-id", repoName: "drawings" },
    auth: { accessToken: "github-secret-token" },
    account: { login: "octocat" },
    pendingAuth: { deviceCode: "secret-device-code", userCode: "ABCD-1234" },
    lastSyncAt: "2026-10-07T12:00:00.000Z",
  },
};

test("persistent provider state contains public configuration but no OAuth credentials", () => {
  const persistent = security.providerPersistentState(providers);
  const serialized = JSON.stringify(persistent);

  assert.equal(persistent.github.config.clientId, "public-github-id");
  assert.equal(serialized.includes("github-secret-token"), false);
  assert.equal(serialized.includes("secret-device-code"), false);
  assert.equal("googleDrive" in persistent, false);
});

test("pending device codes are isolated to session state", () => {
  const session = security.providerSessionState(providers);

  assert.equal(session.github.pendingAuth.deviceCode, "secret-device-code");
  assert.equal(session.github.auth, undefined);
  assert.equal("googleDrive" in session, false);
  assert.equal(security.hasSensitiveProviderData(providers), true);
});

test("OAuth credentials can survive a worker or extension reload without entering public provider state", () => {
  const credentials = security.providerCredentialState(providers);
  const persistent = security.providerPersistentState(providers);
  const serializedPersistent = JSON.stringify(persistent);

  assert.equal(credentials.github.auth.accessToken, "github-secret-token");
  assert.equal(credentials.github.pendingAuth, undefined);
  assert.equal(serializedPersistent.includes("github-secret-token"), false);
  const restored = security.mergeProviderStorage({ github: {} }, persistent, {}, credentials);
  assert.equal(restored.github.auth.accessToken, "github-secret-token");
  assert.match(background, /PROVIDER_CREDENTIALS_KEY/);
  assert.match(background, /storageSet\(PROVIDER_CREDENTIALS_KEY, ExcalidrawSyncSecurity\.providerCredentialState\(providers\)\)/);
});

test("stale session state cannot disconnect durable GitHub credentials after a page reload", () => {
  const defaults = {
    syncAuthority: "local",
    github: { config: {}, auth: null, account: null, pendingAuth: null },
  };
  const persistent = security.providerPersistentState(providers);
  const credentials = security.providerCredentialState(providers);
  const staleSessionFromPreviousExtensionVersion = {
    github: { auth: null, account: null, pendingAuth: null },
  };

  const restored = security.mergeProviderStorage(
    defaults,
    persistent,
    staleSessionFromPreviousExtensionVersion,
    credentials,
  );

  assert.equal(restored.github.auth.accessToken, "github-secret-token");
  assert.equal(restored.github.account.login, "octocat");
  assert.equal("googleDrive" in restored, false);
});
