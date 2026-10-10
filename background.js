/* global ExcalidrawSyncCore, ExcalidrawSyncSecurity */
"use strict";

importScripts("shared/core.js", "shared/security.js");

const extensionApi = globalThis.browser || globalThis.chrome;
const usesPromiseApi = typeof globalThis.browser !== "undefined";
const PROVIDERS_KEY = "excalidrawSync.providers";
const PROVIDER_SESSION_KEY = "excalidrawSync.providerSession";
const PROVIDER_CREDENTIALS_KEY = "excalidrawSync.providerCredentials";
const SIDEBAR_OPEN_REQUEST_KEY = "excalidrawSync.sidebarOpenRequested";
const LAUNCHER_INTRODUCED_KEY = "excalidrawSync.launcherIntroduced";
const NATIVE_HOST_NAME = "com.thiagoheron.excalidraw_sync";
const GITHUB_AUTO_SQUASH_ALARM = "excalidrawSync.githubAutoSquash";
const DAY_MS = 24 * 60 * 60 * 1000;
let volatileProviderSession = null;
let syncInFlight = Promise.resolve();

function apiCall(target, method, ...args) {
  if (usesPromiseApi) {
    return target[method](...args);
  }
  return new Promise((resolve, reject) => {
    target[method](...args, (result) => {
      const error = extensionApi.runtime.lastError;
      if (error) {
        reject(new Error(error.message));
      } else {
        resolve(result);
      }
    });
  });
}

async function storageGet(key) {
  const result = await apiCall(extensionApi.storage.local, "get", key);
  return result?.[key];
}

async function storageSet(key, value) {
  await apiCall(extensionApi.storage.local, "set", { [key]: value });
}

async function sessionGet(key) {
  if (!extensionApi.storage.session) {
    return key === PROVIDER_SESSION_KEY ? volatileProviderSession : null;
  }
  const result = await apiCall(extensionApi.storage.session, "get", key);
  return result?.[key];
}

async function sessionSet(key, value) {
  if (!extensionApi.storage.session) {
    if (key === PROVIDER_SESSION_KEY) volatileProviderSession = value;
    return;
  }
  await apiCall(extensionApi.storage.session, "set", { [key]: value });
}

async function nativeMessage(message) {
  return apiCall(extensionApi.runtime, "sendNativeMessage", NATIVE_HOST_NAME, message);
}

function defaultProviderState() {
  return {
    syncAuthority: "local",
    github: {
      config: {
        clientId: "",
        repoName: "excalidraw-diagrams",
        visibility: "private",
        rootDirectory: "Excalidraw",
      },
      auth: null,
      account: null,
      pendingAuth: null,
      lastSyncAt: null,
      lastError: null,
      lastErrorAt: null,
      repositoryUrl: null,
      lastKnownCommitSha: null,
      lastKnownCommitAt: null,
      autoSquash: {
        ...ExcalidrawSyncCore.normalizeAutoSquashSettings(),
        lastRunAt: null,
        nextRunAt: null,
        lastError: null,
      },
    },
  };
}

async function readProviders() {
  const [stored, sessionStored, credentials] = await Promise.all([
    storageGet(PROVIDERS_KEY),
    sessionGet(PROVIDER_SESSION_KEY),
    storageGet(PROVIDER_CREDENTIALS_KEY),
  ]);
  const defaults = defaultProviderState();
  if (!stored) {
    const providers = ExcalidrawSyncSecurity.mergeProviderStorage(defaults, {}, sessionStored || {}, credentials || {});
    providers.github.autoSquash = {
      ...ExcalidrawSyncCore.normalizeAutoSquashSettings(providers.github.autoSquash),
      lastRunAt: null,
      nextRunAt: null,
      lastError: null,
    };
    return providers;
  }
  const hasLegacyCredentials = ExcalidrawSyncSecurity.hasSensitiveProviderData(stored);
  const hasLegacySessionCredentials = Boolean(sessionStored?.github?.auth);
  const legacySession = hasLegacyCredentials
    ? ExcalidrawSyncSecurity.providerSessionState(stored)
    : {};
  const legacyCredentials = hasLegacyCredentials
    ? ExcalidrawSyncSecurity.providerCredentialState(stored)
    : {};
  const legacySessionCredentials = hasLegacySessionCredentials
    ? ExcalidrawSyncSecurity.providerCredentialState(sessionStored)
    : null;
  const providers = ExcalidrawSyncSecurity.mergeProviderStorage(
    defaults,
    stored,
    sessionStored || legacySession,
    credentials || legacySessionCredentials || legacyCredentials,
  );
  providers.github.autoSquash = {
    ...ExcalidrawSyncCore.normalizeAutoSquashSettings(providers.github.autoSquash),
    lastRunAt: providers.github.autoSquash?.lastRunAt || null,
    nextRunAt: providers.github.autoSquash?.nextRunAt || null,
    lastError: providers.github.autoSquash?.lastError || null,
  };
  if (hasLegacyCredentials || (!credentials && hasLegacySessionCredentials)) {
    await writeProviders(providers);
  }
  return providers;
}

async function writeProviders(providers) {
  await Promise.all([
    storageSet(PROVIDERS_KEY, ExcalidrawSyncSecurity.providerPersistentState(providers)),
    storageSet(PROVIDER_CREDENTIALS_KEY, ExcalidrawSyncSecurity.providerCredentialState(providers)),
    sessionSet(PROVIDER_SESSION_KEY, ExcalidrawSyncSecurity.providerSessionState(providers)),
  ]);
}

function publicProviderState(providers) {
  return {
    syncAuthority: providers.syncAuthority || "local",
    github: {
      config: providers.github.config,
      connected: Boolean(providers.github.auth?.accessToken),
      account: providers.github.account,
      pendingAuth: providers.github.pendingAuth
        ? {
            userCode: providers.github.pendingAuth.userCode,
            verificationUri: providers.github.pendingAuth.verificationUri,
            expiresAt: providers.github.pendingAuth.expiresAt,
            interval: providers.github.pendingAuth.interval,
          }
        : null,
      lastSyncAt: providers.github.lastSyncAt,
      lastError: providers.github.lastError,
      lastErrorAt: providers.github.lastErrorAt,
      repositoryUrl: providers.github.repositoryUrl,
      lastKnownCommitSha: providers.github.lastKnownCommitSha || null,
      lastKnownCommitAt: providers.github.lastKnownCommitAt || null,
      autoSquash: providers.github.autoSquash,
    },
  };
}

function cleanMessage(error) {
  const message = error instanceof Error ? error.message : String(error);
  return message
    .replace(/(Bearer|token|access_token|refresh_token)\s*[:=]?\s*[^\s,}]+/gi, "$1 [hidden]")
    .slice(0, 500);
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, options);
  const text = await response.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch (_error) {
    body = text;
  }
  if (!response.ok) {
    const detail = body?.message || body?.error_description || body?.error || response.statusText;
    const error = new Error(`${detail} (${response.status})`);
    error.status = response.status;
    error.body = body;
    throw error;
  }
  return body;
}

function utf8ToBase64(value) {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

function base64ToUtf8(value) {
  const binary = atob(value.replace(/\n/g, ""));
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

function base64Url(bytes) {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

async function githubRequest(path, token, options = {}) {
  return fetchJson(`https://api.github.com${path}`, {
    ...options,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": "2022-11-28",
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...options.headers,
    },
  });
}

async function githubRawRequest(path, token) {
  const response = await fetch(`https://api.github.com${path}`, {
    cache: "no-store",
    headers: {
      Accept: "application/vnd.github.raw+json",
      Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": "2022-11-28",
      "Cache-Control": "no-cache",
    },
  });
  const text = await response.text();
  if (!response.ok) {
    let detail = response.statusText;
    try {
      const body = JSON.parse(text);
      detail = body?.message || detail;
    } catch (_error) {
      // GitHub may return plain text for raw-content failures.
    }
    const error = new Error(`${detail} (${response.status})`);
    error.status = response.status;
    throw error;
  }
  return text;
}

async function githubToken(providers) {
  const auth = providers.github.auth;
  if (!auth?.accessToken) throw new Error("Connect GitHub first.");
  if (!auth.expiresAt || auth.expiresAt > Date.now() + 60_000) return auth.accessToken;
  if (!auth.refreshToken) throw new Error("GitHub access expired. Connect again.");
  const body = await fetchJson("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: providers.github.config.clientId,
      grant_type: "refresh_token",
      refresh_token: auth.refreshToken,
    }),
  });
  if (body?.error || !body?.access_token) {
    throw new Error(body?.error_description || body?.error || "GitHub could not refresh the connection.");
  }
  providers.github.auth = {
    accessToken: body.access_token,
    refreshToken: body.refresh_token || auth.refreshToken,
    expiresAt: body.expires_in ? Date.now() + body.expires_in * 1000 : null,
    refreshTokenExpiresAt: body.refresh_token_expires_in
      ? Date.now() + body.refresh_token_expires_in * 1000
      : auth.refreshTokenExpiresAt || null,
  };
  await writeProviders(providers);
  return providers.github.auth.accessToken;
}

async function githubStartAuth() {
  const providers = await readProviders();
  const clientId = providers.github.config.clientId.trim();
  if (!clientId) {
    throw new Error("Add a GitHub OAuth App client ID first.");
  }
  const body = await fetchJson("https://github.com/login/device/code", {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({ client_id: clientId, scope: "repo" }),
  });
  providers.github.pendingAuth = {
    deviceCode: body.device_code,
    userCode: body.user_code,
    verificationUri: body.verification_uri,
    expiresAt: Date.now() + body.expires_in * 1000,
    interval: Math.max(5, body.interval || 5),
  };
  providers.github.lastError = null;
  providers.github.lastErrorAt = null;
  await writeProviders(providers);
  return publicProviderState(providers).github;
}

async function githubPollAuth() {
  const providers = await readProviders();
  const pending = providers.github.pendingAuth;
  if (!pending || pending.expiresAt <= Date.now()) {
    providers.github.pendingAuth = null;
    await writeProviders(providers);
    throw new Error("The GitHub sign-in code expired. Start again.");
  }
  const response = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      client_id: providers.github.config.clientId,
      device_code: pending.deviceCode,
      grant_type: "urn:ietf:params:oauth:grant-type:device_code",
    }),
  });
  const body = await response.json();
  if (body.error === "authorization_pending" || body.error === "slow_down") {
    if (body.error === "slow_down") {
      providers.github.pendingAuth.interval += 5;
      await writeProviders(providers);
    }
    return { pending: true, interval: providers.github.pendingAuth.interval };
  }
  if (!response.ok || body.error || !body.access_token) {
    throw new Error(body.error_description || body.error || "GitHub sign-in failed.");
  }
  const account = await githubRequest("/user", body.access_token);
  providers.github.auth = {
    accessToken: body.access_token,
    refreshToken: body.refresh_token || null,
    expiresAt: body.expires_in ? Date.now() + body.expires_in * 1000 : null,
    refreshTokenExpiresAt: body.refresh_token_expires_in
      ? Date.now() + body.refresh_token_expires_in * 1000
      : null,
  };
  providers.github.account = { login: account.login, avatarUrl: account.avatar_url };
  providers.github.pendingAuth = null;
  providers.github.lastError = null;
  providers.github.lastErrorAt = null;
  providers.syncAuthority = "github";
  await writeProviders(providers);
  return { pending: false, provider: publicProviderState(providers).github };
}

function encodeGitHubPath(path) {
  return path.split("/").map(encodeURIComponent).join("/");
}

async function getGitHubContent(owner, repo, path, token, branch, { fresh = false } = {}) {
  const freshness = fresh
    ? `&excalidraw_sync_fresh=${Date.now()}-${Math.random().toString(36).slice(2)}`
    : "";
  try {
    return await githubRequest(
      `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/${encodeGitHubPath(path)}?ref=${encodeURIComponent(branch)}${freshness}`,
      token,
      fresh
        ? { cache: "no-store", headers: { "Cache-Control": "no-cache" } }
        : {},
    );
  } catch (error) {
    if (error.status === 404) {
      return null;
    }
    throw error;
  }
}

async function putGitHubContent(owner, repo, branch, token, file, message, expectedSha = null) {
  const desiredSha = await ExcalidrawSyncCore.gitBlobSha(file.content);
  if (expectedSha === desiredSha) return { unchanged: true };
  return githubRequest(
    `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/${encodeGitHubPath(file.path)}`,
    token,
    {
      method: "PUT",
      body: JSON.stringify({
        message,
        content: utf8ToBase64(file.content),
        branch,
        ...(expectedSha ? { sha: expectedSha } : {}),
      }),
    },
  );
}

async function deleteGitHubContent(owner, repo, branch, token, path, expectedSha = null) {
  if (!expectedSha) return { unchanged: true };
  return githubRequest(
    `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/${encodeGitHubPath(path)}`,
    token,
    { method: "DELETE", body: JSON.stringify({ message: `Remove ${path}`, sha: expectedSha, branch }) },
  );
}

async function ensureGitHubRepository(providers) {
  const accessToken = await githubToken(providers);
  const account = providers.github.account || (await githubRequest("/user", accessToken));
  const owner = account.login;
  const name = providers.github.config.repoName.trim();
  if (!/^[A-Za-z0-9._-]+$/.test(name)) {
    throw new Error("Use a valid GitHub repository name.");
  }
  let repository;
  try {
    repository = await githubRequest(
      `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}`,
      accessToken,
    );
  } catch (error) {
    if (error.status !== 404) {
      throw error;
    }
    repository = await githubRequest("/user/repos", accessToken, {
      method: "POST",
      body: JSON.stringify({
        name,
        description: "Excalidraw diagrams synchronized by Excalidraw Sync",
        private: providers.github.config.visibility !== "public",
        auto_init: true,
      }),
    });
  }
  const shouldBePrivate = providers.github.config.visibility !== "public";
  if (repository.private !== shouldBePrivate) {
    repository = await githubRequest(
      `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}`,
      accessToken,
      {
        method: "PATCH",
        body: JSON.stringify({ private: shouldBePrivate }),
      },
    );
  }
  return repository;
}

async function githubTree(owner, repo, branch, token) {
  try {
    const result = await githubRequest(
      `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/git/trees/${encodeURIComponent(branch)}?recursive=1`,
      token,
      { cache: "no-store", headers: { "Cache-Control": "no-cache" } },
    );
    return new Map((result.tree || []).filter((item) => item.type === "blob").map((item) => [item.path, item.sha]));
  } catch (error) {
    if (error.status === 404 || error.status === 409) {
      return new Map();
    }
    throw error;
  }
}

async function getGitHubReference(owner, repo, branch, token) {
  try {
    return await githubRequest(
      `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/git/ref/heads/${encodeGitHubPath(branch)}`,
      token,
      { cache: "no-store", headers: { "Cache-Control": "no-cache" } },
    );
  } catch (error) {
    if (error.status === 404) return null;
    throw error;
  }
}

async function getGitHubCommitDate(owner, repo, sha, token) {
  if (!sha) return null;
  try {
    const commit = await githubRequest(
      `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/commits/${encodeURIComponent(sha)}`,
      token,
      { cache: "no-store", headers: { "Cache-Control": "no-cache" } },
    );
    return commit.commit?.committer?.date || commit.commit?.author?.date || null;
  } catch (_error) {
    return null;
  }
}

async function rememberGitHubHead(providers, repository, token) {
  const branch = repository.default_branch || "main";
  const reference = await getGitHubReference(repository.owner.login, repository.name, branch, token);
  providers.github.lastKnownCommitSha = reference?.object?.sha || null;
  providers.github.lastKnownCommitAt = new Date().toISOString();
  return reference;
}

async function githubCommitStatus(providers) {
  if (!providers.github.auth?.accessToken) throw new Error("Connect GitHub first.");
  const token = await githubToken(providers);
  const repository = await ensureGitHubRepository(providers);
  const branch = repository.default_branch || "main";
  const reference = await getGitHubReference(repository.owner.login, repository.name, branch, token);
  return {
    localCommitSha: providers.github.lastKnownCommitSha || null,
    remoteCommitSha: reference?.object?.sha || null,
    checkedAt: new Date().toISOString(),
    branch,
    url: repository.html_url,
  };
}

async function updateGitHubReference(owner, repo, branch, token, sha, existingReference) {
  if (existingReference) {
    return githubRequest(
      `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/git/refs/heads/${encodeGitHubPath(branch)}`,
      token,
      { method: "PATCH", body: JSON.stringify({ sha, force: true }) },
    );
  }
  return githubRequest(
    `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/git/refs`,
    token,
    { method: "POST", body: JSON.stringify({ ref: `refs/heads/${branch}`, sha }) },
  );
}

async function githubSquash(providers) {
  if (!providers.github.auth?.accessToken) throw new Error("Connect GitHub first.");
  const token = await githubToken(providers);
  const repository = await ensureGitHubRepository(providers);
  const owner = repository.owner.login;
  const repo = repository.name;
  const branch = repository.default_branch || "main";
  const reference = await getGitHubReference(owner, repo, branch, token);
  if (!reference?.object?.sha) throw new Error("GitHub default branch is not ready yet.");
  const currentCommit = await githubRequest(
    `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/git/commits/${reference.object.sha}`,
    token,
  );
  const squashedCommit = await githubRequest(
    `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/git/commits`,
    token,
    {
      method: "POST",
      body: JSON.stringify({
        message: "ExcaliSync squashed workspace",
        tree: currentCommit.tree.sha,
        parents: [],
      }),
    },
  );
  await updateGitHubReference(owner, repo, branch, token, squashedCommit.sha, reference);
  providers.github.lastKnownCommitSha = squashedCommit.sha;
  providers.github.lastKnownCommitAt = new Date().toISOString();
  providers.github.lastSyncAt = new Date().toISOString();
  providers.github.lastError = null;
  providers.github.lastErrorAt = null;
  return { branch, commitSha: squashedCommit.sha, url: repository.html_url };
}

function nextAutoSquashTime(autoSquash, now = Date.now()) {
  return new Date(now + autoSquash.intervalDays * DAY_MS).toISOString();
}

async function configureAutoSquashAlarm(providersInput = null, { reset = false } = {}) {
  const providers = providersInput || await readProviders();
  const current = providers.github.autoSquash || {};
  const settings = ExcalidrawSyncCore.normalizeAutoSquashSettings(current);
  await apiCall(extensionApi.alarms, "clear", GITHUB_AUTO_SQUASH_ALARM).catch(() => false);
  if (!settings.enabled) {
    providers.github.autoSquash = { ...current, ...settings, nextRunAt: null };
    await writeProviders(providers);
    return providers.github.autoSquash;
  }
  const savedNext = new Date(current.nextRunAt || 0).getTime();
  const when = !reset && Number.isFinite(savedNext) && savedNext > Date.now()
    ? savedNext
    : Date.now() + settings.intervalDays * DAY_MS;
  providers.github.autoSquash = {
    ...current,
    ...settings,
    nextRunAt: new Date(when).toISOString(),
  };
  await writeProviders(providers);
  extensionApi.alarms.create(GITHUB_AUTO_SQUASH_ALARM, {
    when,
    periodInMinutes: settings.intervalDays * 24 * 60,
  });
  return providers.github.autoSquash;
}

async function runAutomaticGitHubSquash() {
  const providers = await readProviders();
  const autoSquash = {
    ...providers.github.autoSquash,
    ...ExcalidrawSyncCore.normalizeAutoSquashSettings(providers.github.autoSquash),
  };
  if (!autoSquash.enabled) return;
  if (!providers.github.auth?.accessToken) {
    providers.github.autoSquash = {
      ...autoSquash,
      nextRunAt: nextAutoSquashTime(autoSquash),
    };
    await configureAutoSquashAlarm(providers, { reset: true });
    return;
  }
  try {
    await githubSquash(providers);
    providers.github.autoSquash = {
      ...autoSquash,
      lastRunAt: new Date().toISOString(),
      nextRunAt: nextAutoSquashTime(autoSquash),
      lastError: null,
    };
  } catch (error) {
    providers.github.autoSquash = {
      ...autoSquash,
      nextRunAt: nextAutoSquashTime(autoSquash),
      lastError: cleanMessage(error),
    };
  }
  await configureAutoSquashAlarm(providers, { reset: true });
}

async function readGitHubWorkspaceSnapshot(repository, rootDirectory, token) {
  const owner = repository.owner.login;
  const repo = repository.name;
  const branch = repository.default_branch || "main";
  const placeholder = ExcalidrawSyncCore.createWorkspace();
  const indexPath = ExcalidrawSyncCore.buildProviderFiles(placeholder, rootDirectory)
    .find((file) => file.id === "workspace-index").path;
  const tree = await githubTree(owner, repo, branch, token);
  const rootPrefix = indexPath.split("/").slice(0, -1).join("/");
  const repositoryDrawingPaths = [...tree.keys()].filter((path) =>
    path.startsWith(`${rootPrefix}/`) && path.endsWith(".excalidraw"),
  );
  const response = await getGitHubContent(owner, repo, indexPath, token, branch, { fresh: true });
  if (!response?.content && !repositoryDrawingPaths.length) {
    return { workspace: null, indexPath, shas: new Map(), tree };
  }
  const index = response?.content
    ? JSON.parse(base64ToUtf8(response.content))
    : {
        formatVersion: 2,
        workspaceId: `recovered-workspace-${ExcalidrawSyncCore.hashString(`${owner}/${repo}/${rootPrefix}`)}`,
        workspaceName: repository.name || "Recovered GitHub drawings",
        generatedAt: new Date().toISOString(),
        folders: [],
        files: [],
        tombstones: [],
      };
  const scenes = {};
  const shas = new Map(response?.sha ? [[indexPath, response.sha]] : []);
  const indexedPaths = (index.files || []).map((file) => file.path).filter(Boolean);
  const drawingPaths = new Set([...indexedPaths, ...repositoryDrawingPaths]);
  await Promise.all([...drawingPaths].map(async (path) => {
    const remote = await getGitHubContent(owner, repo, path, token, branch, { fresh: true });
    if (remote?.content) {
      scenes[path] = JSON.parse(base64ToUtf8(remote.content));
      shas.set(path, remote.sha);
    }
  }));
  return {
    workspace: ExcalidrawSyncCore.workspaceFromProviderIndex(index, scenes),
    indexPath,
    shas,
    tree,
  };
}

async function readGitHubWorkspace(repository, rootDirectory, token) {
  return (await readGitHubWorkspaceSnapshot(repository, rootDirectory, token)).workspace;
}

async function githubSync(
  workspaceInput,
  providers,
  { force = false, syncBaseline = null, conflictResolution = null } = {},
) {
  if (!providers.github.auth?.accessToken) {
    return { skipped: true };
  }
  const token = await githubToken(providers);
  const repository = await ensureGitHubRepository(providers);
  const owner = repository.owner.login;
  const repo = repository.name;
  const branch = repository.default_branch || "main";
  const remoteSnapshot = await readGitHubWorkspaceSnapshot(
    repository,
    providers.github.config.rootDirectory,
    token,
  );
  const remoteWorkspace = remoteSnapshot.workspace;
  const reference = force ? null : await getGitHubReference(owner, repo, branch, token);
  const localCommitSha = providers.github.lastKnownCommitSha || null;
  const remoteCommitSha = reference?.object?.sha || null;
  const effectiveConflictResolution = ExcalidrawSyncCore.githubConflictResolution({
    requestedResolution: conflictResolution,
    localCommitSha,
    remoteCommitSha,
  });
  const conflicts = force
    ? []
    : ExcalidrawSyncCore.workspaceConflicts(workspaceInput, remoteWorkspace, syncBaseline);
  if (conflicts.length && !effectiveConflictResolution) {
    const [localCommitAt, remoteCommitAt] = await Promise.all([
      getGitHubCommitDate(owner, repo, localCommitSha, token),
      getGitHubCommitDate(owner, repo, remoteCommitSha, token),
    ]);
    return {
      skipped: true,
      conflicts: conflicts.map((conflict) => ({
        ...conflict,
        localCommitSha,
        localCommitAt,
        remoteCommitSha,
        remoteCommitAt,
      })),
      url: repository.html_url,
    };
  }
  const workspace = force
    ? ExcalidrawSyncCore.reconcileWorkspaces(workspaceInput, remoteWorkspace, "force-push")
    : ExcalidrawSyncCore.resolveWorkspaceSync(
        workspaceInput,
        remoteWorkspace,
        syncBaseline,
        effectiveConflictResolution,
      );
  const desiredFiles = ExcalidrawSyncCore.buildProviderFiles(
    workspace,
    providers.github.config.rootDirectory,
    { includeFolderPlaceholders: true },
  );
  const indexFile = desiredFiles.find((file) => file.id === "workspace-index");
  const previousIndexResponse = await getGitHubContent(owner, repo, indexFile.path, token, branch, { fresh: true });
  let previousPaths = [];
  if (previousIndexResponse?.content) {
    try {
      const previousIndex = JSON.parse(base64ToUtf8(previousIndexResponse.content));
      previousPaths = [
        ...(previousIndex.files || []).map((file) => file.path),
        ...(previousIndex.folderPlaceholders || []).map((folder) => folder.path),
      ];
    } catch (_error) {
      previousPaths = [];
    }
  }
  const tree = remoteSnapshot.tree || await githubTree(owner, repo, branch, token);
  for (const [path, expectedSha] of remoteSnapshot.shas) {
    if (tree.get(path) !== expectedSha) {
      const error = new Error("GitHub changed while ExcaliSync was preparing this sync.");
      error.status = 409;
      throw error;
    }
  }
  if (!remoteSnapshot.shas.has(remoteSnapshot.indexPath) && tree.has(remoteSnapshot.indexPath)) {
    const error = new Error("GitHub was initialized by another device during this sync.");
    error.status = 409;
    throw error;
  }
  const { changedFiles, removedPaths } = await ExcalidrawSyncCore.providerChangePlan(
    desiredFiles,
    tree,
    previousPaths,
  );
  const changed = [];
  if (!changedFiles.length && !removedPaths.length) {
    await rememberGitHubHead(providers, repository, token);
    providers.github.repositoryUrl = repository.html_url;
    providers.github.lastSyncAt = new Date().toISOString();
    providers.github.lastError = null;
    providers.github.lastErrorAt = null;
    return { skipped: false, changed, url: repository.html_url, workspace };
  }
  for (const file of changedFiles.filter((item) => item.id !== "workspace-index")) {
    await putGitHubContent(owner, repo, branch, token, file, `Sync ${file.name}`, tree.get(file.path));
    changed.push(file.path);
  }
  for (const path of removedPaths) {
    await deleteGitHubContent(owner, repo, branch, token, path, tree.get(path));
    changed.push(path);
  }
  if (changedFiles.some((file) => file.id === "workspace-index")) {
    await putGitHubContent(
      owner,
      repo,
      branch,
      token,
      indexFile,
      "Update Excalidraw Sync index",
      tree.get(indexFile.path),
    );
    changed.push(indexFile.path);
  }
  providers.github.repositoryUrl = repository.html_url;
  await rememberGitHubHead(providers, repository, token);
  providers.github.lastSyncAt = new Date().toISOString();
  providers.github.lastError = null;
  providers.github.lastErrorAt = null;
  return { skipped: false, changed, url: repository.html_url, workspace };
}

async function githubPull(providers) {
  if (!providers.github.auth?.accessToken) throw new Error("Connect GitHub first.");
  const token = await githubToken(providers);
  const repository = await ensureGitHubRepository(providers);
  const workspace = await readGitHubWorkspace(
    repository,
    providers.github.config.rootDirectory,
    token,
  );
  if (!workspace) throw new Error("No ExcaliSync workspace was found in this repository.");
  providers.github.repositoryUrl = repository.html_url;
  await rememberGitHubHead(providers, repository, token);
  providers.github.lastSyncAt = new Date().toISOString();
  providers.github.lastError = null;
  providers.github.lastErrorAt = null;
  return { workspace, url: repository.html_url };
}

function githubWorkspaceFile(workspace, providers, fileId) {
  const file = ExcalidrawSyncCore.buildProviderFiles(
    workspace,
    providers.github.config.rootDirectory,
  ).find((candidate) => candidate.id === fileId);
  if (!file || !file.path.endsWith(".excalidraw")) {
    throw new Error("This drawing does not have a GitHub path yet.");
  }
  return file;
}

async function githubFileHistory(workspace, fileId, providers) {
  if (!providers.github.auth?.accessToken) throw new Error("Connect GitHub first.");
  const token = await githubToken(providers);
  const repository = await ensureGitHubRepository(providers);
  const owner = repository.owner.login;
  const repo = repository.name;
  const branch = repository.default_branch || "main";
  const file = githubWorkspaceFile(workspace, providers, fileId);
  const commits = [];
  for (let page = 1; ; page += 1) {
    const batch = await githubRequest(
      `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/commits?sha=${encodeURIComponent(branch)}&path=${encodeURIComponent(file.path)}&per_page=100&page=${page}`,
      token,
      { cache: "no-store", headers: { "Cache-Control": "no-cache" } },
    );
    if (!Array.isArray(batch) || !batch.length) break;
    commits.push(...batch);
    if (batch.length < 100) break;
  }
  return {
    path: file.path,
    commits: commits.map((entry) => ({
      sha: entry.sha,
      shortSha: String(entry.sha || "").slice(0, 7),
      message: String(entry.commit?.message || "Saved drawing").split("\n")[0],
      author: entry.author?.login || entry.commit?.author?.name || "GitHub user",
      committedAt: entry.commit?.author?.date || entry.commit?.committer?.date || null,
      url: entry.html_url || null,
    })),
  };
}

async function githubFileVersion(workspace, fileId, sha, providers) {
  if (!providers.github.auth?.accessToken) throw new Error("Connect GitHub first.");
  if (!/^[a-f0-9]{7,40}$/i.test(String(sha || ""))) {
    throw new Error("Choose a valid GitHub file version.");
  }
  const token = await githubToken(providers);
  const repository = await ensureGitHubRepository(providers);
  const owner = repository.owner.login;
  const repo = repository.name;
  const file = githubWorkspaceFile(workspace, providers, fileId);
  const content = await githubRawRequest(
    `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/${encodeGitHubPath(file.path)}?ref=${encodeURIComponent(sha)}`,
    token,
  );
  return {
    path: file.path,
    sha,
    scene: ExcalidrawSyncCore.normalizeScene(JSON.parse(content)),
  };
}


function selectedSyncProvider(providers) {
  return providers.syncAuthority === "github" ? "github" : "local";
}

async function syncAll(workspaceInput, { syncBaseline = null, conflictResolution = null } = {}) {
  let workspace = ExcalidrawSyncCore.normalizeWorkspace(workspaceInput);
  const providers = await readProviders();
  const authority = selectedSyncProvider(providers);
  const result = { github: { skipped: true } };
  if (authority === "github" && providers.github.auth?.accessToken) {
    try {
      result.github = await githubSync(workspace, providers, { syncBaseline, conflictResolution });
      workspace = result.github.workspace || workspace;
    } catch (error) {
      const retryable = error.status === 409;
      if (retryable) {
        providers.github.lastError = null;
        providers.github.lastErrorAt = null;
        result.github = {
          retryable: error.status === 409,
          message: "GitHub changed while syncing · pulling the latest version before retrying…",
        };
      } else {
        providers.github.lastError = cleanMessage(error);
        providers.github.lastErrorAt = new Date().toISOString();
        result.github = { error: providers.github.lastError };
      }
    }
  }
  await writeProviders(providers);
  return { result, providers: publicProviderState(providers), workspace };
}

async function handleMessage(message) {
  switch (message?.type) {
    case "providers:get":
      return publicProviderState(await readProviders());
    case "providers:save": {
      const providers = await readProviders();
      if (message.github) {
        const previousAutoSquash = providers.github.autoSquash;
        const autoSquash = ExcalidrawSyncCore.normalizeAutoSquashSettings(message.github.autoSquash);
        const scheduleChanged = previousAutoSquash.enabled !== autoSquash.enabled
          || previousAutoSquash.intervalDays !== autoSquash.intervalDays;
        providers.github.config = {
          ...providers.github.config,
          clientId: String(message.github.clientId || "").trim(),
          repoName: String(message.github.repoName || "excalidraw-diagrams").trim(),
          visibility: message.github.visibility === "public" ? "public" : "private",
          rootDirectory: String(message.github.rootDirectory || "Excalidraw").trim(),
        };
        providers.github.autoSquash = {
          ...previousAutoSquash,
          ...autoSquash,
          nextRunAt: autoSquash.enabled
            ? scheduleChanged ? nextAutoSquashTime(autoSquash) : previousAutoSquash.nextRunAt
            : null,
        };
      }
      if (["local", "github"].includes(message.syncAuthority)) {
        providers.syncAuthority = message.syncAuthority;
      }
      await writeProviders(providers);
      await configureAutoSquashAlarm(providers, { reset: false });
      return publicProviderState(providers);
    }
    case "github:startAuth":
      return githubStartAuth();
    case "github:pollAuth":
      return githubPollAuth();
    case "github:pull": {
      const providers = await readProviders();
      const result = await githubPull(providers);
      await writeProviders(providers);
      return { ...result, providers: publicProviderState(providers) };
    }
    case "github:commitStatus": {
      const providers = await readProviders();
      const result = await githubCommitStatus(providers);
      await writeProviders(providers);
      return { ...result, providers: publicProviderState(providers) };
    }
    case "github:push": {
      const providers = await readProviders();
      const result = await githubSync(message.workspace, providers, {
        force: Boolean(message.force),
        syncBaseline: message.syncBaseline,
        conflictResolution: message.conflictResolution,
      });
      await writeProviders(providers);
      return { ...result, providers: publicProviderState(providers) };
    }
    case "github:squash": {
      const providers = await readProviders();
      const result = await githubSquash(providers);
      const autoSquash = ExcalidrawSyncCore.normalizeAutoSquashSettings(providers.github.autoSquash);
      providers.github.autoSquash = {
        ...providers.github.autoSquash,
        ...autoSquash,
        lastRunAt: new Date().toISOString(),
        nextRunAt: autoSquash.enabled ? nextAutoSquashTime(autoSquash) : null,
        lastError: null,
      };
      await configureAutoSquashAlarm(providers, { reset: autoSquash.enabled });
      return { ...result, providers: publicProviderState(providers) };
    }
    case "github:fileHistory": {
      const providers = await readProviders();
      return githubFileHistory(message.workspace, message.fileId, providers);
    }
    case "github:fileVersion": {
      const providers = await readProviders();
      return githubFileVersion(message.workspace, message.fileId, message.sha, providers);
    }
    case "provider:disconnect": {
      const providers = await readProviders();
      if (message.provider === "github") {
        providers.github.auth = null;
        providers.github.account = null;
        providers.github.pendingAuth = null;
        providers.github.lastKnownCommitSha = null;
        providers.github.lastKnownCommitAt = null;
      }
      await writeProviders(providers);
      return publicProviderState(providers);
    }
    case "sync:workspace":
      syncInFlight = syncInFlight
        .catch(() => {})
        .then(() => syncAll(message.workspace, {
          syncBaseline: message.syncBaseline,
          conflictResolution: message.conflictResolution,
        }));
      return syncInFlight;
    case "native:syncWorkspace":
      return nativeMessage({ type: "syncWorkspace", workspace: message.workspace });
    case "native:readTrashBackup":
      return nativeMessage({
        type: "readTrashBackup",
        kind: message.kind,
        id: message.id,
        name: message.name,
        fileName: message.fileName,
      });
    case "native:status":
      return nativeMessage({ type: "status" });
    case "native:openVault":
      return nativeMessage({ type: "openVault" });
    case "native:clearVault":
      return nativeMessage({ type: "clearVault" });
    case "native:logError":
      return nativeMessage({ type: "writeErrorLog", error: message.error });
    case "vault:open":
      await apiCall(extensionApi.tabs, "create", { url: extensionApi.runtime.getURL("vault.html") });
      return { opened: true };
    default:
      return null;
  }
}

extensionApi.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  handleMessage(message)
    .then((data) => sendResponse({ ok: true, data }))
    .catch((error) => sendResponse({ ok: false, error: cleanMessage(error) }));
  return true;
});

extensionApi.runtime.onInstalled.addListener((details) => {
  if (details.reason === "install") {
    void storageSet(LAUNCHER_INTRODUCED_KEY, false).catch(() => {});
  }
  void configureAutoSquashAlarm().catch(() => {});
});

extensionApi.runtime.onStartup.addListener(() => {
  void configureAutoSquashAlarm().catch(() => {});
});

extensionApi.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === GITHUB_AUTO_SQUASH_ALARM) {
    void runAutomaticGitHubSquash();
  }
});

extensionApi.action.onClicked.addListener(async (tab) => {
  if (!tab.id || !tab.url?.startsWith("https://excalidraw.com/")) {
    return;
  }
  await storageSet(LAUNCHER_INTRODUCED_KEY, true).catch(() => {});
  try {
    await apiCall(extensionApi.tabs, "sendMessage", tab.id, { type: "sidebar:toggle" });
  } catch (_error) {
    await storageSet(SIDEBAR_OPEN_REQUEST_KEY, true);
    await apiCall(extensionApi.tabs, "reload", tab.id);
  }
});
