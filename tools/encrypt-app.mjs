#!/usr/bin/env node
/**
 * encrypt-app.mjs — turn src/app.html into the public, unreadable app.enc
 *
 *   node tools/encrypt-app.mjs
 *   node tools/encrypt-app.mjs --level 6      (faster build, slightly bigger file)
 *
 * Run this after EVERY edit to src/app.html, then commit app.enc + manifest.json.
 * src/app.html itself must never be committed - .gitignore already blocks it.
 *
 * Container layout (little-endian), matching the reader inside index.html:
 *
 *   0   8   magic  "BWAPPENC"
 *   8   1   version (1)
 *   9   1   flags   bit0 = payload is gzip-compressed
 *   10  2   reserved (0)
 *   12  4   chunk count
 *   16  4   chunk size used when splitting the compressed payload
 *   20  ..  repeated chunks:
 *             4   ciphertext length (includes the 16-byte GCM tag)
 *             12  initialisation vector
 *             n   AES-256-GCM ciphertext || tag
 *
 * Every chunk is sealed with additional authenticated data of
 * magic || chunkIndex, so chunks cannot be reordered, dropped, or spliced in
 * from another build without the decryption failing outright.
 */
import { readFileSync, writeFileSync, existsSync, statSync } from 'node:fs';
import { gzipSync, gunzipSync } from 'node:zlib';
import { randomBytes, createCipheriv, createDecipheriv, createHash } from 'node:crypto';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = resolve(ROOT, 'src/app.html');
const OUT = resolve(ROOT, 'app.enc');
const MANIFEST = resolve(ROOT, 'manifest.json');
const KEYFILE = resolve(ROOT, 'tools/.appkey');

const MAGIC = Buffer.from('BWAPPENC', 'ascii');
const VERSION = 1;
const FLAG_GZIP = 1;
const CHUNK = 1024 * 1024; // 1 MiB of compressed data per sealed chunk

const args = process.argv.slice(2);
const levelArg = args.indexOf('--level');
const level = levelArg === -1 ? 9 : Number(args[levelArg + 1]);

const mb = (n) => (n / 1048576).toFixed(2) + ' MB';
const step = (msg) => process.stdout.write('  ' + msg + '\n');

// ---------------------------------------------------------------- key + source
if (!existsSync(SRC)) {
  console.error('Missing src/app.html - that is the plaintext app this script seals.');
  process.exit(1);
}
const keyB64 = (process.env.APP_KEY_B64 || (existsSync(KEYFILE) ? readFileSync(KEYFILE, 'utf8') : '')).trim();
if (!keyB64) {
  console.error('No vault key found. Run:  node tools/genkey.mjs');
  process.exit(1);
}
const key = Buffer.from(keyB64, 'base64');
if (key.length !== 32) {
  console.error(`Vault key must decode to 32 bytes, got ${key.length}.`);
  process.exit(1);
}

console.log('\nSealing the Bible Web App\n');

let html = readFileSync(SRC, 'utf8');
if (html.charCodeAt(0) === 0xfeff) html = html.slice(1); // drop the BOM
const plain = Buffer.from(html, 'utf8');
step(`source      ${mb(statSync(SRC).size)}  (src/app.html)`);

// ---------------------------------------------------------------- compress
const t0 = Date.now();
const packed = gzipSync(plain, { level });
step(`compressed  ${mb(packed.length)}  (level ${level}, ${((Date.now() - t0) / 1000).toFixed(1)}s)`);

// ---------------------------------------------------------------- encrypt
const chunkCount = Math.ceil(packed.length / CHUNK) || 1;
const header = Buffer.alloc(20);
MAGIC.copy(header, 0);
header.writeUInt8(VERSION, 8);
header.writeUInt8(FLAG_GZIP, 9);
header.writeUInt16LE(0, 10);
header.writeUInt32LE(chunkCount, 12);
header.writeUInt32LE(CHUNK, 16);

const parts = [header];
for (let i = 0; i < chunkCount; i++) {
  const slice = packed.subarray(i * CHUNK, Math.min((i + 1) * CHUNK, packed.length));
  const iv = randomBytes(12);
  const aad = Buffer.concat([MAGIC, Buffer.alloc(4)]);
  aad.writeUInt32LE(i, 8);

  const cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(aad);
  const body = Buffer.concat([cipher.update(slice), cipher.final(), cipher.getAuthTag()]);

  const len = Buffer.alloc(4);
  len.writeUInt32LE(body.length, 0);
  parts.push(len, iv, body);
}
const sealed = Buffer.concat(parts);
step(`encrypted   ${mb(sealed.length)}  (AES-256-GCM, ${chunkCount} sealed chunks)`);

// ---------------------------------------------------------------- verify
// Decrypt what we just wrote, exactly the way the browser will, and prove it
// matches the source byte for byte. A build that cannot be reopened is worse
// than no build at all.
{
  let off = 20;
  const out = [];
  for (let i = 0; i < chunkCount; i++) {
    const len = sealed.readUInt32LE(off); off += 4;
    const iv = sealed.subarray(off, off + 12); off += 12;
    const body = sealed.subarray(off, off + len); off += len;
    const aad = Buffer.concat([MAGIC, Buffer.alloc(4)]);
    aad.writeUInt32LE(i, 8);
    const d = createDecipheriv('aes-256-gcm', key, iv);
    d.setAAD(aad);
    d.setAuthTag(body.subarray(body.length - 16));
    out.push(Buffer.concat([d.update(body.subarray(0, body.length - 16)), d.final()]));
  }
  const back = gunzipSync(Buffer.concat(out));
  if (!back.equals(plain)) {
    console.error('\nVERIFY FAILED - round trip did not reproduce the source. Nothing written.');
    process.exit(1);
  }
  step('verified    round trip reproduces src/app.html exactly');
}

// ---------------------------------------------------------------- write
const build = createHash('sha256').update(sealed).digest('hex').slice(0, 12);
writeFileSync(OUT, sealed);
writeFileSync(MANIFEST, JSON.stringify({
  build,
  bytes: sealed.length,
  chunks: chunkCount,
  created: new Date().toISOString(),
}, null, 2) + '\n');

console.log('');
step(`build id    ${build}`);
step(`wrote       app.enc, manifest.json`);
console.log('\n  Next:  git add app.enc manifest.json  ->  commit  ->  push\n');
