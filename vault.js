"use strict";

/* global ExcalidrawSyncI18n */

const extensionApi = globalThis.browser || globalThis.chrome;
const LOCAL_VAULT_KEY = "excalidrawSync.localVault";
const LANGUAGE_KEY = "excalidrawSync.language";
const tree = document.querySelector("#tree");
let language = ExcalidrawSyncI18n.normalizeLanguage(extensionApi.i18n?.getUILanguage?.() || navigator.language);

function t(text) {
  return ExcalidrawSyncI18n.translate(text, language);
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function downloadFile(file) {
  const blob = new Blob([file.content], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = file.path.split("/").at(-1) || "drawing.excalidraw";
  anchor.click();
  URL.revokeObjectURL(url);
}

async function loadVault() {
  const result = await extensionApi.storage.local.get(LOCAL_VAULT_KEY);
  const vault = result?.[LOCAL_VAULT_KEY];
  const files = (vault?.files || []).filter((file) => file.id !== "workspace-index");
  if (!files.length) {
    tree.innerHTML = `<div class="empty">${escapeHtml(t("No local documents have been saved yet."))}</div>`;
    return;
  }
  const folders = new Map();
  for (const file of files) {
    const parts = file.path.split("/");
    const folderName = parts.at(-2) || "unfiled";
    if (!folders.has(folderName)) folders.set(folderName, []);
    folders.get(folderName).push(file);
  }
  tree.innerHTML = [...folders.entries()].map(([folder, folderFiles], folderIndex) => `
    <section class="folder">
      <h2>📁 ${escapeHtml(folder)}</h2>
      <div class="files">${folderFiles.map((file, fileIndex) => `
        <div class="file">
          <div><strong>${escapeHtml(file.name)}</strong><small>${escapeHtml(file.path)}</small></div>
          <button type="button" data-folder="${folderIndex}" data-file="${fileIndex}">${escapeHtml(t("Download"))}</button>
        </div>`).join("")}</div>
    </section>`).join("");
  const folderEntries = [...folders.values()];
  for (const button of tree.querySelectorAll("button[data-file]")) {
    button.addEventListener("click", () => downloadFile(folderEntries[Number(button.dataset.folder)][Number(button.dataset.file)]));
  }
}

async function initializeVault() {
  const result = await extensionApi.storage.local.get(LANGUAGE_KEY);
  language = ExcalidrawSyncI18n.normalizeLanguage(result?.[LANGUAGE_KEY] || language);
  document.documentElement.lang = language;
  ExcalidrawSyncI18n.localizeTree(document.body, language);
  document.querySelector("#refresh").addEventListener("click", () => void loadVault());
  await loadVault();
}

void initializeVault();
