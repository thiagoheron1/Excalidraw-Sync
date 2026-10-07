# Security

## Supported version

Security fixes are applied to the latest release on `main`.

## Reporting

Please report suspected vulnerabilities privately to the repository owner instead of opening a public issue.

## Security properties

- OAuth tokens stay in extension-local storage and are never placed in page DOM, diagram content, logs, or Git commits.
- The content script runs only on `https://excalidraw.com/`.
- GitHub deletion is limited to paths listed by the extension's previous `.excalidraw-sync.json` index.
- Google Drive deletion is limited to items tagged with the current workspace ID and created through the extension's `drive.file` grant.
- Local file and folder deletion requires an explicit confirmation dialog. A swipe only opens that dialog.

