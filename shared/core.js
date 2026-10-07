(function initializeCore(globalScope) {
  "use strict";

  const WORKSPACE_VERSION = 1;
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
      activeFileId: file.id,
      createdAt,
      updatedAt: createdAt,
    };
  }

  function normalizeWorkspace(input) {
    const source = input && typeof input === "object" ? input : createWorkspace();
    const folders = Array.isArray(source.folders) ? source.folders.filter(Boolean) : [];
    const files = Array.isArray(source.files) ? source.files.filter(Boolean) : [];
    return {
      version: WORKSPACE_VERSION,
      id: source.id || makeId("workspace"),
      name: source.name || "My Excalidraw",
      folders,
      files,
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
    const root = slugify(rootDirectory, "excalidraw");
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
      formatVersion: 1,
      workspaceId: workspace.id,
      workspaceName: workspace.name,
      generatedAt: workspace.updatedAt,
      folders: workspace.folders.map(({ id, name }) => ({ id, name })),
      files: files.map(({ id, folderId, path, name, hash }) => ({
        id,
        folderId,
        path,
        name,
        hash,
      })),
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

  function isDeleteSwipe(startX, endX, startY, endY) {
    const horizontal = startX - endX;
    const vertical = Math.abs(startY - endY);
    return horizontal >= 64 && vertical <= 36;
  }

  const api = {
    WORKSPACE_VERSION,
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
    removeEntry,
    isDeleteSwipe,
  };

  globalScope.ExcalidrawSyncCore = api;
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this);

