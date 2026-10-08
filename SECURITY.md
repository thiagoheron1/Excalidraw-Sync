# Security

## Supported version

Security fixes are applied to the latest release on `main`.

## Reporting

Please report suspected vulnerabilities privately to the repository owner instead of opening a public issue.

## Security properties

- OAuth client IDs are public identifiers. Client secrets are never required, accepted, or bundled.
- OAuth access and refresh tokens use a dedicated extension-owned credential record so provider connections survive browser and extension-worker restarts. The background worker never returns this record to page code. Pending device codes stay in session storage.
- Provider status/configuration remains separate and secret-free. Tokens are never placed in page DOM, diagram content, logs, or Git commits, and disconnecting clears the provider's credential entry.
- Session credentials are cleared by browser restart, extension reload/update, or disabling the extension. Users must reconnect afterward.
- Token-like values are removed from user-visible diagnostics and native error logs; the native helper never receives provider credentials.
- The content script runs only on `https://excalidraw.com/`.
- GitHub deletion is limited to paths listed by the extension's previous `.excalidraw-sync.json` index.
- Google Drive deletion is limited to items tagged with the current workspace ID and created through the extension's `drive.file` grant.
- Local file and folder deletion requires an explicit confirmation dialog. A swipe only opens that dialog. Confirmed entries remain in `~/.excalidraw-sync/.trash` for 30 days.
- The native helper is restricted to `~/.excalidraw-sync`; error-only logs in `.logs` expire after 7 days.
- Bulk local deletion requires typing `delete` exactly and clears the extension vault plus the uninstall-recovery mirror.

## Limits

Client IDs cannot be kept secret because OAuth requires sending them to the provider. Browser extension storage does not protect credentials from a compromised operating system, browser profile, or privileged malicious extension. The uninstall-recovery mirror belongs to the `excalidraw.com` origin, so scripts running on that origin share its storage trust boundary; GitHub or Google Drive should be used as an independent backup for important files.
