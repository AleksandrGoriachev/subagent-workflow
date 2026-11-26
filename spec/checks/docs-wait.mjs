#!/usr/bin/env node
/*
 * 0173: ожидание узла графа описано честно.
 *   c1 — раздел есть, spawn/childId/wait/status названы;
 *   c2 — сказано, что job.mjs не ждёт узел, и названо требование к structure.
 * Вне пакета — SKIP (конвенция deployed-copy).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PKG = path.resolve(HERE, '..', '..');
if (!fs.existsSync(path.join(PKG, 'spec'))) { console.log('SKIP: проверка пакета вне пакета'); process.exit(0); }

const mode = String(process.argv[2] || '').toLowerCase();
let bad = 0;
function fail(tag, message) { bad += 1; console.log('FAIL ' + tag + ': ' + message); }
const doc = () => fs.readFileSync(path.join(PKG, 'INSTALL.md'), 'utf8');

if (mode === 'c1') {
  const text = doc();
  if (!/Ожидание узла графа/u.test(text)) fail('c1', 'в INSTALL нет раздела «Ожидание узла графа»');
  for (const needle of ['project_graph_spawn', 'childId', 'wait', 'status']) {
    if (!text.includes(needle)) fail('c1', 'не названо: ' + needle);
  }
  if (!/результат приходит сообщением/u.test(text)) fail('c1', 'не сказано, как приходит результат');
  if (bad === 0) console.log('DOCS-WAIT OK c1');
  process.exit(bad === 0 ? 0 : 1);
}

if (mode === 'c2') {
  const text = doc();
  if (!/сторож команд, а не узлов/u.test(text)) fail('c2', 'не сказано, что job.mjs — сторож команд, а не узлов');
  if (!/не знает `childId`/u.test(text)) fail('c2', 'не сказано, что job.mjs не знает childId');
  if (!/Требование к structure/u.test(text)) fail('c2', 'требование к structure не названо');
  if (!/без сна внутри инструмента/u.test(text)) fail('c2', 'требование не говорит про сон/таймаут');
  if (bad === 0) console.log('DOCS-WAIT OK c2');
  process.exit(bad === 0 ? 0 : 1);
}

console.log('usage: node spec/checks/docs-wait.mjs c1|c2');
process.exit(2);
