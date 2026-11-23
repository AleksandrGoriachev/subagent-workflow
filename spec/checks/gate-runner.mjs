#!/usr/bin/env node
/*
 * 2.6.104 (0122): единая команда ворот — сторожем, с id, логом и хвостом.
 *
 * Замер structure: 142 отказа enforcement.waitPolicy=fail в 68 сессиях. Агент
 * сначала пробовал синхронную команду на 240–600 с и получал отказ, потому что
 * шаблон задания предписывал хост-инструменты, а не сторож движка. gate.mjs — один
 * вход: запускает действие сторожем, печатает GATE/JOB/LOG, вердикт и хвост лога,
 * код возврата отдаёт код ребёнка.
 *
 * c1: lint сторожем — exit 0, в выводе GATE <действие> JOB <id>, LOG <абсолютный путь>, DONE.
 * c2: неизвестное действие — код 2 и список действий.
 * c3: код ребёнка доходит: verify несуществующего задания — код 1, а не 0.
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
const GATE = path.join(PKG, 'spec', 'scripts', 'gate.mjs');

if (!fs.existsSync(path.join(PKG, 'spec'))) {
  console.log('SKIP: проверка пакета вне пакета');
  process.exit(0);
}

function truthy(value, label) {
  if (!value) throw new Error(label);
}

/* Вывод дочерних процессов — в файлы, а не в пайпы: песочница не даёт именованных каналов. */
function run(cmd, args, cwd) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-gaterun-out-'));
  const outFile = path.join(dir, 'stdout');
  const errFile = path.join(dir, 'stderr');
  const ofd = fs.openSync(outFile, 'w');
  const efd = fs.openSync(errFile, 'w');
  let res;
  try {
    res = spawnSync(cmd, args, { cwd, timeout: 600000, windowsHide: true, stdio: ['ignore', ofd, efd] });
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
function gate(args) { return run(process.execPath, [GATE, ...args], PKG); }

function c1() {
  const result = gate(['lint', '--task', 'docs/tasks/0122', '--tail', '5']);
  truthy(result.code === 0, 'gate lint завершился кодом ' + result.code + ': ' + (result.err || result.out).slice(-500));
  truthy(/GATE lint JOB [0-9a-f]{12}/u.test(result.out), 'в выводе нет GATE lint JOB <id>: ' + result.out.slice(0, 300));
  truthy(/^LOG .+/mu.test(result.out), 'в выводе нет строки LOG <путь>');
  truthy(/DONE [0-9a-f]{12} exit=0/u.test(result.out), 'в выводе нет DONE exit=0');
  console.log('GATERUN OK c1');
}

function c2() {
  const result = gate(['nope']);
  truthy(result.code === 2, 'неизвестное действие вернуло код ' + result.code + ', ожидался 2');
  truthy(/red\|verify\|accept/u.test(result.out), 'список действий не напечатан: ' + result.out.slice(0, 200));
  console.log('GATERUN OK c2');
}

function c3() {
  const result = gate(['verify', '--task', 'docs/tasks/0000-no-such-task', '--tail', '3']);
  truthy(result.code === 1, 'код ребёнка не дошёл: gate вернул ' + result.code + ', ожидался 1');
  truthy(/DONE [0-9a-f]{12} exit=1/u.test(result.out), 'в выводе нет DONE exit=1: ' + result.out.slice(-400));
  console.log('GATERUN OK c3');
}

const table = { c1, c2, c3 };
const which = process.argv[2];
if (!table[which]) {
  console.log('usage: node spec/checks/gate-runner.mjs c1|c2|c3');
  process.exit(2);
}
try {
  table[which]();
} catch (error) {
  console.log('GATERUN FAIL ' + which + ': ' + (error && error.message ? error.message : error));
  process.exit(1);
}
