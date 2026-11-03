#!/usr/bin/env node
/*
 * 2.6.17 (0047, WC-13 + WC-10): проверки панели гоняют свои файлы, а не весь набор,
 * и не держат в фикстурах литералы версий, которые краснеют на релизе.
 *
 * Сейчас panel-older.mjs c2 и engine-link.mjs c4 спавнят plugin/tools/test.mjs (≈113 с),
 * хотя проверяют карточку панели: два файла дают тот же сигнал за ≈40 с. Плюс в
 * engine-link.mjs фикстуры зашиты как 2.6.14/2.6.13/2.6.12/2.6.10 — при выпуске
 * очередной версии version-drift начинает краснеть (так и было на 2.6.14/2.6.15).
 *
 * Проверяется и текстом (нет tools/test.mjs, есть --test), и исполнением: оба
 * узких критерия обязаны остаться зелёными.
 * Вне пакета — SKIP (конвенция deployed-copy).
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PKG = path.resolve(HERE, '..', '..');

if (!fs.existsSync(path.join(PKG, 'spec'))) {
  console.log('SKIP: проверка пакета вне пакета');
  process.exit(0);
}

function truthy(value, label) {
  if (!value) throw new Error(label);
}

function code(file) {
  const raw = fs.readFileSync(path.join(PKG, 'spec', 'checks', file), 'utf8');
  return raw.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').map((line) => line.replace(/\/\/.*$/, '')).join('\n');
}

function c1() {
  const pairs = [
    ['panel-older.mjs', 'panel-older.test.mjs'],
    ['engine-link.mjs', 'engine-link.test.mjs'],
  ];
  for (const [file, ownTest] of pairs) {
    const text = code(file);
    truthy(!/tools['"]?\s*,\s*['"]test\.mjs/.test(text) && !/tools[\\/]test\.mjs/.test(text),
      file + ': всё ещё зовёт полный набор plugin/tools/test.mjs');
    truthy(text.includes('--test'), file + ': нет вызова node --test');
    truthy(text.includes(ownTest), file + ': нет своего файла тестов ' + ownTest);
    truthy(text.includes('client.test.mjs'), file + ': нет client.test.mjs в узком наборе');
  }
  console.log('NARROW OK c1');
}

function c2() {
  const text = code('engine-link.mjs');
  const literals = text.match(/['"]2\.\d+\.\d+['"]/g) || [];
  truthy(literals.length === 0, 'в engine-link.mjs остались версии-литералы: ' + [...new Set(literals)].join(', '));
  const titles = text.match(/['"]0\.\d+\.\d+[^'"]*['"]/g) || [];
  truthy(titles.length === 0, 'в engine-link.mjs остались версии плагина в названиях тестов: ' + [...new Set(titles)].join(', '));
  console.log('NARROW OK c2');
}

function c3() {
  const runs = [
    ['panel-older.mjs', 'c2', 900000],
    ['engine-link.mjs', 'c4', 900000],
  ];
  for (const [file, id, timeout] of runs) {
    const started = Date.now();
    const run = spawnSync(process.execPath, [path.join(PKG, 'spec', 'checks', file), id], {
      cwd: PKG, stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8', timeout,
    });
    const wall = Math.round((Date.now() - started) / 1000);
    truthy(run.status === 0, file + ' ' + id + ': exit ' + run.status + ' (' + wall + ' с); '
      + String(run.stdout || '').slice(-800) + String(run.stderr || '').slice(-400));
    console.log('  ' + file + ' ' + id + ': OK за ' + wall + ' с');
  }
  console.log('NARROW OK c3');
}

const table = { c1, c2, c3 };
const which = process.argv[2];
if (!table[which]) {
  console.log('usage: node spec/checks/narrow-suite.mjs c1|c2|c3');
  process.exit(2);
}
try {
  table[which]();
} catch (error) {
  console.log('NARROW FAIL ' + which + ': ' + (error && error.message ? error.message : error));
  process.exit(1);
}
