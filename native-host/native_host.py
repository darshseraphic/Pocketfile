#!/usr/bin/env python3
"""PocketFiles native clipboard bridge.

Receives selected file bytes from the extension over Chrome Native Messaging,
materializes them in a temporary local folder, then publishes those paths using
the operating system's native file-copy clipboard format.
"""

from __future__ import annotations

import base64
import json
import os
import platform
import shutil
import struct
import subprocess
import sys
import tempfile
import time
import uuid
from pathlib import Path
from urllib.parse import quote

HOST_NAME = "com.pocketfiles.clipboard"
MAX_MESSAGE_BYTES = 1024 * 1024
RETENTION_SECONDS = 7 * 24 * 60 * 60


def read_message():
    header = sys.stdin.buffer.read(4)
    if not header:
        return None
    if len(header) != 4:
        raise EOFError("Incomplete native messaging header")
    size = struct.unpack("<I", header)[0]
    if size <= 0 or size > MAX_MESSAGE_BYTES:
        raise ValueError("Native message size is invalid")
    body = sys.stdin.buffer.read(size)
    if len(body) != size:
        raise EOFError("Incomplete native messaging payload")
    return json.loads(body.decode("utf-8"))


def send_message(payload):
    data = json.dumps(payload, separators=(",", ":")).encode("utf-8")
    sys.stdout.buffer.write(struct.pack("<I", len(data)))
    sys.stdout.buffer.write(data)
    sys.stdout.buffer.flush()


def safe_relative_path(raw_name: str) -> Path:
    if not isinstance(raw_name, str) or not raw_name.strip():
        raise ValueError("A copied item has an empty name")
    normalized = raw_name.replace("\\", "/")
    parts = [part for part in normalized.split("/") if part not in ("", ".")]
    if not parts or normalized.startswith("/") or any(part == ".." or "\x00" in part for part in parts):
        raise ValueError("A copied item contains an unsafe path")
    if any("/" in part or "\\" in part for part in parts):
        raise ValueError("A copied item contains an invalid path segment")
    return Path(*parts)


def clean_old_staging_dirs(base: Path):
    base.mkdir(parents=True, exist_ok=True)
    cutoff = time.time() - RETENTION_SECONDS
    for child in base.iterdir():
        try:
            if child.is_dir() and child.stat().st_mtime < cutoff:
                shutil.rmtree(child, ignore_errors=True)
        except OSError:
            pass


def set_windows_clipboard(paths: list[Path]):
    import ctypes
    from ctypes import wintypes

    user32 = ctypes.WinDLL("user32", use_last_error=True)
    kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)

    GMEM_MOVEABLE = 0x0002
    GMEM_ZEROINIT = 0x0040
    CF_HDROP = 15

    user32.OpenClipboard.argtypes = [wintypes.HWND]
    user32.OpenClipboard.restype = wintypes.BOOL
    user32.EmptyClipboard.argtypes = []
    user32.EmptyClipboard.restype = wintypes.BOOL
    user32.SetClipboardData.argtypes = [wintypes.UINT, wintypes.HANDLE]
    user32.SetClipboardData.restype = wintypes.HANDLE
    user32.RegisterClipboardFormatW.argtypes = [wintypes.LPCWSTR]
    user32.RegisterClipboardFormatW.restype = wintypes.UINT
    user32.CloseClipboard.argtypes = []
    user32.CloseClipboard.restype = wintypes.BOOL
    kernel32.GlobalAlloc.argtypes = [wintypes.UINT, ctypes.c_size_t]
    kernel32.GlobalAlloc.restype = wintypes.HGLOBAL
    kernel32.GlobalLock.argtypes = [wintypes.HGLOBAL]
    kernel32.GlobalLock.restype = wintypes.LPVOID
    kernel32.GlobalUnlock.argtypes = [wintypes.HGLOBAL]
    kernel32.GlobalUnlock.restype = wintypes.BOOL
    kernel32.GlobalFree.argtypes = [wintypes.HGLOBAL]
    kernel32.GlobalFree.restype = wintypes.HGLOBAL

    filenames = [str(path.resolve()) for path in paths]
    # DROPFILES (20 bytes) followed by UTF-16LE absolute paths and a double NUL.
    names_blob = ("\0".join(filenames) + "\0\0").encode("utf-16le")
    dropfiles = struct.pack("<IiiII", 20, 0, 0, 0, 1)
    payload = dropfiles + names_blob
    hdrop = kernel32.GlobalAlloc(GMEM_MOVEABLE | GMEM_ZEROINIT, len(payload))
    if not hdrop:
        raise OSError("Could not allocate Windows clipboard memory")
    pointer = kernel32.GlobalLock(hdrop)
    if not pointer:
        kernel32.GlobalFree(hdrop)
        raise OSError("Could not lock Windows clipboard memory")
    ctypes.memmove(pointer, payload, len(payload))
    kernel32.GlobalUnlock(hdrop)

    # Preferred DropEffect = DROPEFFECT_COPY (1), used by Windows Shell.
    preferred_format = user32.RegisterClipboardFormatW("Preferred DropEffect")
    effect_data = struct.pack("<I", 1)
    heffect = kernel32.GlobalAlloc(GMEM_MOVEABLE | GMEM_ZEROINIT, len(effect_data))
    if heffect:
        effect_ptr = kernel32.GlobalLock(heffect)
        if effect_ptr:
            ctypes.memmove(effect_ptr, effect_data, len(effect_data))
            kernel32.GlobalUnlock(heffect)

    opened = False
    for _ in range(20):
        if user32.OpenClipboard(None):
            opened = True
            break
        time.sleep(0.05)
    if not opened:
        kernel32.GlobalFree(hdrop)
        if heffect:
            kernel32.GlobalFree(heffect)
        raise OSError("Windows clipboard is busy. Try Copy again.")

    try:
        if not user32.EmptyClipboard():
            raise OSError("Could not clear the Windows clipboard")
        if not user32.SetClipboardData(CF_HDROP, hdrop):
            raise OSError("Could not publish copied files to the Windows clipboard")
        hdrop = None  # Ownership transfers to Windows after SetClipboardData.
        if heffect and preferred_format:
            if user32.SetClipboardData(preferred_format, heffect):
                heffect = None
    finally:
        user32.CloseClipboard()
        if hdrop:
            kernel32.GlobalFree(hdrop)
        if heffect:
            kernel32.GlobalFree(heffect)


def set_macos_clipboard(paths: list[Path], staging: Path):
    swift = shutil.which("swift") or "/usr/bin/swift"
    if not Path(swift).exists() and not shutil.which(swift):
        raise RuntimeError("Swift is unavailable. Install Xcode Command Line Tools, then try again.")

    swift_source = staging / "write_file_clipboard.swift"
    swift_source.write_text(
        """import AppKit\nimport Foundation\nimport Darwin\n\n"""
        "let paths = Array(CommandLine.arguments.dropFirst())\n"
        "let items: [NSPasteboardWriting] = paths.map { URL(fileURLWithPath: $0) as NSURL }\n"
        "let pasteboard = NSPasteboard.general\n"
        "pasteboard.clearContents()\n"
        "if !pasteboard.writeObjects(items) {\n"
        "  fputs(\"Could not publish files to the macOS pasteboard\\n\", stderr)\n"
        "  exit(2)\n"
        "}\n",
        encoding="utf-8",
    )
    completed = subprocess.run(
        [swift, str(swift_source), *[str(path.resolve()) for path in paths]],
        capture_output=True,
        text=True,
        timeout=60,
    )
    if completed.returncode != 0:
        detail = (completed.stderr or completed.stdout or "Swift clipboard helper failed").strip()
        raise RuntimeError(detail[:500])


def set_linux_clipboard(paths: list[Path]):
    uris = "\r\n".join(path.resolve().as_uri() for path in paths) + "\r\n"
    # GNOME and several GTK file managers use this richer file-copy target.
    gnome_payload = "copy\n" + "\n".join(path.resolve().as_uri() for path in paths) + "\n"

    wl_copy = shutil.which("wl-copy")
    if wl_copy:
        completed = subprocess.run(
            [wl_copy, "--type", "x-special/gnome-copied-files"],
            input=gnome_payload.encode("utf-8"),
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            timeout=15,
        )
        if completed.returncode == 0:
            return
        completed = subprocess.run(
            [wl_copy, "--type", "text/uri-list"],
            input=uris.encode("utf-8"),
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            timeout=15,
        )
        if completed.returncode == 0:
            return

    xclip = shutil.which("xclip")
    if xclip:
        completed = subprocess.run(
            [xclip, "-selection", "clipboard", "-t", "x-special/gnome-copied-files", "-i"],
            input=gnome_payload.encode("utf-8"),
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            timeout=15,
        )
        if completed.returncode == 0:
            return
        completed = subprocess.run(
            [xclip, "-selection", "clipboard", "-t", "text/uri-list", "-i"],
            input=uris.encode("utf-8"),
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            timeout=15,
        )
        if completed.returncode == 0:
            return

    raise RuntimeError("Install wl-clipboard (Wayland) or xclip (X11) to enable file clipboard paste.")


def publish_file_clipboard(paths: list[Path], staging: Path):
    system = platform.system()
    if system == "Windows":
        set_windows_clipboard(paths)
    elif system == "Darwin":
        set_macos_clipboard(paths, staging)
    elif system == "Linux":
        set_linux_clipboard(paths)
    else:
        raise RuntimeError(f"File clipboard paste is not implemented for {system}.")


def main():
    current = None
    base = Path(tempfile.gettempdir()) / "PocketFilesClipboard"
    # Handshake before the extension sends data. This lets the UI distinguish
    # an installed host from a missing or outdated native-messaging host.
    send_message({"ok": True, "action": "hello", "hostVersion": 2})

    while True:
        message = read_message()
        if message is None:
            break
        try:
            action = message.get("action")
            if action == "begin":
                copy_id = str(message.get("copyId", ""))
                if not copy_id or len(copy_id) > 80:
                    raise ValueError("Invalid copy session")
                clean_old_staging_dirs(base)
                stage = base / str(uuid.uuid4())
                stage.mkdir(parents=True, exist_ok=False)
                current = {
                    "copy_id": copy_id,
                    "stage": stage,
                    "expected": {},
                    "written": {},
                    "entries": set(),
                }
                send_message({"ok": True, "action": "ready", "copyId": copy_id})
            elif action == "entry":
                if not current or message.get("copyId") != current["copy_id"]:
                    raise ValueError("No active copy session")
                relative = safe_relative_path(message.get("name"))
                key = relative.as_posix()
                if key in current["entries"]:
                    raise ValueError("Two selected items have the same destination name")
                current["entries"].add(key)
                destination = current["stage"] / relative
                if message.get("kind") == "directory":
                    destination.mkdir(parents=True, exist_ok=True)
                elif message.get("kind") == "file":
                    size = int(message.get("size", -1))
                    if size < 0:
                        raise ValueError("Invalid file size")
                    destination.parent.mkdir(parents=True, exist_ok=True)
                    destination.write_bytes(b"")
                    current["expected"][key] = size
                    current["written"][key] = 0
                else:
                    raise ValueError("Unknown copied item type")
                send_message({"ok": True, "action": "ack", "forAction": "entry", "name": key})
            elif action == "chunk":
                if not current or message.get("copyId") != current["copy_id"]:
                    raise ValueError("No active copy session")
                relative = safe_relative_path(message.get("name"))
                key = relative.as_posix()
                if key not in current["expected"]:
                    raise ValueError("File metadata was not received")
                offset = int(message.get("offset", -1))
                if offset != current["written"].get(key, 0):
                    raise ValueError("File data arrived out of order")
                chunk = base64.b64decode(message.get("data", ""), validate=True)
                if not chunk and current["expected"][key] != 0:
                    raise ValueError("Empty file chunk")
                if offset + len(chunk) > current["expected"][key]:
                    raise ValueError("File data exceeded its expected size")
                destination = current["stage"] / relative
                with destination.open("ab") as stream:
                    stream.write(chunk)
                current["written"][key] = offset + len(chunk)
                send_message({"ok": True, "action": "ack", "forAction": "chunk", "name": key, "nextOffset": offset + len(chunk)})
            elif action == "finish":
                if not current or message.get("copyId") != current["copy_id"]:
                    raise ValueError("No active copy session")
                for name, expected_size in current["expected"].items():
                    actual_size = current["written"].get(name, 0)
                    if actual_size != expected_size:
                        raise ValueError(f"Incomplete file transfer: {name}")
                root_names = sorted({name.split("/", 1)[0] for name in current["entries"]})
                root_paths = [current["stage"] / name for name in root_names]
                root_paths = [path for path in root_paths if path.exists()]
                file_count = len(current["expected"])
                if not root_paths:
                    raise ValueError("There are no files or folders to copy")
                publish_file_clipboard(root_paths, current["stage"])
                send_message({"ok": True, "action": "complete", "fileCount": file_count, "itemCount": len(root_paths)})
                current = None
            else:
                raise ValueError("Unknown native host action")
        except Exception as error:  # Send a useful error back to the extension UI.
            send_message({"ok": False, "action": "error", "error": str(error)[:500]})
            current = None


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        # Native Messaging stdout must remain protocol-only.
        print(f"PocketFiles native host error: {error}", file=sys.stderr)
        sys.exit(1)
