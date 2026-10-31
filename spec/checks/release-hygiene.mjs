#!/usr/bin/env node
/* Задание 0028: гигиена релиза (2.6.6).
 * A) фикстура gate-rules соответствует новому правилу covers (ERROR, не WARN);
 * B) tools/check-version.mjs сверяет версию плагина: расхождение package.json и compat.js — ошибка. */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PKG = path.resolve(HERE, '..', '..');
let failed = 0;
const pass = (n) => console.log('PASS ' + n);
const fail = (n, d) => { failed += 1; console.log('FAIL ' + n + (d ? ' — ' + d : '')); };
function run(cmd, args, cwd) { const r = spawnSync(cmd, args, { cwd, encoding: 'utf8', timeout: 900000 }); return { code: r.status, out: String(r.stdout || '') + String(r.stderr || '') }; }
function copyTree(from, to) {
  fs.mkdirSync(to, { recursive: true });
  for (const e of fs.readdirSync(from, { withFileTypes: true })) {
    if (['.git', 'node_modules', 'dist', '.tmp'].includes(e.name)) continue;
    const s = path.join(from, e.name), t = path.join(to, e.name);
    if (e.isDirectory()) copyTree(s, t); else if (e.isFile()) fs.copyFileSync(s, t);
  }
}

/* A. Штатная фикстура gate-rules зелёная. */
const gate = run(process.execPath, [path.join(PKG, 'spec', 'checks', 'gate-rules.mjs')], PKG);
if (gate.code === 0 && /GATE RULES OK/.test(gate.out)) pass('gate-rules: GATE RULES OK');
else fail('gate-rules: GATE RULES OK', 'exit=' + gate.code + ' ' + gate.out.trim().slice(-220));

/* B. check-version сверяет версию плагина. */
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-hygiene-'));
try {
  copyTree(PKG, path.join(tmp, 'pkg'));
  const pkgDir = path.join(tmp, 'pkg');
  const manifestPath = path.join(pkgDir, 'plugin', 'package.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const realVersion = manifest.version;
  manifest.version = '9.9.9';
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n', 'utf8');
  const bad = run(process.execPath, [path.join(pkgDir, 'tools', 'check-version.mjs')], pkgDir);
  if (bad.code !== 0 && /плагин/i.test(bad.out)) pass('check-version: расхождение версии плагина — ошибка');
  else fail('check-version: расхождение версии плагина — ошибка', 'exit=' + bad.code + ' ' + bad.out.trim().slice(-200));
  manifest.version = realVersion;
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n', 'utf8');
  const good = run(process.execPath, [path.join(pkgDir, 'tools', 'check-version.mjs')], pkgDir);
  if (good.code === 0) pass('check-version: согласованный манифест — ок');
  else fail('check-version: согласованный манифест — ок', good.out.trim().slice(-200));
} finally { fs.rmSync(tmp, { recursive: true, force: true }); }

if (failed > 0) { console.log(''); console.log('RELEASE HYGIENE FAIL: ' + failed); process.exit(1); }
console.log(''); console.log('RELEASE HYGIENE OK');