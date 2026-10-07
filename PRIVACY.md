# Privacy

Excalidraw Sync is local-first. It stores its workspace, provider settings, and OAuth tokens in the browser extension's local storage. Tokens are never written into diagram files, commits, console output, or this repository.

The extension reads only the current drawing data that Excalidraw itself stores on `excalidraw.com`. It sends diagram files only to providers that the user explicitly connects:

- GitHub: repository access is requested so the extension can create and update the selected diagram repository.
- Google Drive: `drive.file` access is requested so the extension can manage only files and folders it creates or opens through the app.

Disconnecting a provider removes its local token. It does not delete already-synchronized remote files. Deleting a local file or folder always requires confirmation; the next sync removes only remote items recorded as managed by this extension.

