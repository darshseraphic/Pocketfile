# Security

PocketFiles is designed to process files locally in the browser and to access only folders that the user chooses.

## Security model

- **Folder access:** The browser's File System Access API asks the user to select a folder and grant access. PocketFiles uses the granted handle for browsing and file actions.
- **Extension permissions:** `manifest.json` declares `storage`, `sidePanel`, and `nativeMessaging`. It does not declare website host permissions.
- **Local data:** The selected folder handle is stored in IndexedDB. Theme, favorites, and recent items are stored using extension-local storage. File processing is performed locally.
- **Desktop Bridge:** Native file Copy uses the optional helper in `native-host/`. The helper receives the selected file data through Chromium Native Messaging, creates temporary copies under the operating system's `PocketFilesClipboard` temp folder, and publishes those paths to the native file clipboard. It does not move or modify the originals and does not use the network.

The bridge removes staging folders older than seven days during a later Copy operation. Uninstall the bridge when you no longer need native file Copy.

## Use PocketFiles safely

- Connect only folders you intend to browse or manage.
- Grant folder access only after checking the selected location.
- Keep your browser and operating system up to date.
- Treat downloaded files and ZIP archives from unknown sources as untrusted.
- Review archive contents before extraction, especially when extracting into important folders.
- Avoid sharing logs or screenshots that expose private paths or file contents.

## Report a vulnerability

Please report suspected vulnerabilities privately to:

**Darshseraphic** — [Darsh.seraphic@gmail.com](mailto:Darsh.seraphic@gmail.com)

Include the affected version, browser and operating system, reproduction steps, potential impact, and relevant proof-of-concept details. Do not include credentials, private documents, or unrelated personal data.

Please do not publicly disclose an exploitable issue until the maintainer has had a reasonable opportunity to investigate it. No response or remediation timeframe is guaranteed.

## Scope

This policy describes the current project snapshot and is not a guarantee that PocketFiles is free of vulnerabilities. Review the source and release notes for the version you use.
