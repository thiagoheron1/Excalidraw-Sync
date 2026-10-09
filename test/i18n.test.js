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
