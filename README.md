# Excalidraw Sync

Excalidraw Sync adds a file-and-folder sidebar to [Excalidraw](https://excalidraw.com/). Drawings stay available locally and can be synchronized automatically to a GitHub repository and/or a Google Drive folder.

## What works

- Local-first `.excalidraw` files with embedded image preservation.
- Folders, search, pinned files, rename/move, file and read-only-link import, drag-and-drop ordering, and one-click switching.
- The current file is saved before another file opens, then Excalidraw changes scenes in place while the Files sidebar stays open.
- Background autosave when Excalidraw's native scene changes.
- Light, dark, and automatic system themes.
- An optional native helper that writes real files to `~/.excalidraw-sync`, plus browser and Excalidraw-site recovery mirrors.
- Configurable save behavior: after each detected edit, at 5-second to 5-minute intervals, or manual only.
- Latest local-save and cloud-sync timestamps, with yellow pending and red stale warnings after a configurable threshold.
- A persistent notification history for unsaved work and cloud-sync failures; opening it marks items read without removing them.
- GitHub Device Flow sign-in, automatic repository creation, private/public visibility, bidirectional cross-machine folder sync, and change-only commits.
- Google Drive OAuth, bidirectional cross-machine folder sync, private/link-shared visibility, and change-only uploads.
- Touch swipe-left deletion requests plus visible keyboard/desktop delete buttons. Both paths require confirmation and move entries to `.trash` for 30 days.
- Error-only sanitized diagnostics in `.logs`, automatically removed after 7 days.
- A per-file control that invokes Excalidraw's native read-only Shareable Link export and copies the result.
- A draggable launcher icon that stays inside the viewport and remembers its position. Keyboard users can move it with Alt+Arrow keys.
- A labeled **ExcaliSync** launcher that can be hidden from Manage settings; the browser-toolbar icon always remains an alternative way to open the sidebar.
- A compact file sidebar with primary actions first, the latest-save status followed by search, one-click **Sync all**, and per-document yellow/red sync warnings.
- A compact Settings screen with focused General, Saving, Local storage, and Cloud sync groups; provider credentials stay collapsed until needed.
- A guarded **Delete all local files** action that requires typing `delete` and removes both the extension vault and reinstall recovery copy.
- Manifest V3 packages for Chrome, Edge, Opera, and Firefox; Safari conversion instructions are below.

Cloud synchronization is intentionally outbound in this first version: local changes are uploaded automatically, while edits made directly to remote `.excalidraw` files are not pulled back or merged. This avoids silently overwriting the currently open canvas.

## Local vault

The extension always mirrors the workspace in browser extension storage and in an IndexedDB recovery copy belonging to `excalidraw.com`. When the native helper is installed it also writes ordinary `.excalidraw` files under `~/.excalidraw-sync`, regardless of whether GitHub or Google Drive is connected. On reinstall, an empty extension can restore the browser recovery mirror.

Select **Manage → Local storage → Open vault** to open `~/.excalidraw-sync` in Finder. If the helper is unavailable, the button opens the browser recovery vault instead.

Browsers cannot write arbitrary home-directory files directly, so real disk storage uses the included native-messaging helper. After loading the unpacked Chrome build, copy its extension ID from `chrome://extensions` and run:

```bash
./native-host/install-macos.sh YOUR_32_CHARACTER_EXTENSION_ID
```

Reload the extension after installation. The helper is restricted to its own host manifest and `~/.excalidraw-sync`; it stores no OAuth credentials. Deleted drawings are retained under `.trash` for 30 days, and sanitized error-only logs under `.logs` for 7 days.

Uninstall recovery is best effort: removing the extension alone does not normally erase Excalidraw's site storage, but clearing site data, using private browsing, deleting the browser profile, or a browser storage cleanup can remove the recovery mirror. Because it belongs to the `excalidraw.com` origin, scripts running on that origin share the same browser-storage trust boundary. Use GitHub or Google Drive as an additional independent backup for important diagrams.

Select **Manage → Local vault → Delete all local files** to intentionally erase all managed drawings and folders. The confirmation dialog requires typing `delete` exactly. The extension then removes both local copies and starts with one blank drawing; a future cloud sync may reflect those deletions remotely.

If the extension is reloaded or updated while Excalidraw is already open, ExcaliSync detects the invalidated browser context, preserves its in-memory workspace in temporary page-session recovery storage, reloads the page, and restores the pending change.

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

The extension uses GitHub Device Flow. Device Flow requires a public client ID but does not require a client secret.

1. Sign in to GitHub and open **Settings**.
2. Open **Developer settings → OAuth Apps**.
3. Select **New OAuth App**.
4. For **Application name**, enter `ExcaliSync` or another recognizable name.
5. For **Homepage URL**, enter `https://excalidraw.com/`.
6. **Application description** is optional. For example: `Sync Excalidraw drawings to my GitHub repository.`
7. For **Redirect URI**, enter `https://excalidraw.com/`. GitHub requires this field even though ExcaliSync uses Device Flow and does not redirect to it.
8. Leave **Allow wildcard matching** turned off.
9. Turn **Enable Device Flow** on.
10. Turn **Expire user access tokens** off for this version. ExcaliSync does not yet exchange GitHub refresh tokens, so an expiring token would eventually interrupt synchronization.
11. Select **Register application**.
12. Copy the **Client ID**. Do not generate, copy, or paste a client secret into the extension.
13. In ExcaliSync, open **Manage sync → GitHub** and paste the Client ID.
14. Choose the repository name and private/public visibility, then select **Connect GitHub**.
15. GitHub opens in a new tab. Enter the displayed one-time device code and approve access.
16. Return to Excalidraw. The repository is created during the first sync.

Official references: [creating a GitHub OAuth App](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/creating-an-oauth-app) and [GitHub Device Flow](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps#device-flow).

The repository is created during the first sync. The extension uses the GitHub Contents API and commits only files whose content changed. Remote removal is restricted to paths that were listed in the extension's previous sync index.

### Cross-machine synchronization

Install ExcaliSync on the other machine and configure the same provider target:

- For GitHub, sign in to the same account and use the same OAuth Client ID, repository name, and root folder.
- For Google Drive, sign in to the same Google account and use the same OAuth Client ID and Drive folder name.
- Select **Sync now** after connecting. A fresh installation adopts the remote folders and drawings. An existing installation merges by stable entry ID and newest modification time.
- Deletions remain as synchronization tombstones during the 30-day trash-retention window so an offline machine does not recreate a deleted drawing when it reconnects.

## Google Drive setup

Create a separate OAuth client ID for each browser package. These steps cover the primary Chrome/Edge/Opera build:

1. Run `npm run build`, load `dist/chrome` as an unpacked extension, and open `chrome://extensions`.
2. Enable **Developer mode** and copy the 32-character **ID** shown on the Excalidraw Sync card. Keep the extension at the same path so its unpacked ID remains stable.
3. Open the [Google Cloud Console](https://console.cloud.google.com/) and create or select a project.
4. Open **APIs & Services → Library**, search for **Google Drive API**, and select **Enable**.
5. Open **Google Auth Platform → Branding**. Configure the app name, support email, and developer contact email.
6. Open **Audience**. Choose **Internal** only for a Google Workspace organization whose users should have access; otherwise choose **External**. While the app is in testing, add each Google account that will use it as a test user.
7. Open **Data Access** and add the scopes `openid`, `email`, and `https://www.googleapis.com/auth/drive.file`. The `drive.file` scope limits the extension to files it creates or that the user explicitly opens with it.
8. Open **Google Auth Platform → Clients** and select **Create Client**.
9. Choose **Chrome Extension** as the application type.
10. Enter a name such as `Excalidraw Sync Chrome` and paste the extension ID from step 2 into **Item ID**.
11. Select **Create** and copy the generated **Client ID**. A Chrome Extension client does not need a client secret in this extension.
12. In Excalidraw Sync, open **Manage sync → Google Drive**, paste the Client ID, choose the folder name and privacy, then select **Connect Google Drive**.
13. Choose the Google account and approve the consent screen. The Drive folder is created during the first sync.

For a store release, create the Google client using the final Chrome Web Store extension ID before publishing. Edge, Opera, Firefox, and Safari have different identities or redirect requirements and should use separate provider clients rather than sharing credentials.

Official references: [create Google OAuth credentials](https://developers.google.com/workspace/guides/create-credentials#oauth-client-id) and [Chrome Identity API](https://developer.chrome.com/docs/extensions/reference/api/identity).

The requested `drive.file` scope lets the extension manage only its own Drive files. The root folder stays private by default. Selecting **Anyone with the link** is an explicit public-sharing action.

OAuth redirect handling differs by browser and store identity. For a production release, create a stable store ID and provider client for each browser package, then verify Google OAuth on each target browser before publishing.

## OAuth credential security

- OAuth **client IDs are public identifiers**. They appear in the extension and authorization requests and cannot be encrypted or hidden from users.
- Never add a GitHub or Google **client secret** to source code, the manifest, `.env` files included in a package, extension storage, screenshots, issues, or chat messages.
- Access tokens, refresh tokens, and GitHub device codes are treated as secrets. Excalidraw Sync keeps them in `storage.session`, which Chrome keeps in memory and does not expose to content scripts by default. They are cleared when the browser restarts or the extension is disabled, reloaded, or updated, so reconnecting is expected.
- Persistent extension storage contains provider configuration and public client IDs only. Existing tokens from older versions are migrated out of persistent storage on first use.
- OAuth and API requests use HTTPS. Diagnostics sanitize token-like values before displaying errors.
- This design greatly reduces token persistence, but no extension can guarantee protection if the browser profile, operating system, or another privileged extension is compromised.

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
