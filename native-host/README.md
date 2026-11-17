# PocketFiles Desktop Bridge

The Desktop Bridge is an optional local Native Messaging helper for the **Copy** action. It stages selected files in the operating system's temporary directory and places their paths on the native file clipboard, enabling paste into supported file managers.

## Install

Follow the [Desktop Bridge setup guide](../guide.md#install-the-desktop-bridge). Run the installer for your operating system from this directory and enter the extension ID shown on the browser's extensions page.

- **Windows:** `install-native-host-windows.ps1` builds the helper with PyInstaller and registers it for the selected Chrome or Edge profile. Python 3 and a one-time internet connection are required for the PyInstaller install.
- **macOS/Linux:** `install-native-host-unix.sh` creates a local launcher and registers the helper for Chrome, Edge, or Chromium. Python 3 is required. macOS uses Swift/AppKit; Linux requires `wl-clipboard` (Wayland) or `xclip` (X11) for native clipboard support.

## Files and data

The bridge writes temporary copies under `PocketFilesClipboard` in the operating system's temp directory. It does not move or modify the originals. Staging folders older than seven days are removed during a later Copy operation. The helper communicates with the extension through Chromium Native Messaging and does not use the network.

For the extension's overall security model, see [`../security.md`](../security.md).
