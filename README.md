# Excalidraw Sync

Excalidraw Sync adds a file-and-folder sidebar to [Excalidraw](https://excalidraw.com/). Drawings stay available locally and can be synchronized automatically to a GitHub repository and/or a Google Drive folder.

## What works

- Local-first `.excalidraw` files with embedded image preservation.
- Folders, search, pinned files, rename/move, multi-file import, and one-click switching.
- The current file is saved before another file opens.
- Background autosave when Excalidraw's native scene changes.
- GitHub Device Flow sign-in, automatic repository creation, private/public visibility, folder mirroring, and change-only commits.
- Google Drive OAuth, folder mirroring, private/link-shared visibility, and change-only uploads.
- Touch swipe-left deletion requests plus visible keyboard/desktop delete buttons. Both paths require confirmation.
- Manifest V3 packages for Chrome, Edge, Opera, and Firefox; Safari conversion instructions are below.

Cloud synchronization is intentionally outbound in this first version: local changes are uploaded automatically, while edits made directly to remote `.excalidraw` files are not pulled back or merged. This avoids silently overwriting the currently open canvas.

| Browser | Local files/folders | GitHub sync | Google Drive sync |
| --- | --- | --- | --- |
| Chrome, Edge, Opera | Yes | Yes | Yes |
| Firefox | Yes | Yes | Yes, after registering its browser-specific OAuth redirect |
| Safari | Yes | Yes | Not yet; Safari does not expose the WebExtensions `identity` API used by the Google flow |

## Install locally

```bash
npm test
npm run check
npm run build
```

Chrome, Edge, or Opera:

1. Open the browser's extensions page.
2. Enable developer mode.
3. Choose **Load unpacked** and select `dist/chrome`.
4. Open `https://excalidraw.com/` and click the purple folder button.

Firefox:

1. Open `about:debugging#/runtime/this-firefox`.
2. Choose **Load Temporary Add-on**.
3. Select `dist/firefox/manifest.json`.

## GitHub setup

1. In GitHub, create an OAuth App under **Settings → Developer settings → OAuth Apps**.
2. Use any valid homepage URL and callback URL, then enable **Device Flow**.
3. Copy only the client ID into **Manage sync → GitHub**. Never put a client secret in the extension.
4. Choose a repository name and visibility, connect, and approve the displayed device code.

The repository is created during the first sync. The extension uses the GitHub Contents API and commits only files whose content changed. Remote removal is restricted to paths that were listed in the extension's previous sync index.

## Google Drive setup

1. Create a Google Cloud project and enable the Google Drive API.
2. Configure the OAuth consent screen.
3. Create an OAuth client appropriate for the target extension/browser and register the redirect URL returned by that browser's extension identity API.
4. Paste the client ID into **Manage sync → Google Drive** and connect.

The requested `drive.file` scope lets the extension manage only its own Drive files. The root folder stays private by default. Selecting **Anyone with the link** is an explicit public-sharing action.

OAuth redirect handling differs by browser and store identity. For a production release, create a stable store ID and provider client for each browser package, then verify Google OAuth on each target browser before publishing.

## Safari

Safari Web Extensions are distributed through an Xcode app target. On macOS with Xcode installed:

```bash
npm run build:safari
```

Open the generated Xcode project, choose your signing team and bundle identifier, then run the containing app. Provider OAuth credentials and redirects must match the Safari bundle you sign.

## Architecture

- `content.js` injects an isolated Shadow DOM sidebar and reads/writes Excalidraw's native local scene stores.
- `shared/core.js` owns deterministic scene hashing, folder/path mapping, and deletion-safe workspace transforms.
- `background.js` keeps OAuth tokens away from page DOM and performs provider API requests.
- `.excalidraw-sync.json` records the exact GitHub paths managed by the extension.

See [PRIVACY.md](PRIVACY.md) and [SECURITY.md](SECURITY.md) for the data and trust boundaries.

## Development status

This is an initial private alpha. Provider credentials are not bundled, and production OAuth/store review is still required before public distribution.
