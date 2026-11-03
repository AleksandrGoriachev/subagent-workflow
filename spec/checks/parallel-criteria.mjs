#!/usr/bin/env node
/*
 * 2.6.17 (0045, WC-12): независимые критерии ворот идут параллельно.
 *
 * 0041: три прогона ворот по 189 с при max(критерий) = 115 с — 74 с на каждом прогоне
 * чистой суммы. Критерии не делят состояние (runCheck уже изолирует временные корни),
 * поэтому их можно вести параллельно, сохраняя порядок и вывод по ID.
 *
 * Проверяется исполнением пула: три команды по 1,2 с обязаны уложиться в 2,5 с (а не в 3,6),
 * порядок результатов — как в списке, падение одного не отменяет остальные.
 * Вне пакета — SKIP (конвенция deployed-copy).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PKG = path.resolve(HERE, '..', '..');

if (!fs.existsSync(path.join(PKG, 'spec'))) {
  console.log('SKIP: проверка пакета вне пакета');
  process.exit(0);
}

function truthy(value, label) {
  if (!value) throw new Error(label);
}

const common = await import(pathToFileURL(path.join(PKG, 'spec', 'scripts', 'lib', 'common.mjs')).href);
const sleepCmd = (ms) => 'node -e "setTimeout(function(){}, ' + ms + ')"';

function pool(criteria, options) {
  truthy(typeof common.runCriteria === 'function', 'в common.mjs нет runCriteria');
  return common.runCriteria(criteria, { repo: PKG, env: { ...process.env }, timeoutMs: 60000, ...options });
}

async function c1() {
  const criteria = [
    { id: 'A', command: sleepCmd(1200) },
    { id: 'B', command: sleepCmd(1200) },
    { id: 'C', command: sleepCmd(1200) },
  ];
  const started = Date.now();
  const rows = await pool(criteria, { concurrency: 3 });
  const wall = Date.now() - started;
  truthy(rows.length === 3, 'строк ' + rows.length + ', ожидалось 3');
  truthy(rows.map((r) => r.id).join(',') === 'A,B,C', 'порядок нарушен: ' + rows.map((r) => r.id).join(','));
  truthy(rows.every((r) => r.exitCode === 0), 'не все exit 0: ' + JSON.stringify(rows.map((r) => [r.id, r.exitCode])));
  truthy(wall < 2500, 'последовательно, а не параллельно: ' + wall + ' мс (ожидалось < 2500)');
  console.log('PARALLEL OK c1 (' + wall + ' мс на три по 1200 мс)');
}

async function c2() {
  const criteria = [
    { id: 'A', command: sleepCmd(200) },
    { id: 'B', command: 'node -e "process.exit(3)"' },
    { id: 'C', command: sleepCmd(200) },
  ];
  const rows = await pool(criteria, { concurrency: 2 });
  truthy(rows.length === 3, 'строк ' + rows.length);
  const b = rows.find((r) => r.id === 'B');
  truthy(b && b.exitCode === 3, 'падение B не проброшено: ' + JSON.stringify(b && b.exitCode));
  truthy(rows.find((r) => r.id === 'A').exitCode === 0, 'A не выполнился после падения B');
  truthy(rows.find((r) => r.id === 'C').exitCode === 0, 'C не выполнился после падения B');
  console.log('PARALLEL OK c2');
}

async function c3() {
  const gates = ['task-red.mjs', 'task-verify.mjs', 'task-accept.mjs'];
  const { execFileSync } = await import('node:child_process');
  for (const gate of gates) {
    const file = path.join(PKG, 'spec', 'scripts', gate);
    truthy(fs.existsSync(file), 'нет ' + gate);
    const text = fs.readFileSync(file, 'utf8');
    truthy(/runCriteria/u.test(text), gate + ' не использует runCriteria');
    const syntax = execFileSync(process.execPath, ['--check', file], { encoding: 'utf8' });
    void syntax;
  }
  console.log('PARALLEL OK c3');
}

const table = { c1, c2, c3 };
const which = process.argv[2];
if (!table[which]) {
  console.log('usage: node spec/checks/parallel-criteria.mjs c1|c2|c3');
  process.exit(2);
}
try {
  await table[which]();
} catch (error) {
  console.log('PARALLEL FAIL ' + which + ': ' + (error && error.message ? error.message : error));
  process.exit(1);
}
