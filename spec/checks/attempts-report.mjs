#!/usr/bin/env node
/*
 * 2.6.106 (0126): счётчик попыток и переделок из журнала ворот.
 *
 * Причины 3–4 замера structure: 16 лишних прогонов review/accept, «rework» и
 * «повтор» не разделены, в run-store попыток нет. Поле attempts в записи приёмки
 * требует схемы v7 (правило allOf: fresh только true для medium/high — ослаблять
 * нельзя), поэтому счётчик читает существующие артефакты: gates.jsonl и notes
 * записи приёмки (после 2.6.105 причина переделки пишется как «rework: …»).
 *
 * c1: строки red/verify/accept и причина переделки в notes — посчитаны и отданы JSON.
 * c2: пустой каталог — count 0, код 0; неизвестное задание — тоже 0.
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
const TOOL = path.join(PKG, 'tools', 'attempts.mjs');

if (!fs.existsSync(path.join(PKG, 'spec'))) {
  console.log('SKIP: проверка пакета вне пакета');
  process.exit(0);
}

function truthy(value, label) {
  if (!value) throw new Error(label);
}

function run(cmd, args, cwd) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-att-out-'));
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

function attempts(tasksRoot, extra = []) {
  return run(process.execPath, [TOOL, '--tasks', tasksRoot, '--json', ...extra], PKG);
}

function c1() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-att-tasks-'));
  try {
    const dir = path.join(root, '0001');
    const rows = [
      { at: '2026-11-23T20:00:00+03:00', kind: 'red', task: '0001', verdict: 'red-proven' },
      { at: '2026-11-23T20:10:00+03:00', kind: 'verify', task: '0001', verdict: 'green' },
      { at: '2026-11-23T20:20:00+03:00', kind: 'accept', task: '0001', verdict: 'accepted' },
    ];
    write(path.join(dir, 'gates.jsonl'), rows.map((row) => JSON.stringify(row)).join(String.fromCharCode(10)) + String.fromCharCode(10));
    write(path.join(dir, 'acceptance.json'), JSON.stringify({ status: 'accepted', notes: 'rework: переделал проверку' }));
    const result = attempts(root);
    truthy(result.code === 0, 'attempts --json вернул код ' + result.code + ': ' + (result.err || result.out).slice(-300));
    const parsed = JSON.parse(result.out);
    truthy(parsed.count === 1, 'задач в отчёте ' + parsed.count + ', ожидалась 1');
    const task = parsed.tasks[0];
    truthy(task.red === 1 && task.verify === 1 && task.accept === 1, 'счётчики неверны: ' + JSON.stringify(task));
    truthy(task.lastVerdict === 'accepted', 'последний вердикт ' + JSON.stringify(task.lastVerdict));
    truthy(Array.isArray(task.rework) && task.rework[0] === 'переделал проверку', 'причина переделки не прочитана: ' + JSON.stringify(task.rework));
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
  console.log('ATTEMPTS OK c1');
}

function c2() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-att-empty-'));
  try {
    const result = attempts(root);
    truthy(result.code === 0, 'пустой каталог: код ' + result.code);
    const parsed = JSON.parse(result.out);
    truthy(parsed.count === 0, 'пустой каталог дал ' + parsed.count + ' задач');
    const filtered = attempts(root, ['--task', '9999']);
    truthy(filtered.code === 0, 'фильтр по неизвестному заданию: код ' + filtered.code);
    truthy(JSON.parse(filtered.out).count === 0, 'фильтр по неизвестному заданию что-то вернул');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
  console.log('ATTEMPTS OK c2');
}

const table = { c1, c2 };
const which = process.argv[2];
if (!table[which]) {
  console.log('usage: node spec/checks/attempts-report.mjs c1|c2');
  process.exit(2);
}
try {
  table[which]();
} catch (error) {
  console.log('ATTEMPTS FAIL ' + which + ': ' + (error && error.message ? error.message : error));
  process.exit(1);
}
