"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const root = path.resolve(__dirname, "..");
const dist = path.join(root, "dist");
const sourceFiles = ["background.js", "content.js", "LICENSE", "README.md"];
const sourceDirectories = ["shared", "icons"];

function copyTarget(target, manifestTransform = (value) => value) {
  const output = path.join(dist, target);
  fs.rmSync(output, { recursive: true, force: true });
  fs.mkdirSync(output, { recursive: true });
  for (const filename of sourceFiles) {
    fs.copyFileSync(path.join(root, filename), path.join(output, filename));
  }
  for (const directory of sourceDirectories) {
    fs.cpSync(path.join(root, directory), path.join(output, directory), { recursive: true });
  }
  const manifest = manifestTransform(JSON.parse(fs.readFileSync(path.join(root, "manifest.json"), "utf8")));
  fs.writeFileSync(path.join(output, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  return output;
}

fs.mkdirSync(dist, { recursive: true });
const chromeOutput = copyTarget("chrome", (manifest) => {
  delete manifest.browser_specific_settings;
  return manifest;
});
const firefoxOutput = copyTarget("firefox", (manifest) => {
  manifest.background = { scripts: ["background.js"] };
  return manifest;
});

for (const [name, output] of [["chrome", chromeOutput], ["firefox", firefoxOutput]]) {
  const archive = path.join(dist, `excalidraw-sync-${name}.zip`);
  fs.rmSync(archive, { force: true });
  const result = spawnSync("zip", ["-qr", archive, "."], { cwd: output, stdio: "inherit" });
  if (result.status !== 0) {
    throw new Error(`Could not create ${name} archive.`);
  }
}

console.log("Built Chrome/Edge/Opera and Firefox packages in dist/.");

