#!/usr/bin/env node
/**
 * genkey.mjs — create the master vault key for the Bible Web App.
 *
 * Run this ONCE.  It writes a 256-bit random key to tools/.appkey (git-ignored)
 * and prints the base64 form that you paste into Firestore at vault/app.k
 *
 *   node tools/genkey.mjs           # create the key (refuses to overwrite)
 *   node tools/genkey.mjs --show    # print the existing key again
 *   node tools/genkey.mjs --force   # replace the key (invalidates app.enc)
 */
import { randomBytes } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const KEYFILE = resolve(ROOT, 'tools/.appkey');
const args = process.argv.slice(2);

if (args.includes('--show')) {
  if (!existsSync(KEYFILE)) {
    console.error('No key yet. Run:  node tools/genkey.mjs');
    process.exit(1);
  }
  console.log(readFileSync(KEYFILE, 'utf8').trim());
  process.exit(0);
}

if (existsSync(KEYFILE) && !args.includes('--force')) {
  console.error('A key already exists at tools/.appkey');
  console.error('Use --show to print it, or --force to replace it.');
  console.error('WARNING: replacing the key means every user must be given the new');
  console.error('Firestore value, and app.enc must be rebuilt.');
  process.exit(1);
}

const key = randomBytes(32).toString('base64');
writeFileSync(KEYFILE, key + '\n', { mode: 0o600 });

console.log('');
console.log('  Vault key created ->  tools/.appkey   (git-ignored, never commit it)');
console.log('');
console.log('  Paste this exact string into Firestore:');
console.log('     collection: vault      document: app      field: k   (string)');
console.log('');
console.log('     ' + key);
console.log('');
console.log('  Keep an offline backup. Lose it and app.enc can never be opened again.');
console.log('');
