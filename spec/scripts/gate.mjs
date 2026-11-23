#!/usr/bin/env node
/*
 * 0122 (2.6.104): единая команда ворот — через сторож движка, а не сырым pwsh.
 *
 * Повод — замер structure (docs/analysis/subagents-workflow-causes.md): 142 отказа
 * enforcement.waitPolicy=fail в 68 сессиях. Агент сначала пробует синхронную
 * команду на 240–600 с, получает отказ, и только потом идёт в сторож; при этом
 * шаблон задания предписывал хост-инструменты («run_in_background»,
 * «run_code 600000»), которых у узлов движка нет.
 *
 * Здесь один вход, который сам делает всё, что предписано:
 *   node spec/scripts/gate.mjs <red|verify|accept|hash|lint|tests|selftest> [аргументы...] [--tail N]
 *
 * Печатает: GATE <действие> JOB <id>, LOG <абсолютный путь>, вердикт DONE/TIMEOUT/STALE
 * (первой строкой, как у job.mjs) и хвост лога последних N строк (по умолчанию 20).
 * Код возврата — код ребёнка; --tail 0 отключает хвост.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSyncPipeFree } from './lib/common.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PKG = path.resolve(HERE, '..', '..');
const JOB = path.join(HERE, 'job.mjs');

const ACTIONS = {
  red: path.join(HERE, 'task-red.mjs'),
  verify: path.join(HERE, 'task-verify.mjs'),
  accept: path.join(HERE, 'task-accept.mjs'),
  hash: path.join(HERE, 'task-hash.mjs'),
  lint: path.join(HERE, 'task-lint.mjs'),
  tests: path.join(PKG, 'tools', 'check-tests.mjs'),
  selftest: path.join(PKG, 'spec', 'selftest.mjs'),
};
const NL = String.fromCharCode(10);
const DEFAULT_TAIL = 20;
const WAIT_TIMEOUT_SEC = 600;

function usage() {
  process.stdout.write('gate: node spec/scripts/gate.mjs <' + Object.keys(ACTIONS).join('|') + '> [аргументы...] [--tail N]' + NL);
  process.stdout.write('  Ворота запускаются сторожем job.mjs; печатается id, путь лога, вердикт и хвост лога.' + NL);
  process.stdout.write('  --tail 0 отключает хвост; --tail N — N последних строк (по умолчанию ' + DEFAULT_TAIL + ').' + NL);
}

/* Свои ключи отделяем от аргументов действия: у ворот свои. */
function splitArgs(argv) {
  const child = [];
  let tail = DEFAULT_TAIL;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = String(argv[i]);
    if (arg === '--tail') {
      const next = argv[i + 1];
      const value = next === undefined ? '' : String(next);
      const number = value === '' ? NaN : Number(value);
      if (!Number.isInteger(number) || number < 0) {
        process.stderr.write('gate: --tail: нужно целое число строк ≥ 0' + NL);
        return { error: true };
      }
      tail = number;
      i += 1;
      continue;
    }
    if (arg.startsWith('--tail=')) {
      const number = Number(arg.slice('--tail='.length));
      if (!Number.isInteger(number) || number < 0) {
        process.stderr.write('gate: --tail: нужно целое число строк ≥ 0' + NL);
        return { error: true };
      }
      tail = number;
      continue;
    }
    child.push(arg);
  }
  return { error: false, child, tail };
}

const argv = process.argv.slice(2);
if (argv.length === 0 || argv[0] === '--help' || argv[0] === '-h') {
  usage();
  process.exit(argv.length === 0 ? 2 : 0);
}
const action = String(argv[0]);
const script = ACTIONS[action];
if (!script) {
  process.stderr.write('gate: неизвестное действие «' + action + '»' + NL);
  usage();
  process.exit(2);
}
const parts = splitArgs(argv.slice(1));
if (parts.error) process.exit(2);

const started = spawnSyncPipeFree(process.execPath, [JOB, 'start', '--', process.execPath, script, ...parts.child], {
  cwd: process.cwd(),
  encoding: 'utf8',
  timeout: 120000,
});
if (started.stdout) process.stdout.write(started.stdout);
if (started.stderr) process.stderr.write(started.stderr);
const jobMatch = /JOB ([0-9a-f]{12})/u.exec(String(started.stdout || ''));
const logMatch = /LOG (.+)/u.exec(String(started.stdout || ''));
if (!jobMatch) {
  process.stderr.write('gate: сторож не запустил задание' + NL);
  process.exit(1);
}
const id = jobMatch[1];
process.stdout.write('GATE ' + action + ' JOB ' + id + NL);
if (logMatch) process.stdout.write('LOG ' + logMatch[1].trim() + NL);

const waited = spawnSyncPipeFree(process.execPath, [
  JOB, 'wait', id, '--timeout', String(WAIT_TIMEOUT_SEC), '--interval', '2', '--tail', String(parts.tail),
], { cwd: process.cwd(), encoding: 'utf8', timeout: (WAIT_TIMEOUT_SEC + 60) * 1000 });
if (waited.stdout) process.stdout.write(waited.stdout);
if (waited.stderr) process.stderr.write(waited.stderr);
const done = /DONE \S+ exit=(\S+)/u.exec(String(waited.stdout || ''));
if (!done) process.exit(1);
const code = Number(done[1]);
process.exit(Number.isInteger(code) ? code : 1);
