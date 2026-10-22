#!/usr/bin/env node
// node tools/aisync-probe.mjs [ws-url] [image.jpg]
// Connects to a RUNNING ai-sync.exe, prints decrypted replies, optionally sends one JPEG for detection.
import fs from "node:fs";
import { decrypt, request, URL_DEFAULT, parseRow } from "./aisync-codec.mjs";
const url = process.argv[2] || URL_DEFAULT, img = process.argv[3];
const ws = new WebSocket(url);
ws.onopen = () => {
  console.log("connected", url);
  ws.send(request("app_info"));
  if (img) ws.send(request("detect_image", { image: fs.readFileSync(img).toString("base64") }, 5));
  setTimeout(() => process.exit(0), 5000);
};
ws.onmessage = (e) => { try { const m = decrypt(String(e.data)); console.log(JSON.stringify(m, null, 1)); if (m.data) console.log("rows:", m.data.map(parseRow)); } catch (err) { console.log("undecodable:", String(e.data).slice(0, 80), err.message); } };
ws.onerror = () => { console.error("cannot connect — is ai-sync.exe running? (VibeMate launches it via lovenseaisync://)"); process.exit(1); };
