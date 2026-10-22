import assert from "node:assert/strict"; import { encrypt, decrypt, parseRow } from "../tools/aisync-codec.mjs";
const sample = { "msg-type": "detect_image", size: 1, data: ["120.00,80.00,60.00,40.00,0.91,1,1"], cls: [0.1, 0.9], image_size: [640, 360], time: 12 };
assert.deepEqual(decrypt(encrypt(sample)), sample);
assert.deepEqual(decrypt(encrypt(JSON.stringify(sample))), sample); // double-encoded form the vendor also accepts
assert.deepEqual(parseRow(sample.data[0]), { x: 120, y: 80, w: 60, h: 40, conf: 0.91, cls: 1, flag: 1 });
console.log("codec: ok");
