// Drives handy-shim.js exactly the way the vendor's Bluetooth class (U6 in console-*.js) does,
// against a mock Handy REST server.
import http from "node:http"; import assert from "node:assert/strict"; import fs from "node:fs";
import path from "node:path"; import { fileURLToPath } from "node:url"; import vm from "node:vm";
const here = path.dirname(fileURLToPath(import.meta.url));
const src = fs.readFileSync(path.join(here, "..", "extension", "handy", "handy-patch.js"), "utf8");

const calls = []; let online = true;
const srv = http.createServer((req, res) => {
  let b = ""; req.on("data", (d) => (b += d)); req.on("end", () => {
    calls.push({ m: req.method, p: req.url, key: req.headers["x-connection-key"], body: b ? JSON.parse(b) : undefined });
    res.setHeader("content-type", "application/json");
    if (req.url === "/hdsp/xpt") { const o = b ? JSON.parse(b) : {}; if (!("position" in o && "duration" in o && "stopOnTarget" in o)) { res.statusCode = 400; return res.end("{}"); } return res.end("{}"); }
    if (req.url === "/connected") return res.end(JSON.stringify({ result: { connected: online && req.headers["x-connection-key"] === "GOODKEY" } }));
    if (req.headers["x-connection-key"] !== "GOODKEY") { res.statusCode = 401; return res.end("{}"); }
    res.end("{}");
  });
});
await new Promise((r) => srv.listen(0, r)); const port = srv.address().port;

// minimal browser-ish globals for the shim
const ls = {}; const nav = {}; 
const ctx = vm.createContext({
  fetch, AbortController, EventTarget, Event, DOMException, TextEncoder, TextDecoder, Uint8Array, DataView, setTimeout, clearTimeout,
  Date, Math, JSON, Promise, console, Object, String, Number, Array, Set, Error, navigator: nav,
  localStorage: { getItem: (k) => ls[k] ?? null, setItem: (k, v) => (ls[k] = v) },
  document: undefined, __VM_HANDY_NO_INSTALL__: true,
});
ctx.globalThis = ctx;
vm.runInContext(src, ctx);
const H = ctx.__vmHandy;
H.install(nav);
const base = `http://127.0.0.1:${port}`;
let chosen = { type: "handy", cfg: { ...H.DEFAULTS, key: "GOODKEY", base3: base, api: "v3", minGapMs: 20, strokeMin: 0.1, strokeMax: 0.9, maxVelocity: 100 } };
ctx.__vmHandyChooser = () => Promise.resolve(chosen);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- vendor-equivalent helpers (copied behaviour from console-*.js / connect-*.js) ----
const enc = new TextEncoder(), dec = new TextDecoder();
const ls_ = (e) => { // the page's ls(): HLVS/FLVS -> binary bytes, others -> text
  const r = e.trim(), [n, ...i] = r.replace(/;$/, "").split(":"), s = i.map(Number);
  if (new Set(["HLVS", "FLVS"]).has(n) && s.length === 3 && s.every((o) => Number.isInteger(o) && o >= 0 && o <= 255))
    return new Uint8Array([...enc.encode(`${n}:`), ...s]);
  return enc.encode(r.endsWith(";") ? r : r + ";");
};
const DEVICE_RE = /^[A-Za-z]+:\d+:[0-9A-Za-z]+;$/; // Od() validation regex

// ---- Test button sequence 0 -> 50 -> 100 -> 50 -> 0 with body-format fallback ----
{
  const cl = new H.HandyClient({ ...H.DEFAULTS, key: "GOODKEY", base3: base, api: "v3", stepMs: 40, minGapMs: 20 });
  const steps = []; const t0 = Date.now();
  const seq = await H.runTest(cl, (pos, i) => steps.push([pos, i]));
  assert.equal(JSON.stringify(seq), "[0,50,100,50,0]");
  assert.equal(JSON.stringify(steps.map((x) => x[0])), "[0,50,100,50,0]");
  const seqCalls = calls.map((c) => c.p);
  assert.equal(JSON.stringify(seqCalls.filter((p) => p === "/mode")), '["/mode","/mode"]');
  const xpt = calls.filter((c) => c.p === "/hdsp/xpt" && c.body.position !== undefined);
  assert.equal(JSON.stringify(xpt.map((c) => c.body.position)), "[0,0.5,1,0.5,0]");
  assert.equal(calls.filter((c) => c.p === "/mode").map((c) => c.body.mode).join(), "2,0", "HDSP for test, back to HAMP after");
  assert.equal(cl.cfg.hdspBody, 1, "remembers the body variant that worked");
  assert.ok(Date.now() - t0 >= 4 * 40, "steps are spaced by stepMs");
  assert.equal(cl.busyTest, false);
  // a failing key surfaces as an error, not a hang
  const bad = new H.HandyClient({ ...H.DEFAULTS, key: "NOPE", base3: base, api: "v3", stepMs: 10 });
  await assert.rejects(() => H.runTest(bad), /401|offline/);
  calls.length = 0;
}

// ---- U6.search()/connect() equivalent ----
assert.equal(await nav.bluetooth.getAvailability(), true);
const dev = await nav.bluetooth.requestDevice({ filters: [{ services: ["6e400001-b5a3-f393-e0a9-e50e24dcca9e"] }] });
const gattEvents = []; dev.addEventListener("gattserverdisconnected", (e) => gattEvents.push(e.target.id));
const server = await dev.gatt.connect();
assert.deepEqual(calls.map((c) => c.m + " " + c.p), ["GET /connected", "PUT /mode", "PUT /slider/stroke"]);
assert.deepEqual(calls[2].body, { min: 0.1, max: 0.9 });
const [service] = await server.getPrimaryServices();
const chars = await service.getCharacteristics();
const sender = chars.find(({ properties: c }) => c.write || c.writeWithoutResponse);
const listener = chars.find(({ properties: c }) => c.notify);
assert.ok(sender && listener);
listener.addEventListener("characteristicvaluechanged", () => {}); await listener.startNotifications();

const ask = (cmd) => new Promise((resolve, reject) => { // sendCommandSync
  const t = setTimeout(() => reject("timeout"), 2000);
  const h = (y) => { clearTimeout(t); listener.removeEventListener("characteristicvaluechanged", h); resolve(dec.decode(y.target.value)); };
  listener.addEventListener("characteristicvaluechanged", h); sender.writeValue(ls_(cmd));
});

// ---- identification: must look like a Solace Pro ("BA") with firmware > 67 ----
const dt = await ask("DeviceType;");
assert.match(dt, DEVICE_RE); const [sym, fw, mac] = dt.replace(";", "").split(":");
assert.equal(sym, "BA"); assert.ok(+fw > 67); assert.equal(mac.length, 12); assert.ok(!mac.includes("GOODKEY"));
assert.equal(dev.id, "HANDYVIRT-" + mac);
assert.equal(Number((await ask("Battery;")).split(";")[0]), 100);

// ---- AI Sync special frame: HLVS (page ls() makes binary bytes) ----
calls.length = 0;
sender.writeValue(ls_("HLVS:55:0:100;")); await sleep(120);
assert.deepEqual(calls.map((c) => c.p + (c.body ? JSON.stringify(c.body) : "")), ["/hamp/start", '/hamp/velocity{"velocity":55}']);
calls.length = 0; sender.writeValue(ls_("HLVS:55:0:100;")); await sleep(60); assert.equal(calls.length, 0, "unchanged speed must not resend");
sender.writeValue(ls_("HLVS:80:0:100;")); sender.writeValue(ls_("HLVS:30:0:100;")); await sleep(120); // burst -> last wins
assert.deepEqual(calls.map((c) => c.body?.velocity), [30]);
sender.writeValue(ls_("HLVS:0:0:100;")); await sleep(80); assert.equal(calls.at(-1).p, "/hamp/stop");

// ---- non-special path: Thrusting/Depth level strings (what sendValue() emits for modes ["Depth","Thrusting"]) ----
calls.length = 0;
sender.writeValue(ls_("Depth:10;")); sender.writeValue(ls_("Thrusting:10;")); await sleep(120);
assert.deepEqual(calls.map((c) => c.p), ["/hamp/start", "/hamp/velocity"]); assert.equal(calls[1].body.velocity, 50);
sender.writeValue(ls_("Vibrate:0;")); await sleep(80); assert.equal(calls.at(-1).p, "/hamp/stop");

// ---- unknown query commands get an OK; never crash ----
assert.equal(await ask("Status:1;"), "OK;");

// ---- failure handling: 3 failed sends -> gattserverdisconnected ----
sender.writeValue(ls_("HLVS:40:0:100;")); await sleep(60);
srv.close(); srv.closeAllConnections?.();
for (let i = 0; i < 4; i++) { sender.writeValue(ls_(`HLVS:${50 + i}:0:100;`)); await sleep(120); }
await sleep(200);
assert.deepEqual(gattEvents, [dev.id]); assert.equal(server.connected, false);

// ---- vendor reconnect loop: connect() must reject while Handy unreachable, succeed when back ----
await assert.rejects(() => dev.gatt.connect());
const srv2 = http.createServer((req, res) => { res.setHeader("content-type", "application/json"); res.end(req.url === "/connected" ? '{"connected":true}' : "{}"); });
await new Promise((r) => srv2.listen(port, r));
await dev.gatt.connect(); assert.equal(server.connected, true);

// ---- manual disconnect fires the event like real GATT ----
gattEvents.length = 0; dev.gatt.disconnect(); await sleep(50); assert.deepEqual(gattEvents, [dev.id]);

// ---- cancel path -> NotFoundError (vendor treats it as "cancel") ----
chosen = { type: "cancel" };
await assert.rejects(() => nav.bluetooth.requestDevice({}), (e) => e.name === "NotFoundError");

// ---- pure decoder checks ----
const d = (s) => H.decodeWrite(typeof s === "string" ? enc.encode(s) : s, { gain: 1 });
assert.deepEqual(JSON.parse(JSON.stringify(d(new Uint8Array([...enc.encode("FLVS:"), 45, 0, 100])).map((x) => x.value))), [45]);
assert.equal(d("Thrusting:20;Depth:5;").length, 2);
assert.equal(d("garbage").length, 0);
console.log("shim: all assertions passed"); process.exit(0);
