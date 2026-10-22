#!/usr/bin/env python3
"""Add Handy support to an unpacked VibeMate extension folder (e.g. .../ejkbone.../1.5.7_0).

usage: python3 -I patch-extension.py <unpacked-extension-dir> <output-dir>

 - copies the extension to <output-dir> (never edits the input)
 - adds handy/handy-patch.js and registers it as a MAIN-world content script on the connect window
 - removes Chrome's _metadata/ (signature data that no longer matches once files change)
Load <output-dir> via chrome://extensions -> Developer mode -> Load unpacked (disable the Web Store copy first).
"""
import json, shutil, sys, pathlib

here = pathlib.Path(__file__).resolve().parent
ENTRY = {
    "matches": ["*://*.fanberry.com/extension/*/connect.html*", "*://*.vibemate.com/extension/*/connect.html*"],
    "js": ["handy/handy-patch.js"],
    "run_at": "document_start",
    "world": "MAIN",
    "all_frames": False,
}

def main():
    if len(sys.argv) != 3:
        sys.exit(__doc__)
    src, dst = pathlib.Path(sys.argv[1]), pathlib.Path(sys.argv[2])
    if not (src / "manifest.json").is_file():
        sys.exit(f"{src} has no manifest.json")
    if dst.exists():
        sys.exit(f"{dst} already exists; choose a new output directory")
    shutil.copytree(src, dst)
    shutil.rmtree(dst / "_metadata", ignore_errors=True)
    (dst / "handy").mkdir(exist_ok=True)
    shutil.copy2(here / "extension" / "handy" / "handy-patch.js", dst / "handy" / "handy-patch.js")

    mp = dst / "manifest.json"
    m = json.loads(mp.read_text(encoding="utf8"))
    if int(m.get("manifest_version", 0)) != 3:
        sys.exit("expected a manifest v3 extension")
    cs = m.setdefault("content_scripts", [])
    if any(e.get("js") == ENTRY["js"] for e in cs):
        sys.exit("already patched")
    cs.append(ENTRY)
    m["name"] = m.get("name", "VibeMate") + " (Handy)"
    mp.write_text(json.dumps(m, indent=2), encoding="utf8")
    print(f"patched extension written to {dst}  (version {m.get('version')})")

main()
