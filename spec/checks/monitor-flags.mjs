#!/usr/bin/env node
/*
 * 2.6.108 (0133): флаг повторов не поднимается на нормальной задаче.
 *
 * 2.6.107 считал повтором total>1, а базовый принятый пакет — это red+verify+accept,
 * то есть 3 строки: флаг получили 79 задач из 110. Здесь проверка базовой линии:
 * red=1, verify=2 (исполнитель + свежий прогон приёмщика), accept=1 — без флага;
 * второй accept — повтор и флаг attempts:1.
 *
 * c1: базовая линия — повторов 0, флага attempts нет.
 * c2: второй accept — repeats 1, флаг attempts:1.
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
const TOOL = path.join(PKG, 'tools', 'task-monitor.mjs');

if (!fs.existsSync(path.join(PKG, 'spec'))) {
  console.log('SKIP: проверка пакета вне пакета');
  process.exit(0);
}

function truthy(value, label) {
  if (!value) throw new Error(label);
}

function run(cmd, args, cwd) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-mflags-out-'));
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
  try { out = fs.readFileSync(outFile, 'utf8') + fs.readFileSync(errFile, 'utf8'); } catch { /* ignore */ }
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
  return { code: res.status, out };
}
function write(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
}
function makeRoot(rows, notes) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-mflags-root-'));
  const dir = path.join(root, 'docs', 'tasks', '0001');
  write(path.join(dir, 'task.md'), '# Задание 0001' + String.fromCharCode(10) + '<!-- TASK-META' + String.fromCharCode(10)
    + JSON.stringify({ id: '0001', risk: 'medium' }, null, 2) + String.fromCharCode(10) + '-->' + String.fromCharCode(10));
  write(path.join(dir, 'gates.jsonl'), rows.map((row) => JSON.stringify(row)).join(String.fromCharCode(10)) + String.fromCharCode(10));
  write(path.join(dir, 'acceptance.json'), JSON.stringify({ status: 'accepted', notes: notes || '' }));
  return root;
}
function cardOf(root) {
  const result = run(process.execPath, [TOOL, '--json', '--root', root], PKG);
  truthy(result.code === 0, 'monitor вернул код ' + result.code + ': ' + result.out.slice(-300));
  const row = (JSON.parse(result.out).tasks || []).find((task) => task.id === '0001');
  truthy(Boolean(row), 'задачи нет в отчёте');
  return row;
}

const BASELINE = [
  { kind: 'red', verdict: 'red-proven' },
  { kind: 'verify', verdict: 'green' },
  { kind: 'verify', verdict: 'green' },
  { kind: 'accept', verdict: 'accepted' },
];

function c1() {
  const root = makeRoot(BASELINE, '');
  try {
    const row = cardOf(root);
    truthy(row.attempts.red === 1 && row.attempts.verify === 2 && row.attempts.accept === 1, 'базовая линия не распознана: ' + JSON.stringify(row.attempts));
    truthy(row.attempts.repeats === 0, 'на базовой линии повторы: ' + row.attempts.repeats);
    truthy(!row.flags.some((flag) => flag.startsWith('attempts:')), 'флаг attempts на базовой линии: ' + JSON.stringify(row.flags));
    truthy(!row.flags.some((flag) => flag.startsWith('rework:')), 'флаг rework без причины');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
  console.log('MFLAGS OK c1');
}

function c2() {
  const rows = [...BASELINE, { kind: 'accept', verdict: 'accepted' }];
  const root = makeRoot(rows, 'rework: переделал проверку');
  try {
    const row = cardOf(root);
    truthy(row.attempts.accept === 2, 'второй accept не посчитан: ' + JSON.stringify(row.attempts));
    truthy(row.attempts.repeats === 1, 'повторов не 1: ' + row.attempts.repeats);
    truthy(row.flags.includes('attempts:1'), 'нет флага attempts:1: ' + JSON.stringify(row.flags));
    truthy(row.flags.includes('rework:1'), 'нет флага rework:1: ' + JSON.stringify(row.flags));
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
  console.log('MFLAGS OK c2');
}

const table = { c1, c2 };
const which = process.argv[2];
if (!table[which]) {
  console.log('usage: node spec/checks/monitor-flags.mjs c1|c2');
  process.exit(2);
}
try {
  table[which]();
} catch (error) {
  console.log('MFLAGS FAIL ' + which + ': ' + (error && error.message ? error.message : error));
  process.exit(1);
}
