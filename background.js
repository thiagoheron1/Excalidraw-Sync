/* global ExcalidrawSyncCore */
"use strict";

importScripts("shared/core.js");

const extensionApi = globalThis.browser || globalThis.chrome;
const usesPromiseApi = typeof globalThis.browser !== "undefined";
const PROVIDERS_KEY = "excalidrawSync.providers";

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

function defaultProviderState() {
  return {
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
      repositoryUrl: null,
    },
    googleDrive: {
      config: {
        clientId: "",
        folderName: "Excalidraw",
        visibility: "private",
      },
      auth: null,
      account: null,
      folderId: null,
      lastSyncAt: null,
      lastError: null,
      folderUrl: null,
    },
  };
}

async function readProviders() {
  const stored = await storageGet(PROVIDERS_KEY);
  const defaults = defaultProviderState();
  if (!stored) {
    return defaults;
  }
  return {
    github: {
      ...defaults.github,
      ...stored.github,
      config: { ...defaults.github.config, ...stored.github?.config },
    },
    googleDrive: {
      ...defaults.googleDrive,
      ...stored.googleDrive,
      config: { ...defaults.googleDrive.config, ...stored.googleDrive?.config },
    },
  };
}

async function writeProviders(providers) {
  await storageSet(PROVIDERS_KEY, providers);
}

function publicProviderState(providers) {
  return {
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
      repositoryUrl: providers.github.repositoryUrl,
    },
    googleDrive: {
      config: providers.googleDrive.config,
      connected: Boolean(providers.googleDrive.auth?.accessToken),
      account: providers.googleDrive.account,
      lastSyncAt: providers.googleDrive.lastSyncAt,
      lastError: providers.googleDrive.lastError,
      folderUrl: providers.googleDrive.folderUrl,
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
  providers.github.auth = { accessToken: body.access_token };
  providers.github.account = { login: account.login, avatarUrl: account.avatar_url };
  providers.github.pendingAuth = null;
  providers.github.lastError = null;
  await writeProviders(providers);
  return { pending: false, provider: publicProviderState(providers).github };
}

function encodeGitHubPath(path) {
  return path.split("/").map(encodeURIComponent).join("/");
}

async function getGitHubContent(owner, repo, path, token, branch) {
  try {
    return await githubRequest(
      `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/${encodeGitHubPath(path)}?ref=${encodeURIComponent(branch)}`,
      token,
    );
  } catch (error) {
    if (error.status === 404) {
      return null;
    }
    throw error;
  }
}

async function ensureGitHubRepository(providers) {
  const { accessToken } = providers.github.auth;
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
    );
    return new Map((result.tree || []).filter((item) => item.type === "blob").map((item) => [item.path, item.sha]));
  } catch (error) {
    if (error.status === 404 || error.status === 409) {
      return new Map();
    }
    throw error;
  }
}

async function gitBlobSha(content) {
  const contentBytes = new TextEncoder().encode(content);
  const header = new TextEncoder().encode(`blob ${contentBytes.byteLength}\0`);
  const joined = new Uint8Array(header.byteLength + contentBytes.byteLength);
  joined.set(header);
  joined.set(contentBytes, header.byteLength);
  const digest = await crypto.subtle.digest("SHA-1", joined);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function githubSync(workspace, providers) {
  if (!providers.github.auth?.accessToken) {
    return { skipped: true };
  }
  const token = providers.github.auth.accessToken;
  const repository = await ensureGitHubRepository(providers);
  const owner = repository.owner.login;
  const repo = repository.name;
  const branch = repository.default_branch || "main";
  const desiredFiles = ExcalidrawSyncCore.buildProviderFiles(
    workspace,
    providers.github.config.rootDirectory,
  );
  const indexFile = desiredFiles.find((file) => file.id === "workspace-index");
  const previousIndexResponse = await getGitHubContent(owner, repo, indexFile.path, token, branch);
  let previousPaths = [];
  if (previousIndexResponse?.content) {
    try {
      const previousIndex = JSON.parse(base64ToUtf8(previousIndexResponse.content));
      previousPaths = (previousIndex.files || []).map((file) => file.path);
    } catch (_error) {
      previousPaths = [];
    }
  }
  const tree = await githubTree(owner, repo, branch, token);
  const desiredPaths = new Set(desiredFiles.map((file) => file.path));
  const changed = [];
  for (const file of desiredFiles.filter((item) => item.id !== "workspace-index")) {
    const blobSha = await gitBlobSha(file.content);
    if (tree.get(file.path) !== blobSha) {
      const payload = {
        message: `Sync ${file.name}`,
        content: utf8ToBase64(file.content),
        branch,
      };
      if (tree.has(file.path)) {
        payload.sha = tree.get(file.path);
      }
      await githubRequest(
        `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/${encodeGitHubPath(file.path)}`,
        token,
        { method: "PUT", body: JSON.stringify(payload) },
      );
      changed.push(file.path);
    }
  }
  for (const path of previousPaths.filter((path) => !desiredPaths.has(path))) {
    const sha = tree.get(path);
    if (sha) {
      await githubRequest(
        `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/${encodeGitHubPath(path)}`,
        token,
        {
          method: "DELETE",
          body: JSON.stringify({ message: `Remove ${path}`, sha, branch }),
        },
      );
      changed.push(path);
    }
  }
  const refreshedIndex = await getGitHubContent(owner, repo, indexFile.path, token, branch);
  const indexBlobSha = await gitBlobSha(indexFile.content);
  if (refreshedIndex?.sha !== indexBlobSha) {
    await githubRequest(
      `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/${encodeGitHubPath(indexFile.path)}`,
      token,
      {
        method: "PUT",
        body: JSON.stringify({
          message: "Update Excalidraw Sync index",
          content: utf8ToBase64(indexFile.content),
          branch,
          ...(refreshedIndex?.sha ? { sha: refreshedIndex.sha } : {}),
        }),
      },
    );
    changed.push(indexFile.path);
  }
  providers.github.repositoryUrl = repository.html_url;
  providers.github.lastSyncAt = new Date().toISOString();
  providers.github.lastError = null;
  return { skipped: false, changed, url: repository.html_url };
}

async function launchWebAuthFlow(details) {
  return apiCall(extensionApi.identity, "launchWebAuthFlow", details);
}

async function googleToken(providers) {
  const auth = providers.googleDrive.auth;
  if (!auth) {
    throw new Error("Connect Google Drive first.");
  }
  if (auth.expiresAt > Date.now() + 60_000) {
    return auth.accessToken;
  }
  if (!auth.refreshToken) {
    throw new Error("Google Drive access expired. Connect again.");
  }
  const body = await fetchJson("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: providers.googleDrive.config.clientId,
      refresh_token: auth.refreshToken,
      grant_type: "refresh_token",
    }),
  });
  providers.googleDrive.auth = {
    ...auth,
    accessToken: body.access_token,
    expiresAt: Date.now() + body.expires_in * 1000,
  };
  await writeProviders(providers);
  return body.access_token;
}

async function googleConnect() {
  const providers = await readProviders();
  const clientId = providers.googleDrive.config.clientId.trim();
  if (!clientId) {
    throw new Error("Add a Google OAuth client ID first.");
  }
  const verifierBytes = crypto.getRandomValues(new Uint8Array(48));
  const verifier = base64Url(verifierBytes);
  const challenge = base64Url(
    new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier))),
  );
  const state = base64Url(crypto.getRandomValues(new Uint8Array(18)));
  const redirectUri = extensionApi.identity.getRedirectURL("google");
  const authUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  authUrl.search = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: "openid email https://www.googleapis.com/auth/drive.file",
    code_challenge: challenge,
    code_challenge_method: "S256",
    access_type: "offline",
    prompt: "consent",
    state,
  }).toString();
  const redirect = await launchWebAuthFlow({ url: authUrl.toString(), interactive: true });
  if (!redirect) {
    throw new Error("Google sign-in was cancelled.");
  }
  const resultUrl = new URL(redirect);
  if (resultUrl.searchParams.get("state") !== state) {
    throw new Error("Google sign-in could not be verified.");
  }
  const code = resultUrl.searchParams.get("code");
  if (!code) {
    throw new Error(resultUrl.searchParams.get("error") || "Google sign-in returned no authorization code.");
  }
  const tokens = await fetchJson("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      code,
      code_verifier: verifier,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
    }),
  });
  const account = await fetchJson("https://www.googleapis.com/oauth2/v2/userinfo", {
    headers: { Authorization: `Bearer ${tokens.access_token}` },
  });
  providers.googleDrive.auth = {
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token || null,
    expiresAt: Date.now() + tokens.expires_in * 1000,
  };
  providers.googleDrive.account = { email: account.email, picture: account.picture };
  providers.googleDrive.lastError = null;
  await writeProviders(providers);
  return publicProviderState(providers).googleDrive;
}

async function driveRequest(path, token, options = {}) {
  return fetchJson(`https://www.googleapis.com${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(options.body && typeof options.body === "string" ? { "Content-Type": "application/json" } : {}),
      ...options.headers,
    },
  });
}

function driveQuery(value) {
  return encodeURIComponent(value);
}

async function listDriveWorkspaceItems(workspaceId, token) {
  const items = [];
  let pageToken = "";
  do {
    const query = `appProperties has { key='excalidrawSyncWorkspace' and value='${workspaceId.replace(/'/g, "\\'")}' } and trashed=false`;
    const params = new URLSearchParams({
      q: query,
      fields: "nextPageToken,files(id,name,mimeType,parents,appProperties,modifiedTime)",
      pageSize: "1000",
      spaces: "drive",
    });
    if (pageToken) {
      params.set("pageToken", pageToken);
    }
    const result = await driveRequest(`/drive/v3/files?${params}`, token);
    items.push(...(result.files || []));
    pageToken = result.nextPageToken || "";
  } while (pageToken);
  return items;
}

async function createDriveMetadata(metadata, token) {
  return driveRequest("/drive/v3/files?fields=id,name,mimeType,parents,appProperties", token, {
    method: "POST",
    body: JSON.stringify(metadata),
  });
}

async function patchDriveMetadata(id, metadata, token, parentChange = null) {
  const params = new URLSearchParams({ fields: "id,name,mimeType,parents,appProperties" });
  if (parentChange?.add) {
    params.set("addParents", parentChange.add);
  }
  if (parentChange?.remove) {
    params.set("removeParents", parentChange.remove);
  }
  return driveRequest(`/drive/v3/files/${encodeURIComponent(id)}?${params}`, token, {
    method: "PATCH",
    body: JSON.stringify(metadata),
  });
}

async function uploadDriveJson(id, metadata, content, token) {
  const boundary = `excalidraw_sync_${crypto.randomUUID?.() || Date.now()}`;
  const body = [
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n`,
    `--${boundary}\r\nContent-Type: application/json\r\n\r\n${content}\r\n`,
    `--${boundary}--`,
  ].join("");
  const path = id
    ? `/upload/drive/v3/files/${encodeURIComponent(id)}?uploadType=multipart&fields=id,name,parents,appProperties`
    : "/upload/drive/v3/files?uploadType=multipart&fields=id,name,parents,appProperties";
  return fetchJson(`https://www.googleapis.com${path}`, {
    method: id ? "PATCH" : "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": `multipart/related; boundary=${boundary}`,
    },
    body,
  });
}

async function setDriveVisibility(folderId, visibility, token) {
  const permissions = await driveRequest(
    `/drive/v3/files/${encodeURIComponent(folderId)}/permissions?fields=permissions(id,type,role)`,
    token,
  );
  const publicPermission = (permissions.permissions || []).find((permission) => permission.type === "anyone");
  if (visibility === "public" && !publicPermission) {
    await driveRequest(`/drive/v3/files/${encodeURIComponent(folderId)}/permissions`, token, {
      method: "POST",
      body: JSON.stringify({ type: "anyone", role: "reader" }),
    });
  }
  if (visibility !== "public" && publicPermission) {
    await driveRequest(
      `/drive/v3/files/${encodeURIComponent(folderId)}/permissions/${encodeURIComponent(publicPermission.id)}`,
      token,
      { method: "DELETE" },
    );
  }
}

async function googleDriveSync(workspace, providers) {
  if (!providers.googleDrive.auth?.accessToken) {
    return { skipped: true };
  }
  const token = await googleToken(providers);
  let items = await listDriveWorkspaceItems(workspace.id, token);
  let root = items.find((item) => item.appProperties?.excalidrawSyncKind === "root");
  const rootMetadata = {
    name: providers.googleDrive.config.folderName.trim() || "Excalidraw",
    mimeType: "application/vnd.google-apps.folder",
    appProperties: {
      excalidrawSyncWorkspace: workspace.id,
      excalidrawSyncKind: "root",
    },
  };
  if (!root) {
    root = await createDriveMetadata(rootMetadata, token);
    items.push(root);
  } else if (root.name !== rootMetadata.name) {
    root = await patchDriveMetadata(root.id, { name: rootMetadata.name }, token);
  }
  await setDriveVisibility(root.id, providers.googleDrive.config.visibility, token);

  const foldersBySyncId = new Map(
    items
      .filter((item) => item.appProperties?.excalidrawSyncKind === "folder")
      .map((item) => [item.appProperties.excalidrawSyncId, item]),
  );
  const liveFolderIds = new Set();
  for (const folder of workspace.folders) {
    liveFolderIds.add(folder.id);
    const metadata = {
      name: folder.name,
      mimeType: "application/vnd.google-apps.folder",
      appProperties: {
        excalidrawSyncWorkspace: workspace.id,
        excalidrawSyncKind: "folder",
        excalidrawSyncId: folder.id,
      },
    };
    let remote = foldersBySyncId.get(folder.id);
    if (!remote) {
      remote = await createDriveMetadata({ ...metadata, parents: [root.id] }, token);
      foldersBySyncId.set(folder.id, remote);
    } else if (remote.name !== folder.name || remote.parents?.[0] !== root.id) {
      remote = await patchDriveMetadata(
        remote.id,
        { name: folder.name },
        token,
        remote.parents?.[0] !== root.id ? { add: root.id, remove: remote.parents?.join(",") } : null,
      );
      foldersBySyncId.set(folder.id, remote);
    }
  }

  const remoteFilesBySyncId = new Map(
    items
      .filter((item) => item.appProperties?.excalidrawSyncKind === "file")
      .map((item) => [item.appProperties.excalidrawSyncId, item]),
  );
  const liveFileIds = new Set();
  const changed = [];
  for (const file of workspace.files) {
    liveFileIds.add(file.id);
    const folder = foldersBySyncId.get(file.folderId);
    const parentId = folder?.id || root.id;
    const scene = ExcalidrawSyncCore.normalizeScene(file.scene);
    const content = `${JSON.stringify(scene, null, 2)}\n`;
    const contentHash = ExcalidrawSyncCore.hashString(content);
    const name = `${file.name.replace(/[\\/:*?"<>|]/g, "-") || "Untitled"}.excalidraw`;
    const metadata = {
      name,
      mimeType: "application/json",
      parents: [parentId],
      appProperties: {
        excalidrawSyncWorkspace: workspace.id,
        excalidrawSyncKind: "file",
        excalidrawSyncId: file.id,
        excalidrawSyncFolderId: file.folderId || "",
        contentHash,
      },
    };
    const remote = remoteFilesBySyncId.get(file.id);
    const needsUpdate =
      !remote ||
      remote.name !== name ||
      remote.parents?.[0] !== parentId ||
      remote.appProperties?.contentHash !== contentHash;
    if (needsUpdate) {
      if (remote && remote.parents?.[0] !== parentId) {
        await patchDriveMetadata(
          remote.id,
          {},
          token,
          { add: parentId, remove: remote.parents?.join(",") },
        );
      }
      const uploadMetadata = remote ? { ...metadata } : metadata;
      if (remote) {
        delete uploadMetadata.parents;
      }
      const uploaded = await uploadDriveJson(remote?.id || null, uploadMetadata, content, token);
      remoteFilesBySyncId.set(file.id, uploaded);
      changed.push(name);
    }
  }

  for (const [syncId, remote] of remoteFilesBySyncId) {
    if (!liveFileIds.has(syncId)) {
      await patchDriveMetadata(remote.id, { trashed: true }, token);
      changed.push(remote.name);
    }
  }
  for (const [syncId, remote] of foldersBySyncId) {
    if (!liveFolderIds.has(syncId)) {
      await patchDriveMetadata(remote.id, { trashed: true }, token);
      changed.push(remote.name);
    }
  }
  providers.googleDrive.folderId = root.id;
  providers.googleDrive.folderUrl = `https://drive.google.com/drive/folders/${root.id}`;
  providers.googleDrive.lastSyncAt = new Date().toISOString();
  providers.googleDrive.lastError = null;
  return { skipped: false, changed, url: providers.googleDrive.folderUrl };
}

async function syncAll(workspaceInput) {
  const workspace = ExcalidrawSyncCore.normalizeWorkspace(workspaceInput);
  const providers = await readProviders();
  const result = {};
  if (providers.github.auth?.accessToken) {
    try {
      result.github = await githubSync(workspace, providers);
    } catch (error) {
      providers.github.lastError = cleanMessage(error);
      result.github = { error: providers.github.lastError };
    }
  } else {
    result.github = { skipped: true };
  }
  if (providers.googleDrive.auth?.accessToken) {
    try {
      result.googleDrive = await googleDriveSync(workspace, providers);
    } catch (error) {
      providers.googleDrive.lastError = cleanMessage(error);
      result.googleDrive = { error: providers.googleDrive.lastError };
    }
  } else {
    result.googleDrive = { skipped: true };
  }
  await writeProviders(providers);
  return { result, providers: publicProviderState(providers) };
}

async function handleMessage(message) {
  switch (message?.type) {
    case "providers:get":
      return publicProviderState(await readProviders());
    case "providers:save": {
      const providers = await readProviders();
      if (message.github) {
        providers.github.config = {
          ...providers.github.config,
          clientId: String(message.github.clientId || "").trim(),
          repoName: String(message.github.repoName || "excalidraw-diagrams").trim(),
          visibility: message.github.visibility === "public" ? "public" : "private",
          rootDirectory: String(message.github.rootDirectory || "Excalidraw").trim(),
        };
      }
      if (message.googleDrive) {
        providers.googleDrive.config = {
          ...providers.googleDrive.config,
          clientId: String(message.googleDrive.clientId || "").trim(),
          folderName: String(message.googleDrive.folderName || "Excalidraw").trim(),
          visibility: message.googleDrive.visibility === "public" ? "public" : "private",
        };
      }
      await writeProviders(providers);
      return publicProviderState(providers);
    }
    case "github:startAuth":
      return githubStartAuth();
    case "github:pollAuth":
      return githubPollAuth();
    case "google:connect":
      return googleConnect();
    case "provider:disconnect": {
      const providers = await readProviders();
      if (message.provider === "github") {
        providers.github.auth = null;
        providers.github.account = null;
        providers.github.pendingAuth = null;
      } else if (message.provider === "googleDrive") {
        providers.googleDrive.auth = null;
        providers.googleDrive.account = null;
      }
      await writeProviders(providers);
      return publicProviderState(providers);
    }
    case "sync:workspace":
      return syncAll(message.workspace);
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

extensionApi.action.onClicked.addListener(async (tab) => {
  if (!tab.id || !tab.url?.startsWith("https://excalidraw.com/")) {
    return;
  }
  try {
    await apiCall(extensionApi.tabs, "sendMessage", tab.id, { type: "sidebar:toggle" });
  } catch (_error) {
    // The content script will be available after Excalidraw finishes loading.
  }
});
