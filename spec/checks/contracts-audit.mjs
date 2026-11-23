#!/usr/bin/env node
/*
 * 2.6.106 (0127): аудит контрактов — кто проверяется отбором, кто вручную.
 *
 * Причина 5 замера structure: полный прогон на каждом шаге. tools/check-tests.mjs
 * (2.6.99) отбирает проверку по изменённым файлам, но контракты продолжают
 * прописывать набор тестов руками. Аудит показывает состояние и с --strict --since
 * не даёт новым заданиям возвращать долг.
 *
 * c1: ручной набор в области --since — отказ (код 1); отчёт называет задание.
 * c2: тот же контракт вне области --since — код 0; режимы и счётчики в JSON.
 *
 * Вне пакета — SKIP (конвенция deployed-copy).
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PKG = path.resolve(HERE, '..', '..');
const TOOL = path.join(PKG, 'tools', 'contract-tests-audit.mjs');

if (!fs.existsSync(path.join(PKG, 'spec'))) {
  console.log('SKIP: проверка пакета вне пакета');
  process.exit(0);
}

function truthy(value, label) {
  if (!value) throw new Error(label);
}

function run(cmd, args, cwd) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-audit-out-'));
  const outFile = path.join(dir, 'stdout');
  const errFile = path.join(dir, 'stderr');
  const ofd = fs.openSync(outFile, 'w');
  const efd = fs.openSync(errFile, 'w');
  let res;
  try {
    res = spawnSync(cmd, args, { cwd, timeout: 120000, windowsHide: true, stdio: ['ignore', ofd, efd] });
  } finally {
    try { fs.closeSync(ofd); } catch { /* ignore */ }
    try { fs.closeSync(efd); } catch { /* ignore */ }
  }
  let out = '';
  let err = '';
  try { out = fs.readFileSync(outFile, 'utf8'); } catch { /* ignore */ }
  try { err = fs.readFileSync(errFile, 'utf8'); } catch { /* ignore */ }
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
  return { code: res.status, out, err };
}
function write(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
}

function makeTasks() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-audit-tasks-'));
  const manual = { task: '0100', setup: [], teardown: [], redExpect: { mustFail: [], mustPass: [] }, criteria: [{ id: 'C1', command: 'node plugin/tools/test.mjs' }] };
  const adopted = { task: '0130', setup: [], teardown: [], redExpect: { mustFail: [], mustPass: [] }, criteria: [{ id: 'C1', command: 'node tools/check-tests.mjs' }] };
  write(path.join(root, '0100', 'criteria.json'), JSON.stringify(manual));
  write(path.join(root, '0130', 'criteria.json'), JSON.stringify(adopted));
  return root;
}

function c1() {
  const root = makeTasks();
  try {
    const strict = run(process.execPath, [TOOL, '--tasks', root, '--since', '0100', '--strict'], PKG);
    truthy(strict.code === 1, 'strict не отказал на ручном наборе в области --since (код ' + strict.code + ')');
    truthy(/0100/u.test(strict.out), 'отчёт не назвал задание 0100: ' + strict.out.slice(0, 400));
    truthy(/manual-tests|тесты вручную/u.test(strict.out), 'отчёт не объяснил причину');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
  console.log('AUDIT OK c1');
}

function c2() {
  const root = makeTasks();
  try {
    const outOfScope = run(process.execPath, [TOOL, '--tasks', root, '--since', '0130', '--strict'], PKG);
    truthy(outOfScope.code === 0, 'вне области --since должен быть код 0, получен ' + outOfScope.code);
    const json = run(process.execPath, [TOOL, '--tasks', root, '--since', '0130', '--json'], PKG);
    const parsed = JSON.parse(json.out);
    const byId = new Map(parsed.tasks.map((row) => [row.task, row]));
    truthy(byId.get('0100').mode === 'manual-tests', '0100 не помечен manual-tests: ' + JSON.stringify(byId.get('0100')));
    truthy(byId.get('0130').mode === 'check-tests', '0130 не помечен check-tests: ' + JSON.stringify(byId.get('0130')));
    truthy(parsed.violations.length === 0, 'вне области есть нарушения: ' + JSON.stringify(parsed.violations));
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
  console.log('AUDIT OK c2');
}

const table = { c1, c2 };
const which = process.argv[2];
if (!table[which]) {
  console.log('usage: node spec/checks/contracts-audit.mjs c1|c2');
  process.exit(2);
}
try {
  table[which]();
} catch (error) {
  console.log('AUDIT FAIL ' + which + ': ' + (error && error.message ? error.message : error));
  process.exit(1);
}
