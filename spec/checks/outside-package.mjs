#!/usr/bin/env node
/*
 * Проверка инварианта 0012: проверка пакета, запущенная вне пакета, печатает SKIP и
 * выходит 0 — для ВСЕХ проверок, а не для двух.
 *
 * --negative: подменяет одну проверку на заведомо падающую и требует, чтобы её
 * отличили от SKIP. Иначе «всё SKIP» можно получить, поймав любую ошибку.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PKG = path.resolve(HERE, '..', '..');
const SELF = path.basename(fileURLToPath(import.meta.url));
/* Задание 0035: вне пакета каталога spec нет — развёрнутая копия печатает SKIP и выходит 0.
 * Meta-проверка не исключение: deployed-copy прогоняет её наравне с остальными. */
if (!fs.existsSync(path.join(PKG, 'spec'))) {
  console.log('SKIP: проверка пакета вне пакета');
  process.exit(0);
}
const NEGATIVE = process.argv.includes('--negative');

function copyTree(from, to) {
  fs.mkdirSync(to, { recursive: true });
  for (const e of fs.readdirSync(from, { withFileTypes: true })) {
    const s = path.join(from, e.name), t = path.join(to, e.name);
    if (e.isDirectory()) copyTree(s, t); else if (e.isFile()) fs.copyFileSync(s, t);
  }
}

function classify(file, cwd) {
  const r = spawnSync(process.execPath, [file], { cwd, encoding: 'utf8', timeout: 300000 });
  const out = String(r.stdout || '') + String(r.stderr || '');
  return { code: r.status, skip: r.status === 0 && /SKIP/.test(out), tail: out.trim().split('\n').slice(-2).join(' / ') };
}

const fake = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-outside-'));
try {
  const engine = path.join(fake, 'docs', 'subagent-workflow');
  copyTree(path.join(PKG, 'spec', 'scripts'), path.join(engine, 'scripts'));
  copyTree(path.join(PKG, 'spec', 'checks'), path.join(engine, 'checks'));
  const names = fs.readdirSync(path.join(engine, 'checks')).filter((n) => n.endsWith('.mjs') && n !== SELF).sort();

  if (NEGATIVE) {
    const victim = names[0];
    fs.writeFileSync(path.join(engine, 'checks', victim), "console.error('boom: сломанная проверка'); process.exit(3);\n");
    const got = classify(path.join(engine, 'checks', victim), fake);
    if (got.skip) { console.log('NEGATIVE FAIL: сломанная проверка принята за SKIP — guard глушит ошибки'); process.exit(1); }
    console.log('NEGATIVE OK: сломанная проверка отличена от SKIP (exit ' + got.code + ')');
    process.exit(0);
  }

  const bad = [];
  for (const name of names) {
    const got = classify(path.join(engine, 'checks', name), fake);
    if (!got.skip) bad.push(name + ' (exit ' + got.code + ': ' + got.tail.slice(0, 90) + ')');
  }
  if (bad.length === 0) {
    console.log('OUTSIDE-PACKAGE OK: ' + names.length + ' проверок печатают SKIP вне пакета');
    process.exit(0);
  }
  console.log('OUTSIDE-PACKAGE FAIL: ' + bad.length + ' из ' + names.length + ' не печатают SKIP');
  for (const line of bad) console.log('  ' + line);
  process.exit(1);
} finally {
  try { fs.rmSync(fake, { recursive: true, force: true }); } catch {}
}