#!/usr/bin/env node
/*
 * 0091 (WC-19): приёмка пачкой 2–3 заданий одной церемонией.
 *
 * Один вызов — одно «окно» работы агента вместо трёх: preflight (каталоги,
 * аргументы) проверяется один раз, дальше последовательно вызывается штатный
 * task-accept для каждого задания. Подпись, запись приёмки и коммит остаются
 * персональными: пачка не смешивает доказательства и не ослабляет ворота.
 *
 * Почему последовательно: task-accept коммитит кандидата и метаданные; два
 * параллельных коммита в одном репозитории — гонка за индекс.
 *
 * Usage: node task-accept-batch.mjs --tasks 0110,0111 --key <pem> --key-id <id> [--repo <dir>] [--dry-run]
 * Итог: PASS/FAIL по каждому заданию; exit 1, если хоть одно не принято.
 */
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseArgv } from './lib/common.mjs';
import { parseTaskList, batchPlan, forwardedArgs } from './lib/batch-tasks.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ACCEPT = path.join(HERE, 'task-accept.mjs');

function fail(message) {
  console.error('task-accept-batch: ' + message);
  process.exit(2);
}

const argv = parseArgv(process.argv.slice(2));
if (argv.help || process.argv.includes('--help')) {
  console.log('Usage: node task-accept-batch.mjs --tasks 0110,0111 [--key <pem> --key-id <id>] [--repo <dir>] [--dry-run]');
  console.log('Пачка 2–3 заданий: preflight один раз, затем task-accept на каждое (подпись персональная).');
  process.exit(0);
}
const idsRaw = argv.tasks;
if (idsRaw === undefined) fail('нужен --tasks 0110,0111');
let ids;
try {
  ids = parseTaskList(Array.isArray(idsRaw) ? idsRaw : String(idsRaw));
} catch (error) {
  fail(error && error.message ? error.message : String(error));
}
const repo = path.resolve(String(argv.repo || '.'));
const plan = batchPlan({ root: repo, tasksDir: argv['tasks-dir'] || 'docs/tasks', ids });
if (plan.missing.length > 0) fail('нет каталогов заданий: ' + plan.missing.join(', '));

const forwarded = forwardedArgs(process.argv.slice(2));
console.log('пачка: ' + ids.join(', ') + ' (preflight пройден, приёмка по одному)');

let failed = 0;
for (const task of plan.tasks) {
  console.log('');
  console.log('=== ' + task.id + ': task-accept ' + task.dir);
  const run = spawnSync(process.execPath, [ACCEPT, '--task', task.dir, ...forwarded], {
    cwd: repo,
    stdio: 'inherit',
    windowsHide: true,
    env: process.env,
  });
  const status = typeof run.status === 'number' ? run.status : 1;
  if (status === 0) {
    console.log('PASS ' + task.id);
  } else {
    failed += 1;
    console.log('FAIL ' + task.id + ' (exit ' + status + ')');
  }
}

console.log('');
console.log('ИТОГ: принято ' + (plan.tasks.length - failed) + '/' + plan.tasks.length + (failed > 0 ? ', отклонено ' + failed : ''));
process.exit(failed === 0 ? 0 : 1);
