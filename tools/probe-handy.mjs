#!/usr/bin/env node
// node tools/probe-handy.mjs <connection-key> [applicationId]
// !! This WILL start your Handy briefly (velocity 20 for 2 s, then stop). Keep it clear of anything.
// Prints status + body of every call so you can confirm/correct the endpoint table (EP) in handy-patch.js.
const [key, appId] = process.argv.slice(2);
if (!key) { console.error("usage: probe-handy.mjs <connection-key> [applicationId]"); process.exit(1); }
const BASE = process.env.HANDY_BASE || "https://www.handyfeeling.com/api/handy-rest/v3";
const steps = [
  ["GET", "/connected"], ["PUT", "/mode", { mode: 0 }], ["PUT", "/slider/stroke", { min: 0.2, max: 0.8 }],
  ["PUT", "/hamp/start"], ["PUT", "/hamp/velocity", { velocity: 20 }], ["WAIT", 2000], ["PUT", "/hamp/stop"],
  // position moves (Test button): try each body variant, expect at least one 2xx
  ["PUT", "/mode", { mode: 2 }],
  ["PUT", "/hdsp/xpt", { xp: 0.5, t: 800, stop_on_target: false }],
  ["PUT", "/hdsp/xpt", { position: 0.5, duration: 800, stopOnTarget: false }],
  ["PUT", "/hdsp/xpt", { percentagePosition: 50, duration: 800, stopOnTarget: false }],
  ["WAIT", 1000], ["PUT", "/mode", { mode: 0 }],
];
for (const [m, p, b] of steps) {
  if (m === "WAIT") { await new Promise((r) => setTimeout(r, p)); continue; }
  const h = { "Content-Type": "application/json", "X-Connection-Key": key, ...(appId ? { Authorization: "Bearer " + appId } : {}) };
  try {
    const r = await fetch(BASE + p, { method: m, headers: h, body: b ? JSON.stringify(b) : undefined });
    console.log(m, p, b ? JSON.stringify(b) : "", "->", r.status, (await r.text()).slice(0, 300));
  } catch (e) { console.log(m, p, "-> ERROR", e.message); }
}
