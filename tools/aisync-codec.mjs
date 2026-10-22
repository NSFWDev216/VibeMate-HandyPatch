// Lovense AI Sync local protocol (as used by VibeMate's console-*.js, class W6):
//   ws://localhost:29991/ai_sync/v1?from=cam      (port comes from ai-sync.exe --port=; default 29991)
//   client -> exe : plain JSON  {"msg-id":<uuid>,"msg-type":<string>,"module":0|5,...}
//                   e.g. {"msg-type":"detect_image","module":5,"image":"<base64 jpeg, no data: prefix>"}
//   exe -> client : AES-128-CBC / PKCS7, base64 text, key/iv are the 16-char UTF-8 strings below,
//                   plaintext = JSON (possibly JSON-encoded twice)
import crypto from "node:crypto";
export const KEY = "3d4ab4b0bb42dd54", IV = "262ef81aafa7a095";
export const URL_DEFAULT = "ws://localhost:29991/ai_sync/v1?from=cam";
export function decrypt(b64) {
  const d = crypto.createDecipheriv("aes-128-cbc", Buffer.from(KEY, "utf8"), Buffer.from(IV, "utf8"));
  const txt = Buffer.concat([d.update(Buffer.from(b64, "base64")), d.final()]).toString("utf8");
  const j = JSON.parse(txt);
  return typeof j === "string" ? JSON.parse(j) : j;
}
export function encrypt(obj) { // for tests / fake servers
  const c = crypto.createCipheriv("aes-128-cbc", Buffer.from(KEY, "utf8"), Buffer.from(IV, "utf8"));
  return Buffer.concat([c.update(JSON.stringify(obj), "utf8"), c.final()]).toString("base64");
}
export function request(type, extra = {}, module = 0) {
  return JSON.stringify({ "msg-id": crypto.randomUUID(), "msg-type": type, module, ...extra });
}
/** exe detection row: "x,y,w,h,confidence,partClass,flag"; part classes follow part_detection.yaml
 *  0 Chest 1 penis 2 anus 3 pussy 4 butt 5 hand 6 mouth 7 foot 8 glans; frame also has cls[] (scene classes from cls_best.yaml) */
export function parseRow(s) { const [x, y, w, h, conf, cls, flag] = s.split(",").map(Number); return { x, y, w, h, conf, cls, flag }; }
