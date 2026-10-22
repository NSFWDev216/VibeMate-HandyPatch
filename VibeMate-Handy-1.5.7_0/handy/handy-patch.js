/* VibeMate × The Handy — "handy-patch.js"
 *
 * Emulates a Solace Pro over Web Bluetooth so the stock VibeMate AI Sync / Auto / Pattern / Sound /
 * Model Sync / Off logic runs unchanged, and converts the Solace Pro commands it sends into
 * The Handy's Wi-Fi (connection-key) REST API.
 *
 * Load as a MAIN-world content script on the connect window (see README / manifest snippet):
 *   { "matches": ["*://*.fanberry.com/extension/*\/connect.html*"], "js": ["handy/handy-patch.js"],
 *     "run_at": "document_start", "world": "MAIN" }
 *
 * UX: in the connect window choose "Connect via Bluetooth" -> a panel asks for the Handy connection key
 *     with [Connect] and [Test] (Test moves 0 -> 50 -> 100 -> 50 -> 0 %, one step per second).
 *     After [Connect] the page sees a connected "Solace Pro" and every mode works as usual.
 *
 * Emulated Solace Pro protocol (what the page sends / expects):
 *   DeviceType; -> "BA:<fw>:<12 hex>;"   Battery; -> "100;"
 *   HLVS:/FLVS: + bytes [speed,start,end]   Thrusting:n;  Depth:n;  Vibrate:n;
 *
 * !! Handy REST paths/bodies (EP / HDSP_BODIES) follow API v3 as best known and could not be checked
 * !! against the official docs from the build sandbox; the Test button auto-tries body variants and
 * !! reports what worked. Run tools/probe-handy.mjs if anything is rejected.
 * Privacy: toy id/MAC are a hash of the key; the key is only sent to the Handy API.
 */
(() => {
  "use strict";
  if (globalThis.__vmHandy) return;

  const LS = { cfg: "vm_handy_cfg" };
  const DEFAULTS = {
    key: "", appId: "",
    api: "auto", // "auto" tries v3 then v2; or force "v3" / "v2"
    authMode: "key", // "key" = X-Connection-Key (+ Bearer appId if set) | "keyOnly" | "bearerKey" (Authorization: Bearer <key>)
    base3: "https://www.handyfeeling.com/api/handy-rest/v3",
    base2: "https://www.handyfeeling.com/api/handy/v2",
    strokeMin: 0, strokeMax: 1, // slider range 0..1 for velocity (HAMP) mode
    gain: 1, // multiplies HLVS speed / Thrusting level before clamping
    maxVelocity: 100, // hard cap, percent
    minGapMs: 200, timeoutMs: 5000, maxFails: 3,
    firmware: 100, // >67 => page uses the HLVS ("normal") Solace Pro path
    stepMs: 1000, // Test button: time between position updates
    hdspBody: 0, // index into HDSP_BODIES remembered after the first success
  };
  const EP = { // identical paths in v2 and v3 except the stroke/slide range (see PROFILES)
    connected: ["GET", "/connected"],
    mode: ["PUT", "/mode"], // {mode:n}  HAMP=0, HDSP=2
    hampStart: ["PUT", "/hamp/start"],
    hampStop: ["PUT", "/hamp/stop"],
    hampVelocity: ["PUT", "/hamp/velocity"], // {velocity:0..100}
    hdspXpt: ["PUT", "/hdsp/xpt"], // move to percent position over a time
  };
  const MODE = { HAMP: 0, HDSP: 2 };
  // v3 (firmware 4+/Handy 2, needs an Application ID) vs v2 (connection key only). Positions: v3 0..1, v2 0..100.
  const PROFILES = {
    v3: {
      baseKey: "base3",
      stroke: (min, max) => ["PUT", "/slider/stroke", { min, max }],
      hdsp: [ // candidate bodies, tried in order until one is accepted
        (p, ms) => ({ xp: p / 100, t: ms, stop_on_target: false }),
        (p, ms) => ({ position: p / 100, duration: ms, stopOnTarget: false }),
      ],
    },
    v2: {
      baseKey: "base2",
      stroke: (min, max) => ["PUT", "/slide", { min: Math.round(min * 100), max: Math.round(max * 100) }],
      hdsp: [(p, ms) => ({ position: p, duration: ms, stopOnTarget: false, immediateResponse: true })],
    },
  };

  const loadCfg = () => { try { return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(LS.cfg) || "{}") }; } catch { return { ...DEFAULTS }; } };
  const saveCfg = (c) => { try { localStorage.setItem(LS.cfg, JSON.stringify(c)); } catch {} };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
  const fnv = (s, seed = 2166136261) => {
    let h = seed >>> 0;
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
    return h.toString(16).toUpperCase().padStart(8, "0");
  };

  /* ------------------------------ Handy REST client ------------------------------ */
  class HandyClient {
    constructor(cfg) {
      this.cfg = cfg; this.running = false; this.lastVelocity = -1;
      this.pending = null; this.pumping = false; this.lastSentAt = 0; this.fails = 0;
      this.generation = 0; this.onFail = null; this.busyTest = false; this.profile = null;
    }
    get P() { return PROFILES[this.profile || "v3"]; }
    async req(ep, body) {
      const [method, path] = ep;
      const headers = { "Content-Type": "application/json" };
      const mode = this.cfg.authMode || "key";
      if (mode === "bearerKey") headers.Authorization = "Bearer " + this.cfg.key;
      else { headers["X-Connection-Key"] = this.cfg.key; if (mode === "key" && this.cfg.appId) headers.Authorization = "Bearer " + this.cfg.appId; }
      const ac = new AbortController();
      const t = setTimeout(() => ac.abort(), this.cfg.timeoutMs);
      try {
        const res = await fetch(this.cfg[this.P.baseKey] + path, { method, headers, signal: ac.signal, body: body === undefined ? undefined : JSON.stringify(body) });
        if (!res.ok) {
          let detail = ""; try { detail = (await res.text()).replace(/\s+/g, " ").slice(0, 160); } catch {}
          const e = new Error("HTTP " + res.status + " " + path + (detail ? " — " + detail : "")); e.status = res.status; throw e;
        }
        const text = await res.text();
        try { return text ? JSON.parse(text) : {}; } catch { return {}; }
      } finally { clearTimeout(t); }
    }
    /** Is the Handy online for this key? Picks the API version (auto: v3, then v2). Throws with details if not. */
    async check() {
      const order = this.cfg.api === "v2" ? ["v2"] : this.cfg.api === "v3" ? ["v3"] : ["v3", "v2"];
      const errs = []; let authHint = false;
      for (const name of order) {
        this.profile = name;
        try {
          const r = await this.req(EP.connected);
          const flag = r && (r.connected ?? (r.result && r.result.connected));
          if (flag === false) throw new Error("Handy offline (is it powered and on Wi-Fi? is the key right?)");
          return name;
        } catch (e) { errs.push(name + ": " + e.message); if (e.status === 401 || e.status === 403) authHint = true; }
      }
      this.profile = null;
      throw new Error(errs.join("  |  ") + (authHint && !this.cfg.appId ? "  —  API v3 needs an Application ID (Settings)" : ""));
    }
    async setMode(n) { await this.req(EP.mode, { mode: n }); }
    async connect() { // used by gatt.connect(): verify + velocity (HAMP) mode + stroke range
      await this.check();
      try { await this.setMode(MODE.HAMP); } catch {} // non-fatal: hamp/start also selects the mode on current firmware
      try { const [m, path, body] = this.P.stroke(clamp(+this.cfg.strokeMin, 0, 1), clamp(+this.cfg.strokeMax, 0, 1)); await this.req([m, path], body); } catch {}
      this.running = false; this.lastVelocity = -1; this.fails = 0;
    }
    /** Move to position p (0..100 %) over ms; tolerant of body-format differences. */
    async moveTo(p, ms) {
      const bodies = this.P.hdsp, n = bodies.length; let lastErr;
      const start = this.profile === "v3" ? this.cfg.hdspBody % n : 0;
      for (let k = 0; k < n; k++) {
        const i = (start + k) % n;
        try {
          await this.req(EP.hdspXpt, bodies[i](p, ms));
          if (this.profile === "v3" && i !== this.cfg.hdspBody) { this.cfg.hdspBody = i; const c = loadCfg(); c.hdspBody = i; saveCfg(c); }
          return i;
        } catch (e) { lastErr = e; if (!e.status || e.status >= 500) break; }
      }
      throw lastErr;
    }
    setVelocity(v) {
      this.pending = clamp(Math.round(v), 0, clamp(+this.cfg.maxVelocity || 100, 1, 100));
      this.pump();
    }
    async pump() {
      if (this.pumping || this.busyTest) return;
      this.pumping = true; const gen = this.generation;
      try {
        await 0; // coalesce synchronous bursts (last wins)
        while (this.pending !== null && gen === this.generation) {
          const first = this.pending; this.pending = null;
          const wait = this.cfg.minGapMs - (Date.now() - this.lastSentAt);
          if (wait > 0) await sleep(wait);
          if (gen !== this.generation) break;
          const target = this.pending !== null ? this.pending : first; this.pending = null;
          try {
            if (target === 0) {
              if (this.running) { await this.req(EP.hampStop); this.running = false; this.lastVelocity = 0; }
            } else {
              if (!this.running) { await this.req(EP.hampStart); this.running = true; this.lastVelocity = -1; }
              if (target !== this.lastVelocity) { await this.req(EP.hampVelocity, { velocity: target }); this.lastVelocity = target; }
            }
            this.fails = 0;
          } catch {
            if (++this.fails >= this.cfg.maxFails) { this.generation++; this.pending = null; this.running = false; this.onFail && this.onFail(); break; }
          }
          this.lastSentAt = Date.now();
        }
      } finally { this.pumping = false; }
    }
    async stop() {
      this.generation++; this.pending = null;
      while (this.pumping) await sleep(10);
      if (this.running) { try { await this.req(EP.hampStop); } catch {} }
      this.running = false; this.lastVelocity = 0;
    }
  }

  /** Try every plausible API-version / auth-header combination on GET /connected. Returns {lines, found}. */
  async function diagnose(cfg) {
    const modes = [["key", cfg.appId ? "X-Connection-Key + Bearer <Application ID>" : "X-Connection-Key"],
      ...(cfg.appId ? [["keyOnly", "X-Connection-Key only (no Application ID)"]] : []),
      ["bearerKey", "Authorization: Bearer <connection key>"]];
    const lines = []; let found = null;
    for (const api of ["v3", "v2"]) for (const [authMode, note] of modes) {
      const cl = new HandyClient({ ...cfg, api, authMode, timeoutMs: 6000 }); cl.profile = api;
      try {
        const r = await cl.req(EP.connected);
        const flag = r && (r.connected ?? (r.result && r.result.connected));
        lines.push(`${flag === false ? "•" : "✓"} ${api} · ${note}: ${flag === false ? "server accepted the request but reports the Handy OFFLINE" : "OK"} ${JSON.stringify(r).slice(0, 70)}`);
        if (flag !== false && !found) found = { api, authMode, note };
      } catch (e) { lines.push(`✗ ${api} · ${note}: ${e.message}`); }
    }
    return { lines, found };
  }

  /** Test sequence: 0 -> 50 -> 100 -> 50 -> 0 (%), one update per stepMs. onStep(pos, i) for UI. */
  async function runTest(client, onStep = () => {}) {
    const seq = [0, 50, 100, 50, 0], step = +client.cfg.stepMs || 1000;
    client.busyTest = true;
    try {
      await client.stop();
      await client.check();
      try { await client.setMode(MODE.HDSP); } catch (e) { onStep(null, -1, "mode switch failed: " + e.message); }
      for (let i = 0; i < seq.length; i++) {
        onStep(seq[i], i);
        await client.moveTo(seq[i], step);
        if (i < seq.length - 1) await sleep(step);
      }
      await sleep(Math.min(step, 500)); // let the last move finish
    } finally {
      try { await client.setMode(MODE.HAMP); } catch {}
      client.running = false; client.lastVelocity = -1; client.busyTest = false;
    }
    return seq;
  }

  /* ------------------- Lovense text protocol -> Handy translation ------------------- */
  const TEXT = new TextEncoder(), UTF8 = new TextDecoder();
  const startsWithAscii = (u8, s) => s.length <= u8.length && [...s].every((c, i) => u8[i] === c.charCodeAt(0));

  /** Decode one write from the page into [{kind, value}] (value = Handy velocity %). */
  function decodeWrite(u8, cfg) {
    const out = []; const gain = +cfg.gain || 1;
    if ((startsWithAscii(u8, "HLVS:") || startsWithAscii(u8, "FLVS:")) && u8.length === 8) {
      out.push({ kind: "speed", value: u8[5] * gain, start: u8[6], end: u8[7] });
      return out;
    }
    const text = UTF8.decode(u8);
    for (const part of text.split(";")) {
      const m = /^\s*([A-Za-z0-9]+)\s*:\s*(\d+)\s*$/.exec(part);
      if (!m) continue;
      const name = m[1].toLowerCase(), n = +m[2];
      if (name === "thrusting" || /^vibrate\d?$/.test(name) || name === "pump") out.push({ kind: "level", value: (n / 20) * 100 * gain });
      else if (name === "depth") out.push({ kind: "depth", value: n });
    }
    return out;
  }

  /* ------------------------- Virtual GATT device (Solace Pro) ------------------------- */
  function createVirtualToy(cfg, hooks = {}) {
    const mac = fnv(cfg.key) + fnv(cfg.key, 97).slice(0, 4); // 12 hex chars, not the key
    const id = "HANDYVIRT-" + mac;
    const client = hooks.client || new HandyClient(cfg);
    const device = new EventTarget(); const svc = {}; const chr = new EventTarget();
    chr.properties = { write: true, writeWithoutResponse: true, notify: true, read: false };
    chr.value = null;
    const notify = (str) => setTimeout(() => {
      chr.value = new DataView(TEXT.encode(str).buffer);
      chr.dispatchEvent(new Event("characteristicvaluechanged"));
    }, 5);
    chr.startNotifications = async () => chr;
    chr.stopNotifications = async () => chr;
    chr.writeValue = async (buf) => {
      const u8 = buf instanceof Uint8Array ? buf : new Uint8Array(buf.buffer ? buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) : buf);
      hooks.onWrite && hooks.onWrite(u8);
      const asText = (() => { try { return UTF8.decode(u8); } catch { return ""; } })();
      if (asText === "DeviceType;") return notify(`BA:${cfg.firmware}:${mac};`);
      if (asText === "Battery;") return notify("100;"); // placeholder: the Wi-Fi API path exposes no battery
      const cmds = decodeWrite(u8, cfg);
      for (const c of cmds) if (c.kind === "speed" || c.kind === "level") client.setVelocity(c.value);
      // "depth" ignored: stroke length is set once via strokeMin/strokeMax
      if (!cmds.length && asText.endsWith(";")) notify("OK;"); // acknowledge unknown queries; never stall sendCommandSync()
    };
    svc.getCharacteristics = async () => [chr];
    let connected = false;
    const server = {
      get connected() { return connected; }, device,
      async connect() { if (!connected) { await client.connect(); connected = true; } return server; },
      async getPrimaryServices() { return [svc]; },
      disconnect() {
        if (!connected) return;
        connected = false;
        client.stop().finally(() => device.dispatchEvent(new Event("gattserverdisconnected")));
      },
    };
    client.onFail = () => { if (connected) { connected = false; device.dispatchEvent(new Event("gattserverdisconnected")); } };
    device.id = id; device.name = "Handy"; device.gatt = server;
    return { device, client, chr, mac };
  }

  /* ------------------- Panel: key box + Connect + Test (shadow DOM) ------------------- */
  function panel(canReal) {
    if (typeof globalThis.__vmHandyChooser === "function") return globalThis.__vmHandyChooser(canReal); // test hook
    return new Promise((resolve) => {
      const host = document.createElement("div");
      host.style.cssText = "position:fixed;inset:0;z-index:2147483647";
      const root = host.attachShadow({ mode: "closed" });
      const cfg = loadCfg();
      const esc = (s) => String(s).replace(/[&"<>]/g, (c) => ({ "&": "&amp;", '"': "&quot;", "<": "&lt;", ">": "&gt;" }[c]));
      root.innerHTML = `
        <style>
          .bg{position:absolute;inset:0;background:rgba(0,0,0,.65);display:flex;align-items:center;justify-content:center;font:14px system-ui,sans-serif}
          .card{background:#1e1e24;color:#eee;border-radius:14px;padding:20px;width:min(380px,92vw);box-shadow:0 8px 40px #000}
          h3{margin:0 0 4px;font-size:16px} p{margin:0 0 8px;opacity:.7;font-size:12px}
          label{display:block;margin:10px 0 4px;font-size:12px;opacity:.8}
          input[type=text],input[type=password]{width:100%;box-sizing:border-box;padding:8px;border-radius:8px;border:1px solid #444;background:#111;color:#fff}
          .row{display:flex;gap:8px} .row>*{flex:1}
          button{width:100%;margin-top:10px;padding:10px;border:0;border-radius:999px;font-weight:600;cursor:pointer;color:#fff;background:#5A4EFF}
          button.alt{background:#34343c} button.x{background:none;color:#aaa;margin-top:4px} button:disabled{opacity:.5;cursor:default}
          #st{min-height:34px;margin-top:10px;font-size:12px;white-space:pre-wrap} .ok{color:#31d858} .bad{color:#f53f3f}
          details{margin-top:8px;font-size:12px} summary{cursor:pointer;opacity:.8}
        </style>
        <div class="bg"><div class="card">
          <h3>Connect The Handy</h3><p>Wi-Fi connection key (shown in the Handy app / handyfeeling.com)</p>
          <input id="key" type="password" autocomplete="off" spellcheck="false" placeholder="Connection key" value="${esc(cfg.key)}">
          <label>Application ID <span style="opacity:.6">(needed by API v3 / newest firmware)</span></label>
          <input id="app" type="password" autocomplete="off" spellcheck="false" placeholder="Application ID (optional)" value="${esc(cfg.appId)}">
          <div class="row"><button id="connect">Connect</button><button class="alt" id="test">Test</button></div>
          <button class="alt" id="diag" style="margin-top:6px">Diagnose connection</button>
          <div id="st">Test moves the Handy 0 → 50 → 100 → 50 → 0 %, one step per second.</div>
          <details><summary>Settings</summary>
            <div class="row"><div><label>Stroke min (0–1)</label><input id="smin" type="text" value="${esc(cfg.strokeMin)}"></div>
            <div><label>Stroke max (0–1)</label><input id="smax" type="text" value="${esc(cfg.strokeMax)}"></div></div>
            <label>Max speed (%)</label><input id="maxv" type="text" value="${esc(cfg.maxVelocity)}">
            <label>API version</label><select id="api" style="width:100%;padding:8px;border-radius:8px;background:#111;color:#fff;border:1px solid #444"><option value="auto">Auto (v3, then v2)</option><option value="v3">v3 only</option><option value="v2">v2 only</option></select>
            <label style="display:flex;gap:8px;align-items:center"><input id="rem" type="checkbox" ${cfg.key ? "checked" : ""}> Remember key (readable by fanberry.com page scripts)</label>
          </details>
          ${canReal ? '<button class="alt" id="real">Use a normal Bluetooth toy instead</button>' : ""}
          <button class="x" id="cancel">Cancel</button>
        </div></div>`;
      const $ = (s) => root.querySelector(s);
      const st = (msg, cls = "") => { const e = $("#st"); e.textContent = msg; e.className = cls; };
      $("#api").value = cfg.api || "auto";
      const read = () => ({ ...cfg, key: $("#key").value.trim(), appId: $("#app").value.trim(), api: $("#api").value,
        strokeMin: clamp(parseFloat($("#smin").value) || 0, 0, 1), strokeMax: $("#smax").value.trim() === "" ? 1 : clamp(parseFloat($("#smax").value), 0, 1),
        maxVelocity: clamp(parseFloat($("#maxv").value) || 100, 1, 100) });
      const lock = (v) => { ["#connect", "#test", "#diag"].forEach((s) => ($(s).disabled = v)); };
      const done = (v) => { host.remove(); resolve(v); };
      const persist = (c) => saveCfg($("#rem").checked ? c : { ...c, key: "" });
      $("#connect").onclick = async () => {
        const c = read(); if (!c.key) return $("#key").focus();
        lock(true); st("Connecting…");
        try { const v = await new HandyClient(c).check(); persist(c); st("Connected ✓ (API " + v + ")", "ok"); await sleep(300); done({ type: "handy", cfg: c }); }
        catch (e) { st("Could not connect: " + (e.message || e) + "\n→ press Diagnose connection", "bad"); lock(false); }
      };
      $("#diag").onclick = async () => {
        const c = read(); if (!c.key) return $("#key").focus();
        lock(true); st("Checking how the Handy API accepts this key…");
        try {
          const { lines, found } = await diagnose(c);
          if (found) { cfg.authMode = found.authMode; cfg.api = found.api; $("#api").value = found.api; persist({ ...c, api: found.api, authMode: found.authMode }); lines.push("\nWill use: " + found.api + " · " + found.note + ". Press Connect."); }
          else lines.push("\nNothing was accepted. 401 everywhere usually means a missing/invalid Application ID (fill it in) or a wrong key.");
          st(lines.join("\n"), found ? "ok" : "bad");
        } catch (e) { st("Diagnose failed: " + (e.message || e), "bad"); }
        lock(false);
      };
      $("#test").onclick = async () => {
        const c = read(); if (!c.key) return $("#key").focus();
        lock(true); st("Testing…");
        const cl = new HandyClient(c);
        try {
          const seq = await runTest(cl, (pos, i, note) => st(note || `Step ${i + 1}/5 → ${pos} %`));
          persist(cl.cfg); st("Test finished ✓ (" + seq.join(" → ") + " %). Press Connect to use it.", "ok");
        } catch (e) { st("Test failed: " + (e.message || e), "bad"); }
        lock(false);
      };
      if (canReal) $("#real").onclick = () => done({ type: "real" });
      $("#cancel").onclick = () => done({ type: "cancel" });
      document.documentElement.appendChild(host);
    });
  }

  /* --------------------------- navigator.bluetooth wrapper --------------------------- */
  const toys = new Set();
  function install(nav = navigator) {
    const orig = nav.bluetooth;
    const wrapper = {
      async getAvailability() { return true; },
      async requestDevice(opts) {
        const pick = await panel(!!(orig && orig.requestDevice));
        if (pick.type === "real") return orig.requestDevice(opts);
        if (pick.type === "handy") { const t = createVirtualToy(pick.cfg); toys.add(t); return t.device; }
        throw new DOMException("User cancelled the requestDevice() chooser.", "NotFoundError");
      },
      async getDevices() { return orig && orig.getDevices ? orig.getDevices() : []; },
      addEventListener(...a) { return orig && orig.addEventListener && orig.addEventListener(...a); },
      removeEventListener(...a) { return orig && orig.removeEventListener && orig.removeEventListener(...a); },
    };
    Object.defineProperty(nav, "bluetooth", { value: wrapper, configurable: true });
  }

  globalThis.__vmHandy = { HandyClient, createVirtualToy, decodeWrite, runTest, diagnose, install, EP, DEFAULTS, PROFILES, toys };
  if (typeof navigator !== "undefined" && typeof document !== "undefined" && !globalThis.__VM_HANDY_NO_INSTALL__) install();
})();
