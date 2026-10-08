# Privacy

Excalidraw Sync is local-first. It stores its workspace, provider settings, public OAuth client IDs, and a separate provider-credential record in browser extension storage. The credential record lets GitHub and Google Drive connections survive browser and extension-worker restarts; it is used only by extension code and is never returned to the Excalidraw page. Pending GitHub device codes remain in session storage. The extension also mirrors the workspace into IndexedDB owned by `excalidraw.com` so drawings can be recovered after extension uninstall and reinstall. When the optional native helper is installed it writes ordinary drawing files only below `~/.excalidraw-sync`. Deleted entries stay in `.trash` for 30 days. Error-only diagnostic files stay in `.logs` for 7 days and sanitize token-like text before writing. Tokens are never written into diagram files, diagnostics, commits, console output, or this repository.

The extension reads only the current drawing data that Excalidraw itself stores on `excalidraw.com`. It sends diagram files only to providers that the user explicitly connects:

- GitHub: repository access is requested so the extension can create and update the selected diagram repository.
- Google Drive: `drive.file` access is requested so the extension can manage only files and folders it creates or opens through the app.

Disconnecting a provider removes its local token. It does not delete already-synchronized remote files. Deleting a local file or folder always requires confirmation and moves it to local Trash for 30 days; the next sync removes only remote items recorded as managed by this extension. Deleting all local files requires typing `delete` exactly and clears the native vault, extension-owned copies, and the Excalidraw-site recovery mirror.
