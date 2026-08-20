#!/usr/bin/env node
/**
 * selftest.mjs - proves app.enc can actually be opened by the browser code.
 *
 *   node tools/selftest.mjs
 *
 * This does not re-implement the reader. It lifts the real unseal() function
 * out of index.html and runs it against the real app.enc using WebCrypto and
 * DecompressionStream - the same two APIs the browser uses - then checks the
 * result against src/app.html character for character.
 */
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(resolve(ROOT, p));

for (const f of ['index.html', 'app.enc', 'manifest.json', 'src/app.html', 'tools/.appkey']) {
  if (!existsSync(resolve(ROOT, f))) {
    console.error(`missing ${f}`);
    process.exit(1);
  }
}

// ---- lift the shipped reader out of the gate page --------------------------
const gate = read('index.html').toString('utf8');
const match = gate.match(/async function unseal\(bytes, key, onProgress\) \{[\s\S]*?\n\}/);
if (!match) {
  console.error('could not find unseal() in index.html - did the gate change shape?');
  process.exit(1);
}
const MAGIC = new TextEncoder().encode('BWAPPENC');
const unseal = new Function('MAGIC', 'return ' + match[0])(MAGIC);
console.log('\n  lifted unseal() from index.html (' + match[0].length + ' chars)');

// ---- run it exactly as the browser would -----------------------------------
const keyBytes = Buffer.from(read('tools/.appkey').toString('utf8').trim(), 'base64');
const key = await crypto.subtle.importKey('raw', keyBytes, 'AES-GCM', false, ['decrypt']);

const sealed = new Uint8Array(read('app.enc'));
const manifest = JSON.parse(read('manifest.json').toString('utf8'));
console.log(`  app.enc ${(sealed.length / 1048576).toFixed(2)} MB, build ${manifest.build}`);

let last = 0;
const t0 = process.hrtime.bigint();
const html = await unseal(sealed, key, (f) => {
  if (f - last >= 0.25 || f === 1) { last = f; process.stdout.write(`  unsealing ${Math.round(f * 100)}%\n`); }
});
const ms = Number(process.hrtime.bigint() - t0) / 1e6;

// ---- compare against the source -------------------------------------------
let source = read('src/app.html').toString('utf8');
if (source.charCodeAt(0) === 0xfeff) source = source.slice(1);

if (html !== source) {
  console.error(`\n  FAILED - output differs (${html.length} chars vs ${source.length} expected)\n`);
  process.exit(1);
}

const ok = [
  ['manifest byte count matches app.enc', manifest.bytes === sealed.length],
  ['recovered document opens with a doctype', /^<!DOCTYPE html>/i.test(html.trim())],
  ['recovered document is complete', html.trimEnd().endsWith('</html>')],
];
let bad = 0;
console.log('');
for (const [label, pass] of ok) {
  console.log(`  ${pass ? 'ok  ' : 'FAIL'}  ${label}`);
  if (!pass) bad++;
}
console.log(`  ok    unsealed ${html.length.toLocaleString()} characters in ${ms.toFixed(0)} ms`);
console.log(bad ? '\n  SELFTEST FAILED\n' : '\n  SELFTEST PASSED - the published gate can open the published payload.\n');
process.exit(bad ? 1 : 0);
