(function initializeCore(globalScope) {
  "use strict";

  const WORKSPACE_VERSION = 2;
  const TRASH_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
  const DEFAULT_FOLDER_NAME = "My diagrams";

  function makeId(prefix = "id") {
    const cryptoApi = globalScope.crypto;
    if (cryptoApi?.randomUUID) {
      return `${prefix}_${cryptoApi.randomUUID()}`;
    }
    return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
  }

  function nowIso() {
    return new Date().toISOString();
  }

  function emptyScene() {
    return {
      type: "excalidraw",
      version: 2,
      source: "https://excalidraw.com",
      elements: [],
      appState: {},
      files: {},
    };
  }

  function normalizeScene(input) {
    const scene = typeof input === "string" ? JSON.parse(input) : input;
    if (!scene || typeof scene !== "object" || scene.type !== "excalidraw") {
      throw new Error("This is not a valid Excalidraw file.");
    }
    if (!Array.isArray(scene.elements)) {
      throw new Error("The Excalidraw file has no element list.");
    }
    return {
      type: "excalidraw",
      version: Number.isFinite(scene.version) ? scene.version : 2,
      source: typeof scene.source === "string" ? scene.source : "https://excalidraw.com",
      elements: scene.elements,
      appState: scene.appState && typeof scene.appState === "object" ? scene.appState : {},
      files: scene.files && typeof scene.files === "object" ? scene.files : {},
    };
  }

  function createWorkspace(name = "My Excalidraw") {
    const createdAt = nowIso();
    const folder = {
      id: makeId("folder"),
      name: DEFAULT_FOLDER_NAME,
      createdAt,
      updatedAt: createdAt,
    };
    const file = {
      id: makeId("file"),
      folderId: folder.id,
      name: "Untitled",
      pinned: false,
      scene: emptyScene(),
      hash: "",
      createdAt,
      updatedAt: createdAt,
    };
    return {
      version: WORKSPACE_VERSION,
      id: makeId("workspace"),
      name,
      folders: [folder],
      files: [file],
      trash: [],
      sortMode: "manual",
      activeFileId: file.id,
      createdAt,
      updatedAt: createdAt,
    };
  }

  function normalizeWorkspace(input) {
    const source = input && typeof input === "object" ? input : createWorkspace();
    const folders = Array.isArray(source.folders) ? source.folders.filter(Boolean) : [];
    const files = Array.isArray(source.files) ? source.files.filter(Boolean) : [];
    const trash = Array.isArray(source.trash) ? source.trash.filter(Boolean) : [];
    return {
      version: WORKSPACE_VERSION,
      id: source.id || makeId("workspace"),
      name: source.name || "My Excalidraw",
      folders,
      files,
      trash,
      sortMode: ["manual", "alphabetical", "updated"].includes(source.sortMode)
        ? source.sortMode
        : "manual",
      activeFileId: files.some((file) => file.id === source.activeFileId)
        ? source.activeFileId
        : files[0]?.id || null,
      createdAt: source.createdAt || nowIso(),
      updatedAt: source.updatedAt || nowIso(),
    };
  }

  function slugify(value, fallback = "untitled") {
    const result = String(value || "")
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-zA-Z0-9._ -]/g, "")
      .trim()
      .replace(/\s+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^[-.]+|[-.]+$/g, "")
      .toLowerCase();
    return result || fallback;
  }

  function stableValue(value) {
    if (Array.isArray(value)) {
      return value.map(stableValue);
    }
    if (value && typeof value === "object") {
      return Object.keys(value)
        .sort()
        .reduce((result, key) => {
          if (key !== "lastRetrieved") {
            result[key] = stableValue(value[key]);
          }
          return result;
        }, {});
    }
    return value;
  }

  function stableStringify(value) {
    return JSON.stringify(stableValue(value));
  }

  function hashString(value) {
    let hash = 2166136261;
    for (let index = 0; index < value.length; index += 1) {
      hash ^= value.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(16).padStart(8, "0");
  }

  function hashScene(scene) {
    return hashString(stableStringify(normalizeScene(scene)));
  }

  function uniquePath(basePath, usedPaths) {
    let path = basePath;
    let counter = 2;
    const dot = basePath.lastIndexOf(".");
    const stem = dot > -1 ? basePath.slice(0, dot) : basePath;
    const extension = dot > -1 ? basePath.slice(dot) : "";
    while (usedPaths.has(path)) {
      path = `${stem}-${counter}${extension}`;
      counter += 1;
    }
    usedPaths.add(path);
    return path;
  }

  function buildProviderFiles(workspaceInput, rootDirectory = "Excalidraw") {
    const workspace = normalizeWorkspace(workspaceInput);
    const usedPaths = new Set();
    const foldersById = new Map(workspace.folders.map((folder) => [folder.id, folder]));
    const requestedRoot = String(rootDirectory || "").trim();
    const hiddenRoot = requestedRoot.startsWith(".");
    const rootName = slugify(requestedRoot.replace(/^\.+/, ""), "excalidraw");
    const root = hiddenRoot ? `.${rootName}` : rootName;
    const files = workspace.files.map((file) => {
      const folder = foldersById.get(file.folderId);
      const folderPath = folder ? slugify(folder.name, "unfiled") : "unfiled";
      const filename = `${slugify(file.name)}.excalidraw`;
      const path = uniquePath(`${root}/${folderPath}/${filename}`, usedPaths);
      const scene = normalizeScene(file.scene || emptyScene());
      return {
        id: file.id,
        folderId: file.folderId || null,
        path,
        name: file.name,
        content: `${JSON.stringify(scene, null, 2)}\n`,
        hash: hashScene(scene),
      };
    });
    const indexPath = `${root}/.excalidraw-sync.json`;
    const index = {
      formatVersion: 2,
      workspaceId: workspace.id,
      workspaceName: workspace.name,
      generatedAt: workspace.updatedAt,
      activeFileId: workspace.activeFileId,
      sortMode: workspace.sortMode,
      folders: workspace.folders.map(({ id, name, createdAt, updatedAt }) => ({ id, name, createdAt, updatedAt })),
      files: files.map(({ id, folderId, path, name, hash }) => {
        const source = workspace.files.find((file) => file.id === id);
        return { id, folderId, path, name, hash, pinned: Boolean(source?.pinned), createdAt: source?.createdAt, updatedAt: source?.updatedAt };
      }),
      tombstones: workspace.trash.map((item) => ({
        kind: item.kind,
        id: item.entry?.id,
        deletedAt: item.deletedAt,
      })).filter((item) => item.id),
    };
    files.push({
      id: "workspace-index",
      folderId: null,
      path: indexPath,
      name: ".excalidraw-sync.json",
      content: `${JSON.stringify(index, null, 2)}\n`,
      hash: hashString(stableStringify(index)),
    });
    return files;
  }

  function buildLocalVault(workspaceInput, rootDirectory = ".excalidraw-sync") {
    const workspace = normalizeWorkspace(workspaceInput);
    const files = buildProviderFiles(workspace, rootDirectory);
    return {
      formatVersion: 1,
      kind: "browser-local-vault",
      rootDirectory: files[0]?.path.split("/")[0] || ".excalidraw-sync",
      workspaceId: workspace.id,
      updatedAt: workspace.updatedAt,
      files,
    };
  }

  function timestamp(value) {
    const result = new Date(value || 0).getTime();
    return Number.isFinite(result) ? result : 0;
  }

  function isStarterWorkspace(workspaceInput) {
    const workspace = normalizeWorkspace(workspaceInput);
    return workspace.folders.length === 1
      && workspace.files.length === 1
      && workspace.files[0].name === "Untitled"
      && normalizeScene(workspace.files[0].scene || emptyScene()).elements.length === 0
      && workspace.trash.length === 0;
  }

  function workspaceFromProviderIndex(indexInput, scenesByPath = {}) {
    const index = indexInput && typeof indexInput === "object" ? indexInput : {};
    const generatedAt = index.generatedAt || nowIso();
    const folders = (Array.isArray(index.folders) ? index.folders : []).filter((folder) => folder?.id).map((folder) => ({
      id: folder.id,
      name: folder.name || "Untitled folder",
      createdAt: folder.createdAt || generatedAt,
      updatedAt: folder.updatedAt || generatedAt,
    }));
    const files = (Array.isArray(index.files) ? index.files : []).flatMap((file) => {
      if (!file?.id || !file.path || !scenesByPath[file.path]) return [];
      const scene = normalizeScene(scenesByPath[file.path]);
      return [{
        id: file.id,
        folderId: file.folderId || null,
        name: file.name || "Untitled",
        pinned: Boolean(file.pinned),
        scene,
        hash: file.hash || hashScene(scene),
        createdAt: file.createdAt || generatedAt,
        updatedAt: file.updatedAt || generatedAt,
      }];
    });
    const trash = (Array.isArray(index.tombstones) ? index.tombstones : []).filter((item) => item?.id).map((item) => ({
      kind: item.kind === "folder" ? "folder" : "file",
      deletedAt: item.deletedAt || generatedAt,
      entry: { id: item.id },
    }));
    return normalizeWorkspace({
      id: index.workspaceId,
      name: index.workspaceName,
      folders,
      files,
      trash,
      sortMode: index.sortMode,
      activeFileId: index.activeFileId,
      createdAt: index.createdAt || generatedAt,
      updatedAt: generatedAt,
    });
  }

  function mergeWorkspaces(localInput, remoteInput) {
    const local = normalizeWorkspace(localInput);
    const remote = normalizeWorkspace(remoteInput);
    if (isStarterWorkspace(local) && remote.files.length) {
      return normalizeWorkspace({ ...remote, trash: [...remote.trash] });
    }
    const newestById = (leftItems, rightItems) => {
      const merged = new Map();
      for (const item of [...leftItems, ...rightItems]) {
        const existing = merged.get(item.id);
        if (!existing || timestamp(item.updatedAt) >= timestamp(existing.updatedAt)) merged.set(item.id, item);
      }
      return merged;
    };
    const folders = newestById(local.folders, remote.folders);
    const files = newestById(local.files, remote.files);
    const tombstones = new Map();
    for (const item of [...local.trash, ...remote.trash]) {
      const id = item.entry?.id;
      if (!id) continue;
      const key = `${item.kind}:${id}`;
      const existing = tombstones.get(key);
      if (!existing || timestamp(item.deletedAt) >= timestamp(existing.deletedAt)) tombstones.set(key, item);
    }
    for (const tombstone of tombstones.values()) {
      const id = tombstone.entry.id;
      if (tombstone.kind === "folder") {
        const folder = folders.get(id);
        if (!folder || timestamp(tombstone.deletedAt) >= timestamp(folder.updatedAt)) folders.delete(id);
        for (const [fileId, file] of files) {
          if (file.folderId === id && timestamp(tombstone.deletedAt) >= timestamp(file.updatedAt)) files.delete(fileId);
        }
      } else {
        const file = files.get(id);
        if (!file || timestamp(tombstone.deletedAt) >= timestamp(file.updatedAt)) files.delete(id);
      }
    }
    const mergedFiles = [...files.values()];
    const preferredActiveId = files.has(local.activeFileId)
      ? local.activeFileId
      : files.has(remote.activeFileId) ? remote.activeFileId : mergedFiles[0]?.id || null;
    return normalizeWorkspace({
      ...local,
      id: remote.id || local.id,
      name: remote.name || local.name,
      folders: [...folders.values()],
      files: mergedFiles,
      trash: [...tombstones.values()],
      activeFileId: preferredActiveId,
      sortMode: timestamp(remote.updatedAt) > timestamp(local.updatedAt) ? remote.sortMode : local.sortMode,
      updatedAt: new Date(Math.max(timestamp(local.updatedAt), timestamp(remote.updatedAt)) || Date.now()).toISOString(),
    });
  }

  function removeEntry(workspaceInput, kind, id) {
    const workspace = normalizeWorkspace(workspaceInput);
    if (kind === "file") {
      workspace.files = workspace.files.filter((file) => file.id !== id);
    } else if (kind === "folder") {
      workspace.folders = workspace.folders.filter((folder) => folder.id !== id);
      workspace.files = workspace.files.filter((file) => file.folderId !== id);
    } else {
      throw new Error("Unknown entry type.");
    }
    if (!workspace.files.some((file) => file.id === workspace.activeFileId)) {
      workspace.activeFileId = workspace.files[0]?.id || null;
    }
    workspace.updatedAt = nowIso();
    return workspace;
  }

  function trashEntry(workspaceInput, kind, id, deletedAt = nowIso()) {
    const workspace = normalizeWorkspace(workspaceInput);
    if (kind === "file") {
      const entry = workspace.files.find((file) => file.id === id);
      if (!entry) return workspace;
      workspace.trash.push({ kind, deletedAt, entry });
      workspace.files = workspace.files.filter((file) => file.id !== id);
    } else if (kind === "folder") {
      const entry = workspace.folders.find((folder) => folder.id === id);
      if (!entry) return workspace;
      const files = workspace.files.filter((file) => file.folderId === id);
      workspace.trash.push({ kind, deletedAt, entry, files });
      workspace.folders = workspace.folders.filter((folder) => folder.id !== id);
      workspace.files = workspace.files.filter((file) => file.folderId !== id);
    } else {
      throw new Error("Unknown entry type.");
    }
    if (!workspace.files.some((file) => file.id === workspace.activeFileId)) {
      workspace.activeFileId = workspace.files[0]?.id || null;
    }
    workspace.updatedAt = deletedAt;
    return workspace;
  }

  function purgeExpiredTrash(workspaceInput, now = new Date()) {
    const workspace = normalizeWorkspace(workspaceInput);
    const nowTime = now instanceof Date ? now.getTime() : new Date(now).getTime();
    workspace.trash = workspace.trash.filter((item) => {
      const deletedTime = new Date(item.deletedAt).getTime();
      return Number.isFinite(deletedTime) && nowTime - deletedTime <= TRASH_RETENTION_MS;
    });
    return workspace;
  }

  function sortedFiles(files, mode = "manual") {
    const result = [...files];
    if (mode === "alphabetical") {
      result.sort((left, right) => String(left.name).localeCompare(String(right.name), undefined, { sensitivity: "base" }));
    } else if (mode === "updated") {
      result.sort((left, right) => new Date(right.updatedAt || 0) - new Date(left.updatedAt || 0));
    }
    return result;
  }

  function moveFile(workspaceInput, fileId, targetFolderId, beforeFileId = null) {
    const workspace = normalizeWorkspace(workspaceInput);
    const sourceIndex = workspace.files.findIndex((file) => file.id === fileId);
    if (sourceIndex < 0) return workspace;
    const [file] = workspace.files.splice(sourceIndex, 1);
    file.folderId = targetFolderId;
    file.updatedAt = nowIso();
    const beforeIndex = beforeFileId
      ? workspace.files.findIndex((candidate) => candidate.id === beforeFileId)
      : -1;
    workspace.files.splice(beforeIndex >= 0 ? beforeIndex : workspace.files.length, 0, file);
    workspace.sortMode = "manual";
    workspace.updatedAt = file.updatedAt;
    return workspace;
  }

  function isDeleteSwipe(startX, endX, startY, endY) {
    const horizontal = startX - endX;
    const vertical = Math.abs(startY - endY);
    return horizontal >= 64 && vertical <= 36;
  }

  const api = {
    WORKSPACE_VERSION,
    TRASH_RETENTION_MS,
    DEFAULT_FOLDER_NAME,
    makeId,
    nowIso,
    emptyScene,
    normalizeScene,
    createWorkspace,
    normalizeWorkspace,
    slugify,
    stableStringify,
    hashString,
    hashScene,
    buildProviderFiles,
    buildLocalVault,
    isStarterWorkspace,
    workspaceFromProviderIndex,
    mergeWorkspaces,
    removeEntry,
    trashEntry,
    purgeExpiredTrash,
    sortedFiles,
    moveFile,
    isDeleteSwipe,
  };

  globalScope.ExcalidrawSyncCore = api;
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this);
