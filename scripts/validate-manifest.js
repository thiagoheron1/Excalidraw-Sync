"use strict";

const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const manifest = JSON.parse(fs.readFileSync(path.join(root, "manifest.json"), "utf8"));
const requiredFiles = [
  manifest.background.service_worker,
  ...manifest.content_scripts.flatMap((entry) => entry.js || []),
  ...Object.values(manifest.icons || {}),
];

for (const relativePath of requiredFiles) {
  if (!fs.existsSync(path.join(root, relativePath))) {
    throw new Error(`Manifest references a missing file: ${relativePath}`);
  }
}

if (manifest.manifest_version !== 3) {
  throw new Error("Excalidraw Sync must use Manifest V3.");
}

console.log(`Manifest ${manifest.version} is valid and references ${requiredFiles.length} files.`);

