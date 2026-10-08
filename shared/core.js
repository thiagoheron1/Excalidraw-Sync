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
      parentId: null,
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
      folderSortMode: "manual",
      activeFileId: file.id,
      createdAt,
      updatedAt: createdAt,
    };
  }

  function normalizeWorkspace(input) {
    const source = input && typeof input === "object" ? input : createWorkspace();
    const folderSource = Array.isArray(source.folders) ? source.folders.filter(Boolean) : [];
    const folderIds = new Set(folderSource.map((folder) => folder.id));
    const folders = folderSource.map((folder) => ({
      ...folder,
      parentId: folder.parentId && folder.parentId !== folder.id && folderIds.has(folder.parentId)
        ? folder.parentId
        : null,
    }));
    const foldersById = new Map(folders.map((folder) => [folder.id, folder]));
    for (const folder of folders) {
      const seen = new Set([folder.id]);
      let parentId = folder.parentId;
      while (parentId) {
        if (seen.has(parentId)) {
          folder.parentId = null;
          break;
        }
        seen.add(parentId);
        parentId = foldersById.get(parentId)?.parentId || null;
      }
    }
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
      folderSortMode: ["manual", "alphabetical", "updated"].includes(source.folderSortMode)
        ? source.folderSortMode
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

  async function gitBlobSha(content) {
    const cryptoApi = globalScope.crypto
      || (typeof require === "function" ? require("node:crypto").webcrypto : null);
    if (!cryptoApi?.subtle) throw new Error("Web Crypto is unavailable.");
    const contentBytes = new TextEncoder().encode(String(content ?? ""));
    const header = new TextEncoder().encode(`blob ${contentBytes.byteLength}\0`);
    const joined = new Uint8Array(header.byteLength + contentBytes.byteLength);
    joined.set(header);
    joined.set(contentBytes, header.byteLength);
    const digest = await cryptoApi.subtle.digest("SHA-1", joined);
    return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
  }

  async function providerChangePlan(desiredFiles, remoteTreeInput, previousPaths = []) {
    const remoteTree = remoteTreeInput instanceof Map
      ? remoteTreeInput
      : new Map(Object.entries(remoteTreeInput || {}));
    const desiredWithShas = await Promise.all((desiredFiles || []).map(async (file) => ({
      file,
      sha: await gitBlobSha(file.content),
    })));
    const desiredPaths = new Set(desiredWithShas.map(({ file }) => file.path));
    return {
      changedFiles: desiredWithShas
        .filter(({ file, sha }) => remoteTree.get(file.path) !== sha)
        .map(({ file }) => file),
      removedPaths: [...new Set(previousPaths)]
        .filter((path) => !desiredPaths.has(path) && remoteTree.has(path)),
    };
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

  function buildProviderFiles(workspaceInput, rootDirectory = "Excalidraw", { includeFolderPlaceholders = false } = {}) {
    const workspace = normalizeWorkspace(workspaceInput);
    const usedPaths = new Set();
    const foldersById = new Map(workspace.folders.map((folder) => [folder.id, folder]));
    const folderPath = (folderId, visited = new Set()) => {
      const folder = foldersById.get(folderId);
      if (!folder || visited.has(folder.id)) return [];
      visited.add(folder.id);
      return [
        ...folderPath(folder.parentId, visited),
        slugify(folder.name, "untitled-folder"),
      ];
    };
    const requestedRoot = String(rootDirectory || "").trim();
    const hiddenRoot = requestedRoot.startsWith(".");
    const rootName = slugify(requestedRoot.replace(/^\.+/, ""), "excalidraw");
    const root = hiddenRoot ? `.${rootName}` : rootName;
    const liveFiles = workspace.files.map((file) => {
      const pathParts = folderPath(file.folderId);
      const directory = pathParts.length ? pathParts.join("/") : "unfiled";
      const filename = `${slugify(file.name)}.excalidraw`;
      const path = uniquePath(`${root}/${directory}/${filename}`, usedPaths);
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
    const files = [...liveFiles];
    const foldersWithChildren = new Set(workspace.folders
      .map((folder) => folder.parentId)
      .filter(Boolean));
    const foldersWithFiles = new Set(workspace.files.map((file) => file.folderId).filter(Boolean));
    const folderPlaceholders = includeFolderPlaceholders
      ? workspace.folders
        .filter((folder) => !foldersWithChildren.has(folder.id) && !foldersWithFiles.has(folder.id))
        .map((folder) => {
          const directory = folderPath(folder.id).join("/");
          const path = uniquePath(`${root}/${directory}/.gitkeep`, usedPaths);
          return {
            id: `folder-placeholder:${folder.id}`,
            folderId: folder.id,
            kind: "folder-placeholder",
            path,
            name: ".gitkeep",
            content: "",
            hash: hashString(""),
          };
        })
      : [];
    files.push(...folderPlaceholders);
    const indexPath = `${root}/.excalidraw-sync.json`;
    const index = {
      formatVersion: 2,
      workspaceId: workspace.id,
      workspaceName: workspace.name,
      generatedAt: workspace.updatedAt,
      activeFileId: workspace.activeFileId,
      sortMode: workspace.sortMode,
      folderSortMode: workspace.folderSortMode,
      folders: workspace.folders.map(({ id, parentId, name, createdAt, updatedAt }) => ({ id, parentId: parentId || null, name, createdAt, updatedAt })),
      files: liveFiles.map(({ id, folderId, path, name, hash }) => {
        const source = workspace.files.find((file) => file.id === id);
        return { id, folderId, path, name, hash, pinned: Boolean(source?.pinned), createdAt: source?.createdAt, updatedAt: source?.updatedAt };
      }),
      folderPlaceholders: folderPlaceholders.map(({ folderId, path }) => ({ folderId, path })),
      tombstones: workspace.trash.map((item) => ({
        kind: item.kind,
        id: item.entry?.id,
        deletedAt: item.deletedAt,
        restoredAt: item.restoredAt || null,
        restoredEntries: item.restoredEntries || [],
        entry: item.entry ? {
          id: item.entry.id,
          name: item.entry.name,
          folderId: item.entry.folderId || null,
          parentId: item.entry.parentId || null,
          createdAt: item.entry.createdAt,
          updatedAt: item.entry.updatedAt,
        } : null,
        folders: (item.folders || []).map(({ id, parentId, name, createdAt, updatedAt }) => ({ id, parentId: parentId || null, name, createdAt, updatedAt })),
        files: (item.files || []).map(({ id, folderId, name, pinned, hash, createdAt, updatedAt }) => ({ id, folderId: folderId || null, name, pinned, hash, createdAt, updatedAt })),
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
      parentId: folder.parentId || null,
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
      restoredAt: item.restoredAt || null,
      restoredEntries: Array.isArray(item.restoredEntries) ? item.restoredEntries : [],
      entry: { id: item.id, ...(item.entry || {}) },
      folders: Array.isArray(item.folders) ? item.folders : [],
      files: Array.isArray(item.files) ? item.files : [],
    }));
    return normalizeWorkspace({
      id: index.workspaceId,
      name: index.workspaceName,
      folders,
      files,
      trash,
      sortMode: index.sortMode,
      folderSortMode: index.folderSortMode,
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
      if (!existing) {
        tombstones.set(key, item);
      } else if (trashEventTimestamp(item) > trashEventTimestamp(existing)) {
        tombstones.set(key, mergeTrashRecords(item, existing));
      } else {
        tombstones.set(key, mergeTrashRecords(existing, item));
      }
    }
    for (const tombstone of tombstones.values()) {
      if (!isTrashItemActive(tombstone)) continue;
      const id = tombstone.entry.id;
      if (tombstone.kind === "folder") {
        const deletedFolderIds = descendantFolderIds([...folders.values()], id);
        const restoredFolderIds = restoredTrashIds(tombstone, "folder");
        const restoredFileIds = restoredTrashIds(tombstone, "file");
        for (const folderId of deletedFolderIds) {
          if (!restoredFolderIds.has(folderId)) folders.delete(folderId);
        }
        for (const [fileId, file] of files) {
          if (deletedFolderIds.has(file.folderId) && !restoredFileIds.has(fileId)) files.delete(fileId);
        }
      } else {
        files.delete(id);
      }
    }
    const remoteIsNewer = timestamp(remote.updatedAt) > timestamp(local.updatedAt);
    const preferredFolderIds = (remoteIsNewer ? remote : local).folders.map((folder) => folder.id);
    const orderedFolderIds = new Set(preferredFolderIds);
    const mergedFolders = [
      ...preferredFolderIds.map((id) => folders.get(id)).filter(Boolean),
      ...[...folders.values()].filter((folder) => !orderedFolderIds.has(folder.id)),
    ];
    const mergedFiles = [...files.values()];
    const preferredActiveId = files.has(local.activeFileId)
      ? local.activeFileId
      : files.has(remote.activeFileId) ? remote.activeFileId : mergedFiles[0]?.id || null;
    return normalizeWorkspace({
      ...local,
      id: remote.id || local.id,
      name: remote.name || local.name,
      folders: mergedFolders,
      files: mergedFiles,
      trash: [...tombstones.values()],
      activeFileId: preferredActiveId,
      sortMode: remoteIsNewer ? remote.sortMode : local.sortMode,
      folderSortMode: remoteIsNewer ? remote.folderSortMode : local.folderSortMode,
      updatedAt: new Date(Math.max(timestamp(local.updatedAt), timestamp(remote.updatedAt)) || Date.now()).toISOString(),
    });
  }

  function reconcileWorkspaces(localInput, remoteInput, strategy = "merge") {
    if (strategy === "pull") return normalizeWorkspace(remoteInput);
    if (strategy === "force-push") return normalizeWorkspace(localInput);
    return remoteInput ? mergeWorkspaces(localInput, remoteInput) : normalizeWorkspace(localInput);
  }

  function descendantFolderIds(folders, rootId) {
    const result = new Set([rootId]);
    let changed = true;
    while (changed) {
      changed = false;
      for (const folder of folders) {
        if (folder.parentId && result.has(folder.parentId) && !result.has(folder.id)) {
          result.add(folder.id);
          changed = true;
        }
      }
    }
    return result;
  }

  function removeEntry(workspaceInput, kind, id) {
    const workspace = normalizeWorkspace(workspaceInput);
    if (kind === "file") {
      workspace.files = workspace.files.filter((file) => file.id !== id);
    } else if (kind === "folder") {
      const folderIds = descendantFolderIds(workspace.folders, id);
      workspace.folders = workspace.folders.filter((folder) => !folderIds.has(folder.id));
      workspace.files = workspace.files.filter((file) => !folderIds.has(file.folderId));
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
      const folderIds = descendantFolderIds(workspace.folders, id);
      const folders = workspace.folders.filter((folder) => folderIds.has(folder.id));
      const files = workspace.files.filter((file) => folderIds.has(file.folderId));
      workspace.trash.push({ kind, deletedAt, entry, folders, files });
      workspace.folders = workspace.folders.filter((folder) => !folderIds.has(folder.id));
      workspace.files = workspace.files.filter((file) => !folderIds.has(file.folderId));
    } else {
      throw new Error("Unknown entry type.");
    }
    if (!workspace.files.some((file) => file.id === workspace.activeFileId)) {
      workspace.activeFileId = workspace.files[0]?.id || null;
    }
    workspace.updatedAt = deletedAt;
    return workspace;
  }

  function trashEventTimestamp(item) {
    return Math.max(
      timestamp(item?.deletedAt),
      timestamp(item?.restoredAt),
      ...(item?.restoredEntries || []).map((entry) => timestamp(entry.restoredAt)),
    );
  }

  function restoredTrashIds(item, kind) {
    return new Set((item?.restoredEntries || [])
      .filter((entry) => entry.kind === kind && timestamp(entry.restoredAt) > timestamp(item.deletedAt))
      .map((entry) => entry.id));
  }

  function mergeTrashRecords(primary, secondary) {
    const entryScore = (entry) => (entry?.name ? 1 : 0) + (entry?.scene ? 2 : 0);
    const richerEntry = entryScore(primary.entry) >= entryScore(secondary.entry)
      ? primary.entry
      : secondary.entry;
    const richerArray = (left, right) => (left?.length || 0) >= (right?.length || 0) ? (left || []) : (right || []);
    const shouldMergeRestores = timestamp(primary.deletedAt) === timestamp(secondary.deletedAt);
    const restoredEntries = new Map();
    for (const entry of [
      ...(shouldMergeRestores ? secondary.restoredEntries || [] : []),
      ...(primary.restoredEntries || []),
    ]) {
      const key = `${entry.kind}:${entry.id}`;
      const existing = restoredEntries.get(key);
      if (!existing || timestamp(entry.restoredAt) >= timestamp(existing.restoredAt)) {
        restoredEntries.set(key, {
          ...existing,
          ...entry,
          structural: existing ? Boolean(existing.structural && entry.structural) : Boolean(entry.structural),
        });
      }
    }
    return {
      ...secondary,
      ...primary,
      entry: richerEntry,
      folders: richerArray(primary.folders, secondary.folders),
      files: richerArray(primary.files, secondary.files),
      restoredEntries: [...restoredEntries.values()],
    };
  }

  function isTrashItemActive(item) {
    return Boolean(item?.entry?.id) && timestamp(item.deletedAt) > timestamp(item.restoredAt);
  }

  function activeTrashItems(workspaceInput) {
    return normalizeWorkspace(workspaceInput).trash
      .filter(isTrashItemActive)
      .sort((left, right) => timestamp(right.deletedAt) - timestamp(left.deletedAt));
  }

  function trashChildRestoration(item, kind, id) {
    return (item?.restoredEntries || []).find((entry) =>
      entry.kind === kind
      && entry.id === id
      && timestamp(entry.restoredAt) > timestamp(item.deletedAt),
    ) || null;
  }

  function markTrashChildRestored(item, kind, id, restoredAt, structural = false) {
    item.restoredEntries ||= [];
    const existing = item.restoredEntries.find((entry) => entry.kind === kind && entry.id === id);
    if (existing) {
      if (timestamp(restoredAt) >= timestamp(existing.restoredAt)) existing.restoredAt = restoredAt;
      if (!structural) existing.structural = false;
    } else {
      item.restoredEntries.push({ kind, id, restoredAt, structural });
    }
  }

  function activeFolderTrash(workspace, trashFolderId) {
    return workspace.trash
      .filter((item) => item.kind === "folder" && item.entry?.id === trashFolderId && isTrashItemActive(item))
      .sort((left, right) => timestamp(right.deletedAt) - timestamp(left.deletedAt))[0];
  }

  function restoreFolderPath(workspace, item, folderIds, explicitFolderIds, restoredAt) {
    const sourceFolders = new Map((item.folders || []).map((folder) => [folder.id, folder]));
    const availableIds = new Set([...workspace.folders.map((folder) => folder.id), ...folderIds]);
    workspace.folders = workspace.folders.filter((folder) => !folderIds.has(folder.id));
    for (const source of item.folders || []) {
      if (!folderIds.has(source.id)) continue;
      workspace.folders.push({
        ...source,
        parentId: availableIds.has(source.parentId) ? source.parentId : null,
        updatedAt: restoredAt,
      });
      markTrashChildRestored(item, "folder", source.id, restoredAt, !explicitFolderIds.has(source.id));
    }
    return sourceFolders;
  }

  function folderPathIds(folders, folderId) {
    const byId = new Map(folders.map((folder) => [folder.id, folder]));
    const ids = new Set();
    let current = byId.get(folderId);
    while (current && !ids.has(current.id)) {
      ids.add(current.id);
      current = byId.get(current.parentId);
    }
    return ids;
  }

  function restoreTrashedFile(workspaceInput, trashFolderId, fileId, restoredAt = nowIso()) {
    const workspace = normalizeWorkspace(workspaceInput);
    const item = activeFolderTrash(workspace, trashFolderId);
    const file = item?.files?.find((candidate) => candidate.id === fileId);
    if (!item || !file?.scene) throw new Error("This file backup is not available on this device.");
    const ancestorIds = folderPathIds(item.folders || [], file.folderId);
    restoreFolderPath(workspace, item, ancestorIds, new Set(), restoredAt);
    workspace.files = workspace.files.filter((candidate) => candidate.id !== file.id);
    workspace.files.push({ ...file, updatedAt: restoredAt });
    markTrashChildRestored(item, "file", file.id, restoredAt, false);
    workspace.activeFileId ||= file.id;
    workspace.updatedAt = restoredAt;
    return normalizeWorkspace(workspace);
  }

  function restoreTrashedFolder(workspaceInput, trashFolderId, folderId, restoredAt = nowIso()) {
    if (trashFolderId === folderId) return restoreTrashEntry(workspaceInput, "folder", trashFolderId, restoredAt);
    const workspace = normalizeWorkspace(workspaceInput);
    const item = activeFolderTrash(workspace, trashFolderId);
    if (!item?.folders?.some((folder) => folder.id === folderId)) {
      throw new Error("This folder backup is not available on this device.");
    }
    const subtreeIds = descendantFolderIds(item.folders, folderId);
    const ancestorIds = folderPathIds(item.folders, folderId);
    const folderIds = new Set([...subtreeIds, ...ancestorIds]);
    restoreFolderPath(workspace, item, folderIds, subtreeIds, restoredAt);
    const recoveredFiles = (item.files || []).filter((file) => subtreeIds.has(file.folderId) && file.scene);
    const recoveredFileIds = new Set(recoveredFiles.map((file) => file.id));
    workspace.files = workspace.files.filter((file) => !recoveredFileIds.has(file.id));
    for (const file of recoveredFiles) {
      workspace.files.push({ ...file, updatedAt: restoredAt });
      markTrashChildRestored(item, "file", file.id, restoredAt, false);
    }
    workspace.activeFileId ||= workspace.files[0]?.id || null;
    workspace.updatedAt = restoredAt;
    return normalizeWorkspace(workspace);
  }

  function restoreTrashEntry(workspaceInput, kind, id, restoredAt = nowIso()) {
    const workspace = normalizeWorkspace(workspaceInput);
    const item = workspace.trash
      .filter((candidate) => candidate.kind === kind && candidate.entry?.id === id && isTrashItemActive(candidate))
      .sort((left, right) => timestamp(right.deletedAt) - timestamp(left.deletedAt))[0];
    if (!item) return workspace;

    if (kind === "file") {
      if (!item.entry?.scene) throw new Error("This file backup is not available on this device.");
      let folderId = item.entry.folderId;
      if (!workspace.folders.some((folder) => folder.id === folderId)) {
        let destination = workspace.folders[0];
        if (!destination) {
          destination = {
            id: makeId("folder"),
            parentId: null,
            name: DEFAULT_FOLDER_NAME,
            createdAt: restoredAt,
            updatedAt: restoredAt,
          };
          workspace.folders.push(destination);
        }
        folderId = destination.id;
      }
      workspace.files = workspace.files.filter((file) => file.id !== id);
      workspace.files.push({ ...item.entry, folderId, updatedAt: restoredAt });
    } else if (kind === "folder") {
      const recoveredFolders = item.folders?.length ? item.folders : item.entry?.name ? [item.entry] : [];
      if (!recoveredFolders.length) throw new Error("This folder backup is not available on this device.");
      const recoveredFolderIds = new Set(recoveredFolders.map((folder) => folder.id));
      const availableFolderIds = new Set([
        ...workspace.folders.map((folder) => folder.id),
        ...recoveredFolderIds,
      ]);
      workspace.folders = workspace.folders.filter((folder) => !recoveredFolderIds.has(folder.id));
      workspace.folders.push(...recoveredFolders.map((folder) => ({
        ...folder,
        parentId: availableFolderIds.has(folder.parentId) ? folder.parentId : null,
        updatedAt: restoredAt,
      })));
      const recoveredFiles = (item.files || []).filter((file) => file?.id && file.scene);
      const recoveredFileIds = new Set(recoveredFiles.map((file) => file.id));
      workspace.files = workspace.files.filter((file) => !recoveredFileIds.has(file.id));
      workspace.files.push(...recoveredFiles.map((file) => ({ ...file, updatedAt: restoredAt })));
    } else {
      throw new Error("Unknown entry type.");
    }

    item.restoredAt = restoredAt;
    workspace.activeFileId ||= workspace.files[0]?.id || null;
    workspace.updatedAt = restoredAt;
    return normalizeWorkspace(workspace);
  }

  function purgeExpiredTrash(workspaceInput, now = new Date()) {
    const workspace = normalizeWorkspace(workspaceInput);
    const nowTime = now instanceof Date ? now.getTime() : new Date(now).getTime();
    workspace.trash = workspace.trash.filter((item) => {
      const eventTime = trashEventTimestamp(item);
      return eventTime > 0 && nowTime - eventTime <= TRASH_RETENTION_MS;
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

  function sortedFolders(folders, mode = "manual") {
    const result = [...folders];
    if (mode === "alphabetical") {
      result.sort((left, right) => String(left.name).localeCompare(String(right.name), undefined, { sensitivity: "base" }));
    } else if (mode === "updated") {
      result.sort((left, right) => new Date(right.updatedAt || 0) - new Date(left.updatedAt || 0));
    }
    return result;
  }

  function moveFolder(workspaceInput, folderId, targetFolderId, placement = "before") {
    const workspace = normalizeWorkspace(workspaceInput);
    const sourceIndex = workspace.folders.findIndex((folder) => folder.id === folderId);
    if (sourceIndex < 0 || folderId === targetFolderId) return workspace;
    const [folder] = workspace.folders.splice(sourceIndex, 1);
    const targetIndex = workspace.folders.findIndex((candidate) => candidate.id === targetFolderId);
    if (targetIndex < 0) {
      workspace.folders.push(folder);
    } else {
      workspace.folders.splice(targetIndex + (placement === "after" ? 1 : 0), 0, folder);
    }
    workspace.folderSortMode = "manual";
    workspace.updatedAt = nowIso();
    return workspace;
  }

  function moveFolderToParent(workspaceInput, folderId, parentId = null) {
    const workspace = normalizeWorkspace(workspaceInput);
    const folder = workspace.folders.find((candidate) => candidate.id === folderId);
    if (!folder || folder.parentId === parentId || parentId === folderId) return workspace;
    if (parentId && descendantFolderIds(workspace.folders, folderId).has(parentId)) return workspace;
    if (parentId && !workspace.folders.some((candidate) => candidate.id === parentId)) return workspace;
    folder.parentId = parentId || null;
    folder.updatedAt = nowIso();
    workspace.updatedAt = folder.updatedAt;
    return workspace;
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

  async function retryConflict(operation, { attempts = 3, delayMs = 0, jitterMs = 0 } = {}) {
    let lastError;
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      try {
        return await operation(attempt);
      } catch (error) {
        lastError = error;
        if (error?.status !== 409 || attempt === attempts - 1) throw error;
        if (delayMs > 0 || jitterMs > 0) {
          const retryDelay = delayMs * (attempt + 1) + Math.random() * jitterMs;
          await new Promise((resolve) => setTimeout(resolve, retryDelay));
        }
      }
    }
    throw lastError;
  }

  function hasActiveProviderError(provider = {}) {
    if (!provider.lastError) return false;
    if (!provider.lastErrorAt) return !provider.lastSyncAt;
    return timestamp(provider.lastErrorAt) > timestamp(provider.lastSyncAt);
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
    gitBlobSha,
    providerChangePlan,
    hashScene,
    buildProviderFiles,
    buildLocalVault,
    isStarterWorkspace,
    workspaceFromProviderIndex,
    mergeWorkspaces,
    reconcileWorkspaces,
    removeEntry,
    trashEntry,
    activeTrashItems,
    restoreTrashEntry,
    restoreTrashedFile,
    restoreTrashedFolder,
    trashChildRestoration,
    purgeExpiredTrash,
    sortedFiles,
    sortedFolders,
    moveFile,
    moveFolder,
    moveFolderToParent,
    isDeleteSwipe,
    retryConflict,
    hasActiveProviderError,
  };

  globalScope.ExcalidrawSyncCore = api;
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this);
