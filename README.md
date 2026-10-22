# VibeMate × The Handy — patch kit (VibeMate 1.5.7)

One file, `extension/handy/handy-patch.js`, makes VibeMate see your **Handy as a connected Solace Pro**, so
AI Sync, Auto, Pattern, Sound, Model Sync and Off all work with it using the extension's own logic. The file converts
the Solace Pro commands to the Handy's Wi-Fi (connection-key) REST API. No Python is needed.

## Install
1. Easiest: load the ready-made folder `VibeMate-Handy-1.5.7_0/` (Chrome → `chrome://extensions` → Developer mode →
   disable the Web Store VibeMate → *Load unpacked*).
   Or do it by hand in your own unpacked copy: copy `extension/handy/handy-patch.js` to `<ext>/handy/` and add this to
   `content_scripts` in `manifest.json`:
   ```json
   { "matches": ["*://*.fanberry.com/extension/*/connect.html*", "*://*.vibemate.com/extension/*/connect.html*"],
     "js": ["handy/handy-patch.js"], "run_at": "document_start", "world": "MAIN" }
   ```
   (`patch-extension.py` does the same automatically if you prefer; delete `_metadata/` from the copy.)
2. Optional but recommended: `node tools/probe-handy.mjs <connection-key>` — moves the Handy briefly and prints every API reply.
3. In VibeMate: connect toy → **Connect via Bluetooth** → the Handy panel appears:
   paste your connection key → **Test** (0 → 50 → 100 → 50 → 0 %, one step per second) → **Connect**.
   The page now shows a connected Solace Pro; pick AI Sync / Pattern / Sound / Auto / Model Sync as usual.

## How it works
```
video tab ──frame(JPEG)──► extension ──► fanberry background page ──BroadcastChannel──► connect window
                                                                                         │
 ai-sync.exe  ◄── ws://localhost:29991/ai_sync/v1  (detect_image, base64 JPEG) ──────────┤
              ──► AES-128-CBC JSON {data:["x,y,w,h,conf,part,flag"…], cls:[…]} ──────────┤
                                  VideoFinderAI → level 0–20 → per-toy command (Solace Pro: HLVS) 
                                                                                         ▼
                                          navigator.bluetooth  ← handy-patch.js wraps this
                                          virtual GATT "Solace Pro" ──► Handy REST (HAMP)
```
* `ai-sync.exe` is **only** a local image classifier (OpenVINO; scene classes in `cls_best.yaml`, body parts in
  `part_detection.yaml`). It never touches a toy, so nothing in it needs changing.
* The connect window must stay on `www.fanberry.com` (same-origin BroadcastChannel `FANBERRY_CHANNEL` to the
  background page; page CSP only allows fanberry/cdn.lovense scripts). That is why the shim is a MAIN-world
  **content script** (exempt from page CSP) rather than an edit of the vendor chunks.
* The shim answers the Lovense text protocol: `DeviceType;` → `BA:100:<12-hex>;` (symbol BA = Solace Pro,
  firmware 100 > 67 ⇒ page uses the `HLVS` path, ≤ 67 would use `FLVS`), `Battery;` → `100;`.
  Writes handled: binary `HLVS:`/`FLVS:` + `[speed,start,end]`, and `Thrusting:n;` `Vibrate:n;` `Depth:n;`.
  Speed (0–100) → Handy HAMP velocity %, levels (0–20) → ×5. Stroke range is set once at connect from your settings
  (the page always sends 0–100 stroke, so it is ignored).
* The Handy's toy id/MAC is a hash of the key — **never the key itself** (the stock page reports toy MACs to Lovense servers).

## Reverse-engineering notes
| Item | Finding |
|---|---|
| AI Sync endpoint | `ws://localhost:29991/ai_sync/v1?from=cam`; exe takes `--port=`; launched by `lovenseaisync://` |
| Requests | JSON `{"msg-id","msg-type","module"}`; `detect_image` = module 5 + base64 JPEG (≤800 px); also `check_update`, `setup_newer` |
| Replies | base64 AES-128-CBC/PKCS7, key `3d4ab4b0bb42dd54`, iv `262ef81aafa7a095` (hard-coded in `console-*.js`); see `tools/aisync-codec.mjs` |
| Detection rows | `x,y,w,h,conf,partClass,flag` (partClass index = `part_detection.yaml`) — field meanings inferred from the page's parser |
| Toy transport | Web Bluetooth (first primary service, first writable + notify characteristic, text commands) or HID USB dongle (VID 6421/PID 21002 and 6790/58409) |
| Toy codes | `H` Solace, `BA` Solace Pro, `F`/`FS` mini sex machine, `EA` gravity (special converters); everything else gets plain levels |

## Configuration (`localStorage["vm_handy_cfg"]` on www.fanberry.com)
`key, appId, base, strokeMin, strokeMax, gain, maxVelocity, minGapMs, firmware` — defaults in `handy-patch.js`.

## Tests run here (all green)
`node test/shim.test.mjs` — drives the patch (incl. the Test sequence and body-variant fallback) exactly like the vendor Bluetooth class (search → GATT → DeviceType → HLVS/Thrusting
→ coalescing → failure/reconnect → cancel) against a mock Handy server. `node test/codec.test.mjs` — AI Sync AES codec.

## NOT verified — please read
* **Handy REST paths/bodies** (`/mode`, `/hamp/*`, `/slider/stroke`, `/connected`, header `X-Connection-Key`, optional
  `Authorization: Bearer <appId>`) are from memory of API v3; the official docs could not be fetched. Use `probe-handy.mjs`.
* **Position moves (Test button)**: body field names are uncertain, so the Test tries three variants
  (`{xp,t,stop_on_target}` first — the names Buttplug uses for the Handy 2/2 Pro v3 protocol — then two alternatives) and remembers the one
  the API accepts. `stop_on_target` is sent as `false`: Buttplug issue #893 reports `true` makes rising strokes finish early on Handy 2 / 2 Pro.
* **Handy 2 Pro specifics** (any API/firmware differences, whether it has a battery or a different connection flow) are unconfirmed.
* Not run against real Chrome, the live VibeMate site, `ai-sync.exe` (Windows binary), or a real Handy.
* Whether the live config marks `BA` with the exact label "Solace Pro" (UI shows that name for your Handy, battery shows a fixed 100 %).
* HLVS speed→velocity is a 1:1 assumption; tune with `gain`.
* The connect-window URL pattern `…/extension/<ver>/connect.html` comes from your saved page; adjust `matches` if different.
* A remembered key sits in the fanberry.com origin's localStorage (the checkbox is optional).
* VibeMate updates replace nothing here (unpacked copy), but you will not receive its updates; re-patch the new version instead.

## Troubleshooting: "Could not connect: HTTP 401 /connected"

A 401 means the Handy server rejected the request's credentials, not that your key is wrong.
The v3 API may require an **Application ID** (sent as `Authorization: Bearer <id>`) in addition to the
connection key (`X-Connection-Key`). The panel now has:

- an **Application ID** field (leave empty if you have none),
- a **Diagnose connection** button that tries v3/v2 × several auth styles against `/connected`
  and shows which one the server accepts (it then selects that combination automatically),
- error messages that include the HTTP status and the server's own reply text.

The API version is `auto` (v3, then v2 — v2 is firmware 3 only). If Diagnose shows ✗ for everything,
paste its output (and the auth / `/connected` / HAMP / HDSP / HSP pages of the public Handy docs) so the
endpoint table in `handy-patch.js` (`EP`, `PROFILES`) can be corrected.

Tests: `node test/shim.test.mjs && node test/auth.test.mjs && node test/codec.test.mjs`
