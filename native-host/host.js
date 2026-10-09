#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");

const DAY_MS = 24 * 60 * 60 * 1000;
const VAULT_ROOT = path.join(os.homedir(), ".excalidraw-sync");
const TRASH_ROOT = path.join(VAULT_ROOT, ".trash");
const LOG_ROOT = path.join(VAULT_ROOT, ".logs");
const INDEX_PATH = path.join(VAULT_ROOT, ".excalidraw-sync.json");

function safeSegment(value, fallback = "untitled") {
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

function ensureRoots() {
  fs.mkdirSync(TRASH_ROOT, { recursive: true, mode: 0o700 });
  fs.mkdirSync(LOG_ROOT, { recursive: true, mode: 0o700 });
}

function purgeExpiredEntries(directory, retentionMs, now = Date.now()) {
  if (!fs.existsSync(directory)) return;
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const entryPath = path.join(directory, entry.name);
    const stat = fs.statSync(entryPath);
    if (now - stat.mtimeMs > retentionMs) {
      fs.rmSync(entryPath, { recursive: true, force: true });
    } else if (entry.isDirectory()) {
      purgeExpiredEntries(entryPath, retentionMs, now);
    }
  }
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true, mode: 0o700 });
  const temporary = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(temporary, filePath);
}

function scenePath(folderName, fileName) {
  return path.join(VAULT_ROOT, safeSegment(folderName, "unfiled"), `${safeSegment(fileName)}.excalidraw`);
}

function trashPath(item) {
  const date = String(item.deletedAt || new Date().toISOString()).slice(0, 10);
  return path.join(TRASH_ROOT, date, `${safeSegment(item.entry?.name)}-${safeSegment(item.entry?.id, "entry")}`);
}

function readTrashBackup({ kind, id, name, fileName }, root = TRASH_ROOT) {
  if (!id || !fs.existsSync(root)) return null;
  const idSuffix = `-${safeSegment(id, "entry")}`;
  for (const dateEntry of fs.readdirSync(root, { withFileTypes: true })) {
    if (!dateEntry.isDirectory()) continue;
    const dateRoot = path.join(root, dateEntry.name);
    for (const entry of fs.readdirSync(dateRoot, { withFileTypes: true })) {
      if (kind === "file" && entry.isFile() && entry.name.endsWith(`${idSuffix}.excalidraw`)) {
        return { scene: JSON.parse(fs.readFileSync(path.join(dateRoot, entry.name), "utf8")) };
      }
      if (kind === "folder" && entry.isDirectory() && entry.name.endsWith(idSuffix)) {
        const folderRoot = path.join(dateRoot, entry.name);
        if (!fileName) return { found: true };
        const scenePath = path.join(folderRoot, `${safeSegment(fileName)}.excalidraw`);
        if (fs.existsSync(scenePath)) {
          return { scene: JSON.parse(fs.readFileSync(scenePath, "utf8")) };
        }
      }
    }
  }
  return null;
}

function syncWorkspace(workspace) {
  ensureRoots();
  purgeExpiredEntries(TRASH_ROOT, 30 * DAY_MS);
  purgeExpiredEntries(LOG_ROOT, 7 * DAY_MS);
  const folders = new Map((workspace.folders || []).map((folder) => [folder.id, folder.name]));
  const files = [];
  let previousFiles = [];
  try {
    previousFiles = JSON.parse(fs.readFileSync(INDEX_PATH, "utf8")).files || [];
  } catch (_error) {
    // The first sync has no index yet.
  }
  for (const file of workspace.files || []) {
    const filePath = scenePath(folders.get(file.folderId), file.name);
    writeJson(filePath, file.scene);
    files.push({ id: file.id, folderId: file.folderId || null, name: file.name, path: path.relative(VAULT_ROOT, filePath), updatedAt: file.updatedAt });
  }
  for (const item of workspace.trash || []) {
    if (item.restoredAt) continue;
    const base = trashPath(item);
    if (item.kind === "file") {
      writeJson(`${base}.excalidraw`, item.entry.scene);
    } else {
      writeJson(path.join(base, ".folder.json"), { folder: item.entry, deletedAt: item.deletedAt });
      for (const file of item.files || []) {
        writeJson(path.join(base, `${safeSegment(file.name)}.excalidraw`), file.scene);
      }
    }
    const deletedTime = new Date(item.deletedAt).getTime();
    if (Number.isFinite(deletedTime)) {
      const destination = item.kind === "file" ? `${base}.excalidraw` : base;
      fs.utimesSync(destination, new Date(deletedTime), new Date(deletedTime));
    }
  }
  const currentPaths = new Set(files.map((file) => file.path));
  for (const previous of previousFiles) {
    if (currentPaths.has(previous.path) || !previous.path) continue;
    const stalePath = path.resolve(VAULT_ROOT, previous.path);
    if (stalePath.startsWith(`${VAULT_ROOT}${path.sep}`) && fs.existsSync(stalePath)) {
      fs.rmSync(stalePath, { force: true });
    }
  }
  writeJson(INDEX_PATH, {
    formatVersion: 2,
    workspaceId: workspace.id,
    workspaceName: workspace.name,
    updatedAt: workspace.updatedAt,
    folders: workspace.folders || [],
    files,
  });
  return { root: VAULT_ROOT, files: files.length };
}

function sanitizeText(value, maximum = 500) {
  return String(value || "")
    .replace(/(Bearer|token|access_token|refresh_token|client_secret)\s*[:=]?\s*[^\s,}]+/gi, "$1 [hidden]")
    .slice(0, maximum);
}

function writeErrorLog(error) {
  ensureRoots();
  purgeExpiredEntries(LOG_ROOT, 7 * DAY_MS);
  const timestamp = new Date().toISOString();
  const filename = `${timestamp.replace(/[:.]/g, "-")}-${safeSegment(error.context, "extension")}.json`;
  writeJson(path.join(LOG_ROOT, filename), {
    timestamp,
    context: sanitizeText(error.context, 80),
    message: sanitizeText(error.message),
    extensionVersion: sanitizeText(error.extensionVersion, 30),
  });
  return { written: true };
}

function readWorkspace() {
  try {
    const index = JSON.parse(fs.readFileSync(INDEX_PATH, "utf8"));
    const files = (index.files || []).map((file) => ({
      id: file.id,
      folderId: file.folderId || null,
      name: file.name,
      pinned: false,
      scene: JSON.parse(fs.readFileSync(path.join(VAULT_ROOT, file.path), "utf8")),
      hash: "",
      createdAt: file.updatedAt || index.updatedAt,
      updatedAt: file.updatedAt || index.updatedAt,
    }));
    if (!files.length) return null;
    return {
      version: 2,
      id: index.workspaceId,
      name: index.workspaceName,
      folders: index.folders || [],
      files,
      trash: [],
      sortMode: "manual",
      activeFileId: files[0].id,
      createdAt: index.updatedAt,
      updatedAt: index.updatedAt,
    };
  } catch (_error) {
    return null;
  }
}

function handleMessage(message) {
  if (message?.type === "status") {
    ensureRoots();
    purgeExpiredEntries(TRASH_ROOT, 30 * DAY_MS);
    purgeExpiredEntries(LOG_ROOT, 7 * DAY_MS);
    return { root: VAULT_ROOT, available: true, workspace: readWorkspace() };
  }
  if (message?.type === "syncWorkspace") return syncWorkspace(message.workspace || {});
  if (message?.type === "readTrashBackup") return readTrashBackup(message);
  if (message?.type === "writeErrorLog") return writeErrorLog(message.error || {});
  if (message?.type === "openVault") {
    ensureRoots();
    spawn(process.platform === "darwin" ? "open" : "xdg-open", [VAULT_ROOT], { detached: true, stdio: "ignore" }).unref();
    return { root: VAULT_ROOT, opened: true };
  }
  if (message?.type === "clearVault") {
    fs.rmSync(VAULT_ROOT, { recursive: true, force: true });
    ensureRoots();
    return { root: VAULT_ROOT, cleared: true };
  }
  throw new Error("Unsupported native-host request.");
}

function sendNativeMessage(value) {
  const body = Buffer.from(JSON.stringify(value));
  const header = Buffer.alloc(4);
  header.writeUInt32LE(body.length, 0);
  process.stdout.write(header);
  process.stdout.write(body);
}

function runNativeHost() {
  let pending = Buffer.alloc(0);
  process.stdin.on("data", (chunk) => {
    pending = Buffer.concat([pending, chunk]);
    while (pending.length >= 4) {
      const length = pending.readUInt32LE(0);
      if (pending.length < length + 4) return;
      const payload = pending.subarray(4, length + 4);
      pending = pending.subarray(length + 4);
      try {
        sendNativeMessage({ ok: true, data: handleMessage(JSON.parse(payload.toString("utf8"))) });
      } catch (error) {
        sendNativeMessage({ ok: false, error: sanitizeText(error.message) });
      }
    }
  });
}

if (require.main === module) runNativeHost();

module.exports = { DAY_MS, VAULT_ROOT, purgeExpiredEntries, readTrashBackup, syncWorkspace, writeErrorLog, readWorkspace, handleMessage };
