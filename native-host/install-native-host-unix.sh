#!/usr/bin/env bash
set -euo pipefail

HOST_NAME='com.pocketfiles.clipboard'
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

printf 'PocketFiles Desktop Bridge installer\n'
read -r -p 'Paste the PocketFiles extension ID from chrome://extensions or edge://extensions: ' EXTENSION_ID
if [[ ! "$EXTENSION_ID" =~ ^[a-p]{32}$ ]]; then
  echo 'That does not look like a Chromium extension ID (32 letters a-p).' >&2
  exit 1
fi
read -r -p 'Browser: Chrome, Edge, or Chromium [Chrome]: ' BROWSER
BROWSER="${BROWSER:-Chrome}"

case "${BROWSER,,}" in
  chrome)
    if [[ "$(uname -s)" == 'Darwin' ]]; then
      MANIFEST_DIR="$HOME/Library/Application Support/Google/Chrome/NativeMessagingHosts"
    else
      MANIFEST_DIR="$HOME/.config/google-chrome/NativeMessagingHosts"
    fi
    ;;
  edge)
    if [[ "$(uname -s)" == 'Darwin' ]]; then
      MANIFEST_DIR="$HOME/Library/Application Support/Microsoft Edge/NativeMessagingHosts"
    else
      MANIFEST_DIR="$HOME/.config/microsoft-edge/NativeMessagingHosts"
    fi
    ;;
  chromium)
    if [[ "$(uname -s)" == 'Darwin' ]]; then
      MANIFEST_DIR="$HOME/Library/Application Support/Chromium/NativeMessagingHosts"
    else
      MANIFEST_DIR="$HOME/.config/chromium/NativeMessagingHosts"
    fi
    ;;
  *) echo 'Choose Chrome, Edge, or Chromium.' >&2; exit 1 ;;
esac

PYTHON="$(command -v python3 || true)"
if [[ -z "$PYTHON" ]]; then
  echo 'Python 3 is required. Install Python 3 and run this installer again.' >&2
  exit 1
fi

LAUNCHER="$HERE/pocketfiles-native-host-launcher"
cat > "$LAUNCHER" <<EOF
#!/bin/sh
exec "$PYTHON" "$HERE/native_host.py"
EOF
chmod 755 "$LAUNCHER"
mkdir -p "$MANIFEST_DIR"
MANIFEST_PATH="$MANIFEST_DIR/$HOST_NAME.json"
cat > "$MANIFEST_PATH" <<EOF
{
  "name": "$HOST_NAME",
  "description": "PocketFiles local file clipboard bridge",
  "path": "$LAUNCHER",
  "type": "stdio",
  "allowed_origins": ["chrome-extension://$EXTENSION_ID/"]
}
EOF
chmod 644 "$MANIFEST_PATH"

if [[ "$(uname -s)" == 'Linux' ]]; then
  if [[ -n "${WAYLAND_DISPLAY:-}" ]] && ! command -v wl-copy >/dev/null 2>&1; then
    echo 'Note: install wl-clipboard to enable file clipboard paste on Wayland.'
  elif [[ -z "${WAYLAND_DISPLAY:-}" ]] && ! command -v xclip >/dev/null 2>&1; then
    echo 'Note: install xclip to enable file clipboard paste on X11.'
  fi
fi

printf '\nDesktop Bridge installed. Reload the extension, select files, and press Copy.\n'
printf 'Paste with Cmd+V in Finder on macOS or Ctrl+V in your file manager on Linux.\n'
