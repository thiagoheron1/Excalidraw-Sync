"use strict";

const path = require("node:path");
const { spawnSync } = require("node:child_process");

const root = path.resolve(__dirname, "..");
const result = spawnSync(
  "xcrun",
  [
    "safari-web-extension-converter",
    path.join(root, "dist", "chrome"),
    "--project-location",
    path.join(root, "dist", "safari"),
    "--app-name",
    "Excalidraw Sync",
    "--bundle-identifier",
    "com.thiagoheron.excalidraw-sync",
    "--swift",
    "--copy-resources",
    "--no-open",
    "--no-prompt",
    "--force",
  ],
  { stdio: "inherit" },
);

if (result.error?.code === "ENOENT") {
  throw new Error("Xcode is required to create the Safari project.");
}
if (result.status !== 0) {
  throw new Error("Safari Web Extension conversion failed.");
}

console.log("Built the Safari Xcode project in dist/safari/.");

