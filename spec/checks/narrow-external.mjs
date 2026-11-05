#!/usr/bin/env node
/*
 * 2.6.17 (0048, WC-23): последняя проверка панели, которая гоняла весь набор, гоняет свой файл.
 *
 * external-engine.mjs c2 проверяет текст карточки в client.js и наличие теста в
 * client.test.mjs — ровно этот файл и нужно прогнать. Полный plugin/tools/test.mjs
 * (122 с) здесь ничего не добавляет к сигналу, но стоит в каждом прогоне ворот.
 *
 * Проверяется и текстом (нет tools/test.mjs, есть --test), и исполнением узкого критерия.
 * Вне пакета — SKIP (конвенция deployed-copy).
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSyncPipeFree } from '../scripts/lib/common.mjs';
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
  const text = code('external-engine.mjs');
  truthy(!/tools['"]?\s*,\s*['"]test\.mjs/.test(text) && !/tools[\\/]test\.mjs/.test(text),
    'external-engine.mjs: всё ещё зовёт полный набор plugin/tools/test.mjs');
  truthy(text.includes('--test'), 'external-engine.mjs: нет вызова node --test');
  truthy(text.includes('client.test.mjs'), 'external-engine.mjs: узкий набор не называет client.test.mjs');
  console.log('NARROW-EXT OK c1');
}

function c2() {
  const started = Date.now();
  const run = spawnSyncPipeFree(process.execPath, [path.join(PKG, 'spec', 'checks', 'external-engine.mjs'), 'c2'], {
    cwd: PKG, encoding: 'utf8', timeout: 900000,
  });
  const wall = Math.round((Date.now() - started) / 1000);
  truthy(run.status === 0, 'external-engine.mjs c2: exit ' + run.status + ' (' + wall + ' с); '
    + String(run.stdout || '').slice(-900) + String(run.stderr || '').slice(-400));
  truthy(String(run.stdout || '').includes('EXTERNAL-ENGINE OK c2'), 'external-engine.mjs c2: нет OK-строки');
  console.log('NARROW-EXT OK c2 (external-engine c2 за ' + wall + ' с)');
}

const table = { c1, c2 };
const which = process.argv[2];
if (!table[which]) {
  console.log('usage: node spec/checks/narrow-external.mjs c1|c2');
  process.exit(2);
}
try {
  table[which]();
} catch (error) {
  console.log('NARROW-EXT FAIL ' + which + ': ' + (error && error.message ? error.message : error));
  process.exit(1);
}
