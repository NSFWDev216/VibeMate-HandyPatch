// Auth / API-version negotiation: 401 detail, Diagnose, v2 fallback, stroke call shape.
import http from "node:http"; import vm from "node:vm"; import fs from "node:fs"; import assert from "node:assert/strict";
import path from "node:path"; import { fileURLToPath } from "node:url";
const here = path.dirname(fileURLToPath(import.meta.url));
const src = fs.readFileSync(path.join(here, "..", "extension", "handy", "handy-patch.js"), "utf8");

let rule = () => true; const seen = [];
const srv = http.createServer((req, res) => {
  let b = ""; req.on("data", (d) => (b += d)); req.on("end", () => {
    const m = /^\/(v2|v3)(\/.*)$/.exec(req.url); const h = req.headers;
    seen.push({ v: m && m[1], p: m && m[2], auth: h.authorization, key: h["x-connection-key"], body: b ? JSON.parse(b) : undefined });
    res.setHeader("content-type", "application/json");
    if (!m) { res.statusCode = 404; return res.end("{}"); }
    if (!rule(m[1], h)) { res.statusCode = 401; return res.end('{"error":{"message":"missing or invalid application id"}}'); }
    res.end(m[2] === "/connected" ? '{"result":{"connected":true}}' : "{}");
  });
});
await new Promise((r) => srv.listen(0, r)); const port = srv.address().port;
const ctx = vm.createContext({ fetch, AbortController, EventTarget, Event, DOMException, TextEncoder, TextDecoder, Uint8Array, DataView, setTimeout, clearTimeout,
  Date, Math, JSON, Promise, console, Object, String, Number, Array, Set, Error, navigator: {}, localStorage: { getItem: () => null, setItem() {} }, document: undefined, __VM_HANDY_NO_INSTALL__: true });
ctx.globalThis = ctx; vm.runInContext(src, ctx); const H = ctx.__vmHandy;
const cfg = (o = {}) => ({ ...H.DEFAULTS, key: "KEY123", base3: `http://127.0.0.1:${port}/v3`, base2: `http://127.0.0.1:${port}/v2`, ...o });
const j = (x) => JSON.parse(JSON.stringify(x));

// 1. v3 needs "Authorization: Bearer APP1"; no app id -> error carries status + server text + hint
rule = (v, h) => v === "v3" ? h.authorization === "Bearer APP1" : false;
let err; try { await new H.HandyClient(cfg({ api: "v3" })).check(); } catch (e) { err = e.message; }
assert.match(err, /401 \/connected/); assert.match(err, /application id/i); assert.match(err, /Application ID/);
// 2. with the app id it connects, and sends both headers
seen.length = 0; assert.equal(await new H.HandyClient(cfg({ api: "v3", appId: "APP1" })).check(), "v3");
assert.equal(seen[0].auth, "Bearer APP1"); assert.equal(seen[0].key, "KEY123");
// 3. Diagnose finds the working combination (needs the app id)
let d = await H.diagnose(cfg({ appId: "APP1" })); assert.equal(d.found.api, "v3"); assert.equal(d.found.authMode, "key");
d = await H.diagnose(cfg()); assert.equal(d.found, null); assert.ok(d.lines.every((l) => l.startsWith("✗")));
// 4. key must be sent as bearer
rule = (v, h) => v === "v3" && h.authorization === "Bearer KEY123";
d = await H.diagnose(cfg()); assert.equal(d.found.authMode, "bearerKey");
let c = new H.HandyClient(cfg({ api: "v3", authMode: "bearerKey" })); assert.equal(await c.check(), "v3");
assert.equal(seen.at(-1).key, undefined, "bearerKey mode must not also send X-Connection-Key");
// 5. only v2 answers -> auto falls back to v2 and uses the v2 slide endpoint (0..100)
rule = (v) => v === "v2";
c = new H.HandyClient(cfg({ api: "auto", strokeMin: 0.1, strokeMax: 0.9 })); await c.connect(); assert.equal(c.profile, "v2");
const sl = seen.find((s) => s.p === "/slide"); assert.deepEqual(j(sl.body), { min: 10, max: 90 });
d = await H.diagnose(cfg()); assert.equal(d.found.api, "v2");
// 6. v3 stroke call shape (regression: used to be sent as a malformed request)
rule = () => true; seen.length = 0; c = new H.HandyClient(cfg({ api: "v3", strokeMin: 0.2, strokeMax: 0.8 })); await c.connect();
const st = seen.find((s) => s.p === "/slider/stroke"); assert.equal(st.v, "v3"); assert.deepEqual(j(st.body), { min: 0.2, max: 0.8 });
console.log("auth: all assertions passed"); srv.close(); process.exit(0);
