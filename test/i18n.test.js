"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { JSDOM } = require("jsdom");
const i18n = require("../shared/i18n.js");

const root = path.join(__dirname, "..");
const content = fs.readFileSync(path.join(root, "content.js"), "utf8");
const manifest = JSON.parse(fs.readFileSync(path.join(root, "manifest.json"), "utf8"));

test("browser locale detection supports English, Brazilian Portuguese, Spanish, French, and German", () => {
  assert.equal(i18n.normalizeLanguage("en-US"), "en");
  assert.equal(i18n.normalizeLanguage("pt-BR"), "pt-BR");
  assert.equal(i18n.normalizeLanguage("pt-PT"), "pt-BR");
  assert.equal(i18n.normalizeLanguage("es-AR"), "es");
  assert.equal(i18n.normalizeLanguage("fr-FR"), "fr");
  assert.equal(i18n.normalizeLanguage("de-DE"), "de");
  assert.equal(i18n.normalizeLanguage("ja-JP"), "en");
});

test("the sidebar can persistently override the browser language", () => {
  assert.match(content, /const LANGUAGE_KEY = "excalidrawSync\.language"/);
  assert.match(content, /getUILanguage/);
  assert.match(content, /select name="language"/);
  assert.match(content, /storageSet\(LANGUAGE_KEY, state\.language\)/);
  assert.match(content, /localizeUi\(elements\.body\)/);
});

test("rendered controls translate without changing user-created names", () => {
  const dom = new JSDOM('<main><button title="New file">New file</button><strong data-i18n-skip>New file</strong></main>');
  i18n.localizeTree(dom.window.document.querySelector("main"), "pt-BR");
  assert.equal(dom.window.document.querySelector("button").textContent, "Novo arquivo");
  assert.equal(dom.window.document.querySelector("button").title, "Novo arquivo");
  assert.equal(dom.window.document.querySelector("strong").textContent, "New file");
});

test("GitHub pull, push, and force-push controls are localized", () => {
  assert.equal(i18n.translate("Pull", "pt-BR"), "Baixar");
  assert.equal(i18n.translate("Push", "es"), "Enviar");
  assert.equal(i18n.translate("Force push", "fr"), "Forcer l’envoi");
  assert.equal(i18n.translate("Pull and replace local", "de"), "Abrufen und lokal ersetzen");
  assert.equal(i18n.translate("Pull from GitHub", "pt-BR"), "Baixar do GitHub");
  assert.equal(i18n.translate("Push to GitHub", "de"), "An GitHub senden");
});

test("GitHub push confirmation and squash controls are localized", () => {
  for (const language of ["pt-BR", "es", "fr", "de"]) {
    assert.notEqual(i18n.translate("Push and overwrite", language), "Push and overwrite");
    assert.notEqual(i18n.translate("Squash default branch history", language), "Squash default branch history");
    assert.notEqual(i18n.translate('Type "squash" to confirm', language), 'Type "squash" to confirm');
  }
});

test("GitHub conflict choices are localized", () => {
  for (const language of ["pt-BR", "es", "fr", "de"]) {
    assert.notEqual(i18n.translate("Resolve GitHub sync conflict", language), "Resolve GitHub sync conflict");
    assert.notEqual(i18n.translate("Use GitHub's conflicting versions", language), "Use GitHub's conflicting versions");
    assert.notEqual(i18n.translate("Keep this device's conflicting versions", language), "Keep this device's conflicting versions");
  }
});

test("every current sidebar section and option has a translation in every supported language", () => {
  const sidebarCopy = [
    "Storage",
    "Your drawings stay local first, with GitHub when you choose",
    "Local protection is active",
    "View notification history",
    "5 seconds",
    "15 seconds",
    "30 seconds",
    "1 minute",
    "5 minutes",
    "After 1 minute",
    "After 5 minutes",
    "After 10 minutes",
    "After 30 minutes",
    "Drawings are synchronized to",
    "Deleted files and folders stay hidden from your library while their backup remains recoverable for 30 days.",
    "Public client ID only. Device Flow is required; never enter a client secret.",
    "A private repository is created on first sync.",
    "Pull replaces this browser’s local library with GitHub. Push safely merges GitHub first. Force push makes this browser’s local library authoritative and may overwrite remote ExcaliSync files.",
    "On",
    "Off",
    "Open now",
    "File",
    "Restore file",
    "Restore folder",
    "On another machine, use the same GitHub account, Client ID, repository name, and root folder. The first sync downloads and merges the existing library.",
    "Compare",
    "This device",
    "Version",
    "Commit",
    "Known commit",
    "GitHub HEAD",
    "Commit time",
    "Drawing updated",
    "Preview is fitted to show the complete drawing.",
    "Deleted or unavailable",
    "Blank drawing",
    "Available",
    "Deleted",
    "Not available",
    "Drawing preview",
    "Latest on GitHub",
    "Review version",
    "Previewing",
    "versions",
    "Select a version to preview it on the canvas or restore it as the current drawing.",
    "Historical preview",
    "This preview is read-only. Your saved file has not changed.",
    "Restoring creates a new current version. Your other files and GitHub history stay unchanged.",
  ];

  for (const language of ["pt-BR", "es", "fr", "de"]) {
    for (const text of sidebarCopy) {
      assert.equal(i18n.hasTranslation(text, language), true, `${language} is missing: ${text}`);
    }
  }
});

test("dynamic sidebar labels translate while preserving file names, dates, and commit IDs", () => {
  assert.equal(i18n.translate("Saved ontem", "pt-BR"), "Salvo ontem");
  assert.equal(i18n.translate("Last sync vor 2 Minuten", "de"), "Letzte Synchronisierung vor 2 Minuten");
  assert.equal(i18n.translate("Open Architecture", "fr"), "Ouvrir Architecture");
  assert.equal(i18n.translate("File actions for AWS", "es"), "Acciones del archivo AWS");
  assert.equal(i18n.translate("GitHub connected as thiago", "pt-BR"), "GitHub conectado como thiago");
});

test("changing language refreshes persistent sidebar chrome as well as the rendered view", () => {
  assert.match(content, /elements\.footerStatus\.textContent = t\(state\.status\)/);
  assert.match(content, /elements\.launcher\.setAttribute\("aria-label", t\("Open ExcaliSync\. Drag to move\."\)\)/);
  assert.match(content, /elements\.panel\.setAttribute\("aria-label", t\("Excalidraw Sync sidebar"\)\)/);
});

test("manifest metadata has locale catalogs for every supported language", () => {
  assert.equal(manifest.default_locale, "en");
  assert.ok(manifest.content_scripts[0].js.indexOf("shared/i18n.js") < manifest.content_scripts[0].js.indexOf("content.js"));
  for (const locale of ["en", "pt_BR", "es", "fr", "de"]) {
    const messages = JSON.parse(fs.readFileSync(path.join(root, "_locales", locale, "messages.json"), "utf8"));
    assert.ok(messages.extensionName.message);
    assert.ok(messages.extensionDescription.message);
    assert.ok(messages.actionTitle.message);
  }
});
