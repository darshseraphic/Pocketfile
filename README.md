# PocketFiles

![PocketFiles](icons/logo.svg)

**A local-first file hub for Chromium browsers.** Browse, search, preview, and manage files from a folder you choose — directly in the browser's side panel.

PocketFiles is a Manifest V3 extension for desktop Chromium browsers. It requires Chrome 116 or later and is installed locally with the browser's **Load unpacked** option.

## Features

- **Folder browsing:** connect a folder and browse its accessible subfolders.
- **Search and navigation:** search file and folder names, use breadcrumbs, and switch between All files, Recent, and Favorites.
- **Flexible views:** browse in list or grid layout.
- **File previews:** preview images, PDFs, and common text-based files up to 2 MB.
- **Drag and drop:** drag files to supported upload fields or drop files into the connected folder.
- **File actions:** save files, create ZIP archives, and extract supported ZIP archives.
- **Native file Copy:** copy selected files and folders to the operating-system file clipboard with the optional Desktop Bridge.
- **Themes:** choose System, Light, or Dark appearance.

## How to install extension for now?

go to the repository, copy the SSH of the repository and clone the extension from the git command, else run this command itself:

```powershell
git clone https://github.com/darshseraphic/Pocketfile.git
```

After the extension download successfully, follow the guide.md in the folder to continue the installation.

## How PocketFiles works

### 1. Connect a folder

Open PocketFiles and select **Connect folder**. Choose the folder you want to work with and grant the browser's requested read/write access. PocketFiles uses that folder selection for its file operations.

### 2. Browse and find files

PocketFiles indexes the selected folder and its accessible subfolders. Search by file or folder name, navigate with breadcrumbs, and switch between **All files**, **Recent**, and **Favorites**. Choose list or grid view to suit the task.

### 3. Preview and manage files

Open supported images, PDFs, and text-based files in the preview. Save files, create ZIP archives, extract supported ZIP archives, or use drag and drop with compatible browser destinations. The built-in ZIP reader supports Store and Deflate entries; encrypted archives and ZIP64 are not supported.

### 4. Copy files to your desktop

The **Copy** action uses the optional Desktop Bridge to make selected files and folders available on the operating-system file clipboard. The bridge stages temporary copies in the system's `PocketFilesClipboard` temp folder and places those paths on the clipboard. It does not move or modify the originals. Staging folders older than seven days are removed during a later Copy operation.

Browsing, previews, Save, and ZIP actions work without the Desktop Bridge. See the [setup guide](guide.md#install-the-desktop-bridge) to install it on Windows, macOS, or Linux.

### 5. Understand where data is stored

The selected folder handle is stored in IndexedDB. Preferences such as theme, favorites, and recent items use Chrome's local extension storage. File browsing and processing take place locally in the extension.

## Try the sample files

Use the included [`sample-files/`](sample-files/) folder to explore PocketFiles without connecting a personal folder. It contains example documents, nested folders, and a sample ZIP archive.

## Test multi-image workflows

[Nomdiare](http://darshseraphic.github.io/Nomdiare/) is a small image counter for testing PocketFiles' multi-image workflow. Paste or drag images onto the page to check how many are detected. See the [Nomdiare repository](https://github.com/darshseraphic/Nomdiare).

## Get the source

Download or clone the PocketFiles project, then locate the project root — the folder that contains the top-level `manifest.json`. Load this folder in the browser; do not select `pocketfiles-demo/`, which is an older standalone demo snapshot.

## Install PocketFiles

1. Extract the project source and keep the folder in a location you control.
2. Open `chrome://extensions` in Chrome or `edge://extensions` in Edge.
3. Enable **Developer mode**.
4. Select **Load unpacked**.
5. Choose the PocketFiles project root — the folder containing `manifest.json` directly.
6. Pin PocketFiles to the toolbar if desired, then open it.
7. Select **Connect folder**, choose a folder, and grant the requested access.

The manifest specifies Chrome 116 or later. After changing extension files, return to the extensions page and select **Reload** to load the changes.

## Project files

| File or folder | Purpose |
|---|---|
| `manifest.json` | Manifest V3 configuration, browser version requirement, extension entry points, and permissions. |
| `sidepanel.html` | Markup for the PocketFiles side panel. |
| `sidepanel.css` | Layout, themes, and component styling. |
| `sidepanel.js` | Folder access, indexing, search, navigation, previews, file actions, and local preferences. |
| `background.js` | Configures the side panel to open from the extension toolbar action. |
| `zip.js` | ZIP archive creation and extraction support. |
| `icons/` | Extension icons and the project logo. |
| `sample-files/` | Example files and folders for testing. |
| `native-host/` | Optional Desktop Bridge, platform installers, and native-host documentation. |
| `pocketfiles-demo/` | Older standalone demo snapshot; not the current extension. |
| `guide.md` | Installation, Desktop Bridge setup, and troubleshooting. |
| `contribution.md` | Feedback and contribution guidelines under the project license. |
| `security.md` | Security model and vulnerability reporting instructions. |
| `CHANGELOG.md` | Summary of documented features and project changes. |
| `LICENSE.txt` | License terms for the project. |

## Privacy and security notes

PocketFiles requests the `storage`, `sidePanel`, and `nativeMessaging` extension permissions. It does not declare website host permissions. Folder access is granted through the browser's folder picker; PocketFiles stores the selected folder handle in IndexedDB and keeps preferences in extension-local storage.

The Desktop Bridge is optional. It communicates with the extension through Chromium Native Messaging and does not use the network. The extension and bridge process file operations locally. Review [`security.md`](security.md) before connecting folders or installing the bridge.

## License

See [`LICENSE.txt`](LICENSE.txt) for the project's source-available license terms. Review the license before modifying, redistributing, or using the software commercially.
