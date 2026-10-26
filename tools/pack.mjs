#!/usr/bin/env node
/*
 * Сборка переносимого пакета: zip без зависимостей (store), manifest.json и
 * CHECKSUMS.sha256 внутри, sha256 архива рядом.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const VERSION = fs.readFileSync(path.join(ROOT, 'VERSION'), 'utf8').trim();
const NAME = 'subagent-workflow';
const DIR = NAME + '-' + VERSION;
const DIST = path.join(ROOT, 'dist');
const EXCLUDE_DIRS = new Set(['dist', 'reports', 'node_modules', '.git', '.tmp', '.idea', '.vscode', 'keys', 'plugin']);
const EXCLUDE_FILES = [/^.DS_Store$/, /\.log$/i, /\.key\.pem$/];

function collect(dir, rel = '', out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (EXCLUDE_DIRS.has(entry.name)) continue;
    const relPath = rel ? rel + '/' + entry.name : entry.name;
    if (entry.isDirectory()) collect(path.join(dir, entry.name), relPath, out);
    else if (!EXCLUDE_FILES.some((re) => re.test(entry.name))) out.push(relPath);
  }
  return out;
}

function sha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

const files = collect(ROOT).sort();
const contents = files.map((rel) => ({ path: rel, data: fs.readFileSync(path.join(ROOT, rel)) }));

const manifest = {
  name: NAME,
  version: VERSION,
  builtAt: new Date().toISOString(),
  node: process.version,
  entrypoints: {
    install: 'INSTALL.md',
    deploy: 'deploy/AGENT-DEPLOY.md',
    spec: 'spec/SPEC.md',
    init: 'spec/scripts/init.mjs',
    doctor: 'spec/scripts/doctor.mjs',
    selftest: 'spec/selftest.mjs',
    e2e: 'spec/e2e.mjs',
    e2eDeploy: 'spec/e2e-deploy.mjs',
    attack: 'spec/scripts/task-attack.mjs',
  },
  harnesses: ['dsh', 'generic', 'ci'],
  files: contents.map((file) => ({ path: file.path, bytes: file.data.length, sha256: sha256(file.data) })),
};
const manifestData = Buffer.from(JSON.stringify(manifest, null, 2) + '\n');
contents.push({ path: 'manifest.json', data: manifestData });

const checksums = contents
  .map((file) => sha256(file.data) + '  ' + file.path)
  .join('\n') + '\n';
contents.push({ path: 'CHECKSUMS.sha256', data: Buffer.from(checksums) });

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i += 1) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

const DOS_DATE = ((2026 - 1980) << 9) | (10 << 5) | 25;
const DOS_TIME = 0;
const locals = [];
const centrals = [];
let offset = 0;

for (const file of contents) {
  const name = Buffer.from(DIR + '/' + file.path, 'utf8');
  const crc = crc32(file.data);
  const size = file.data.length;

  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4);
  local.writeUInt16LE(0x0800, 6);
  local.writeUInt16LE(0, 8);
  local.writeUInt16LE(DOS_TIME, 10);
  local.writeUInt16LE(DOS_DATE, 12);
  local.writeUInt32LE(crc, 14);
  local.writeUInt32LE(size, 18);
  local.writeUInt32LE(size, 22);
  local.writeUInt16LE(name.length, 26);
  local.writeUInt16LE(0, 28);
  locals.push(local, name, file.data);

  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(20, 4);
  central.writeUInt16LE(20, 6);
  central.writeUInt16LE(0x0800, 8);
  central.writeUInt16LE(0, 10);
  central.writeUInt16LE(DOS_TIME, 12);
  central.writeUInt16LE(DOS_DATE, 14);
  central.writeUInt32LE(crc, 16);
  central.writeUInt32LE(size, 20);
  central.writeUInt32LE(size, 24);
  central.writeUInt16LE(name.length, 28);
  central.writeUInt16LE(0, 30);
  central.writeUInt16LE(0, 32);
  central.writeUInt16LE(0, 34);
  central.writeUInt16LE(0, 36);
  central.writeUInt32LE(0, 38);
  central.writeUInt32LE(offset, 42);
  centrals.push(central, name);

  offset += local.length + name.length + size;
}

const centralData = Buffer.concat(centrals);
const eocd = Buffer.alloc(22);
eocd.writeUInt32LE(0x06054b50, 0);
eocd.writeUInt16LE(0, 4);
eocd.writeUInt16LE(0, 6);
eocd.writeUInt16LE(contents.length, 8);
eocd.writeUInt16LE(contents.length, 10);
eocd.writeUInt32LE(centralData.length, 12);
eocd.writeUInt32LE(offset, 16);
eocd.writeUInt16LE(0, 20);

const archive = Buffer.concat([...locals, centralData, eocd]);
fs.mkdirSync(DIST, { recursive: true });
const zipPath = path.join(DIST, DIR + '.zip');
fs.writeFileSync(zipPath, archive);
const digest = sha256(archive);
fs.writeFileSync(zipPath + '.sha256', digest + '  ' + DIR + '.zip\n');

console.log('pack: ' + path.relative(ROOT, zipPath));
console.log('  files   ' + contents.length);
console.log('  bytes   ' + archive.length + ' (zip, store)');
console.log('  sha256  ' + digest);
