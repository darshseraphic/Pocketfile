# Setup guide

This guide covers the current PocketFiles extension in the project root. The folder to load must contain the top-level `manifest.json`.

## Install the extension

1. Extract the project folder and keep it in a location you control.
2. Open `chrome://extensions` in Chrome or `edge://extensions` in Edge.
3. Enable **Developer mode**.
4. Select **Load unpacked** and choose the project root folder — the folder containing `manifest.json`, `sidepanel.html`, and `background.js`.
5. Pin PocketFiles if desired, then open it from the toolbar.
6. Select **Connect folder**, choose a folder, and grant access when prompted.

The included `sample-files/` folder is available for a first test. PocketFiles asks for read/write access because it can add files and extract ZIP archives into the connected folder.

## Install the Desktop Bridge

The Desktop Bridge is optional. Install it only when you need to use **Copy** to paste files into Finder, File Explorer, or another file manager. ZIP and Save do not require it.

Before installing, open the browser's extensions page and copy the PocketFiles extension ID. Keep the ID and browser name ready.

### Windows

Requirements: Python 3, available on `PATH`, and an internet connection for the installer's one-time PyInstaller setup.

1. Open PowerShell in the project's `native-host/` folder.
2. Run:

   ```powershell
   Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass
   .\install-native-host-windows.ps1
   ```

3. Enter the extension ID when prompted, then choose **Chrome** or **Edge** to match the browser where PocketFiles is installed.
4. When the installer reports `Desktop Bridge installed.`, reload PocketFiles from the extensions page.

### macOS and Linux

Requirements: Python 3. On macOS, Xcode Command Line Tools are needed if `swift` is not available. On Linux, install `wl-clipboard` for Wayland or `xclip` for X11.

1. Open Terminal in the project's `native-host/` folder.
2. Run:

   ```bash
   chmod +x ./install-native-host-unix.sh
   ./install-native-host-unix.sh
   ```

3. Enter the extension ID, then choose **Chrome**, **Edge**, or **Chromium**.
4. Reload PocketFiles in the browser.

On macOS, install Xcode Command Line Tools with `xcode-select --install` if the `swift` command is missing.

## Use native Copy

1. Connect a folder and select one or more files or folders.
2. Select **Copy**.
3. Paste into a supported destination with `Ctrl+V` on Windows/Linux or `Cmd+V` on macOS.

The bridge creates temporary copies in the operating system's `PocketFilesClipboard` temp folder and places those paths on the native file clipboard. Original files are not moved or modified. Staging folders older than seven days are cleaned during a later Copy operation.

## Troubleshooting

- **Copy says the Desktop Bridge is missing:** Check that the installer used the current extension ID and the correct browser. Run it again if the extension ID or install location changed, then reload PocketFiles.
- **The folder is unavailable:** Reconnect it and grant read/write permission again.
- **Python is not found:** Install Python 3 and enable the option to add it to `PATH`, then reopen PowerShell or Terminal.
- **macOS Copy fails:** Install Xcode Command Line Tools if `swift` is unavailable.
- **Linux Copy fails:** Confirm that `wl-clipboard` or `xclip` is installed for the current display session.
- **ZIP extraction fails:** The built-in reader supports Store and Deflate entries. Encrypted archives and ZIP64 are not supported.

For security details, see [security.md](security.md). For the bridge implementation notes, see [`native-host/README.md`](native-host/README.md).
