# Changelog

Notable user-facing changes are recorded here. This file summarizes the PocketFiles `0.4.2` project snapshot and the changes documented during its preparation. Earlier release dates and version-by-version details were not present in the supplied project materials, so they are not inferred here.

## 0.4.2

### Features and behavior
- Local-first file hub presented in the browser side panel.
- User-selected folder access and recursive indexing without an artificial 10,000-item cap.
- File and folder search, breadcrumbs, All files / Recent / Favorites views.
- Image, PDF, and text-based previews.
- List and grid layouts, multi-selection, ZIP creation, ZIP extraction, Save/download, and supported drag-and-drop workflows.
- Optional Desktop Bridge for native operating-system file clipboard Copy.
- Local persistence for folder handles and user preferences.

### Interface
- Compact headline and simplified action controls.
- Theme control uses a button rather than a dropdown.
- Grid selection control positioned at the lower-right of file cards.
- ZIP, Copy, and Save controls use icon-focused presentation.

### Reliability and setup
- Indexing handles inaccessible nested items without stopping the entire scan.
- Native Copy reports when the Desktop Bridge is unavailable rather than silently substituting a ZIP download.
- Added Windows, macOS, and Linux Desktop Bridge installers and setup documentation.
- Added detailed `guide.md` instructions for unpacked installation, folder connection, native bridge setup, and troubleshooting.

### Documentation
- Added project introduction and feature overview.
- Added contribution, security, license, and changelog documentation.

## Notes

- The extension manifest version is `0.4.2`.
- Native file Copy requires the optional Desktop Bridge to be installed and registered for the correct browser extension ID.
- ZIP handling is classic ZIP; encrypted archives and ZIP64 archives are not supported by the included extractor.
