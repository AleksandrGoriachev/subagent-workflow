#!/usr/bin/env node
/*
 * 2.6.107 (0131): попытки и переделки видны в мониторе задач.
 *
 * Замер structure просил счётчик попыток в run-store; панель и снимок .dsh/workflow/tasks.json
 * — это и есть run-store для владельца. Монитор теперь считает red/verify/accept из
 * gates.jsonl и причины переделок из notes записи, поднимает флаги attempts:N / rework:N.
 *
 * c1: три строки журнала и причина переделки — счётчики и флаги в JSON.
 * c2: задача без журнала — нули и без флагов попыток.
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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-mon-out-'));
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
function makeRoot(withJournal) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-mon-root-'));
  const dir = path.join(root, 'docs', 'tasks', '0001');
  write(path.join(dir, 'task.md'), '# Задание 0001' + String.fromCharCode(10) + String.fromCharCode(10) + '<!-- TASK-META' + String.fromCharCode(10)
    + JSON.stringify({ id: '0001', title: 'т', risk: 'medium' }, null, 2) + String.fromCharCode(10) + '-->' + String.fromCharCode(10));
  if (withJournal) {
    const rows = [
      { kind: 'red', verdict: 'red-proven' },
      { kind: 'verify', verdict: 'green' },
      { kind: 'verify', verdict: 'green' },
      { kind: 'accept', verdict: 'accepted' },
    ];
    write(path.join(dir, 'gates.jsonl'), rows.map((row) => JSON.stringify(row)).join(String.fromCharCode(10)) + String.fromCharCode(10));
    write(path.join(dir, 'acceptance.json'), JSON.stringify({ status: 'accepted', notes: 'rework: переделал проверку' }));
  }
  return { root, dir };
}
function healthOf(root) {
  const result = run(process.execPath, [TOOL, '--json', '--root', root], PKG);
  truthy(result.code === 0, 'monitor --json вернул код ' + result.code + ': ' + result.out.slice(-300));
  const parsed = JSON.parse(result.out);
  const row = (parsed.tasks || []).find((task) => task.id === '0001');
  truthy(Boolean(row), 'задачи 0001 нет в отчёте');
  return row;
}

function c1() {
  const fixture = makeRoot(true);
  try {
    const row = healthOf(fixture.root);
    truthy(row.attempts && row.attempts.red === 1 && row.attempts.verify === 2 && row.attempts.accept === 1,
      'счётчики неверны: ' + JSON.stringify(row.attempts));
    truthy(row.attempts.total === 4, 'total не 4: ' + row.attempts.total);
    /* Базовая линия: red=1, verify=2 (исполнитель + приёмщик), accept=1 — без повторов. */
    truthy(row.attempts.repeats === 0, 'повторов быть не должно на базовой линии: ' + row.attempts.repeats);
    truthy(!row.flags.some((flag) => flag.startsWith('attempts:')), 'флаг attempts на базовой линии: ' + JSON.stringify(row.flags));
    truthy(Array.isArray(row.attempts.rework) && row.attempts.rework[0] === 'переделал проверку', 'rework не прочитан: ' + JSON.stringify(row.attempts.rework));
    truthy(row.flags.includes('rework:1'), 'нет флага rework:1: ' + JSON.stringify(row.flags));
  } finally { fs.rmSync(fixture.root, { recursive: true, force: true }); }
  console.log('MONATT OK c1');
}

function c2() {
  const fixture = makeRoot(false);
  try {
    const row = healthOf(fixture.root);
    truthy(row.attempts && row.attempts.total === 0, 'у задачи без журнала попытки не нулевые: ' + JSON.stringify(row.attempts));
    truthy(!row.flags.some((flag) => flag.startsWith('attempts:')), 'флаг attempts на пустом журнале');
    truthy(!row.flags.some((flag) => flag.startsWith('rework:')), 'флаг rework без причины');
  } finally { fs.rmSync(fixture.root, { recursive: true, force: true }); }
  console.log('MONATT OK c2');
}

const table = { c1, c2 };
const which = process.argv[2];
if (!table[which]) {
  console.log('usage: node spec/checks/monitor-attempts.mjs c1|c2');
  process.exit(2);
}
try {
  table[which]();
} catch (error) {
  console.log('MONATT FAIL ' + which + ': ' + (error && error.message ? error.message : error));
  process.exit(1);
}
