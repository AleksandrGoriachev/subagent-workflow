#!/usr/bin/env node
/*
 * Regress (2.3.0, правило R-5): принятые задания перезапускаются на текущем HEAD.
 *
 * Приёмка проверяет задачу один раз. Если общий код позже ломает проверку закрытой
 * задачи, об этом никто не узнаёт до следующего перевыпуска: «зелёный» гниёт.
 * Этот шаг ничего не принимает и не пишет в артефакты задачи: он только
 * перезапускает критерии из принятых контрактов и говорит, что сломалось.
 *
 *   node scripts/task-regress.mjs --repo . [--task docs/tasks/0001] [--strict] [--json]
 *   node scripts/task-regress.mjs --repo . --out regress.json
 */
import fs from 'node:fs';
import path from 'node:path';
import {
  parseArgv, readTask, repoRoot, loadConfig, exists, readJson, writeJson,
  runCommand, evaluateExpectation, isManual, formatMs, headCommit,
} from './lib/common.mjs';
import { loadAcceptors, verifyRecord } from './sign.mjs';

const argv = parseArgv(process.argv.slice(2));
if (argv.help) {
  console.log('Usage: node task-regress.mjs --repo <dir> [--task <dir>] [--strict] [--json] [--out <file>]');
  console.log('Перезапускает критерии принятых заданий; ничего не принимает и не пишет в задачи.');
  console.log('--strict: unproven (нет свежего красного) и untrusted (подпись) тоже дают exit 1.');
  process.exit(0);
}

const repo = path.resolve(argv.repo || process.cwd());
const config = loadConfig(repo);
const tasksRoot = path.resolve(repo, String(config.tasksDir || 'docs/tasks'));
const timeoutMs = Number(argv.timeout || 300000);
const strict = Boolean(argv.strict);
const keysFile = path.resolve(repo, String(config.keysFile));

if (!exists(keysFile)) {
  console.error('task-regress: нет acceptors.json: ' + keysFile);
  process.exit(1);
}
const acceptors = loadAcceptors(keysFile);

function taskDirs() {
  if (argv.task) return [path.resolve(String(argv.task))];
  let names = [];
  try { names = fsReaddir(tasksRoot); } catch { names = []; }
  return names
    .map((name) => path.join(tasksRoot, name))
    .filter((dir) => exists(path.join(dir, 'acceptance.json')) && exists(path.join(dir, 'task.md')));
}

function fsReaddir(dir) {
  return fs.readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

async function regressTask(taskDir) {
  const { meta, criteria } = readTask(taskDir);
  const acceptancePath = path.join(taskDir, 'acceptance.json');
  const record = readJson(acceptancePath);
  const entry = acceptors.find((item) => item.keyId === record.keyId);
  const signatureOk = Boolean(entry) && verifyRecord(record, entry.publicKeyPem);
  const redProven = Boolean(record.red) && record.red.baseSha === record.contractCommit;
  const results = [];
  const env = { TASK_ID: String(meta.id), TASK_DIR: taskDir, REPO_ROOT: repo, TASK_RUN: 'regress', NO_COLOR: '1' };

  for (const criterion of criteria.criteria) {
    const id = String(criterion.id);
    if (isManual(criterion)) { results.push({ id, passed: null, manual: true, durationMs: 0, reasons: [] }); continue; }
    const cwd = criterion.cwd ? path.resolve(repo, criterion.cwd) : repo;
    const run = await runCommand(criterion.command, { cwd, env, timeoutMs: Number(criterion.timeoutMs || timeoutMs) });
    const expectation = evaluateExpectation(criterion.expect, run);
    results.push({ id, passed: expectation.passed, durationMs: run.durationMs, reasons: expectation.reasons, exitCode: run.exitCode, timedOut: run.timedOut });
  }

  const executed = results.filter((item) => item.passed !== null);
  const failed = executed.filter((item) => item.passed === false);
  let status = 'ok';
  if (!signatureOk) status = 'untrusted';
  else if (failed.length > 0) status = 'regressed';
  else if (!redProven) status = 'unproven';

  return {
    task: String(meta.id),
    dir: path.relative(repo, taskDir).split(path.sep).join('/'),
    status,
    version: record.version,
    risk: record.risk,
    redProven,
    executed: executed.length,
    failed: failed.length,
    failedIds: failed.map((item) => item.id),
    results,
  };
}

const tasks = taskDirs();
if (tasks.length === 0) {
  console.log('task-regress: принятых заданий нет (в ' + path.relative(repo, tasksRoot) + ')');
  process.exit(0);
}

const report = { version: 1, kind: 'regress', createdAt: new Date().toISOString(), repo, head: headCommit(repo), tasks: [] };
for (const taskDir of tasks) {
  try {
    report.tasks.push(await regressTask(taskDir));
  } catch (err) {
    report.tasks.push({ task: path.basename(taskDir), dir: path.relative(repo, taskDir).split(path.sep).join('/'), status: 'error', error: err.message, results: [] });
  }
}

const count = (status) => report.tasks.filter((item) => item.status === status).length;
report.summary = {
  total: report.tasks.length,
  ok: count('ok'),
  regressed: count('regressed'),
  unproven: count('unproven'),
  untrusted: count('untrusted'),
  error: count('error'),
};
const out = String(argv.out || '');
if (out) {
  writeJson(path.resolve(repo, out), report);
}

if (argv.json) {
  console.log(JSON.stringify(report, null, 2));
} else {
  console.log('task-regress: ' + report.summary.total + ' задач(и)');
  for (const item of report.tasks) {
    const mark = item.status === 'ok' ? 'OK' : item.status.toUpperCase();
    console.log('  ' + mark.padEnd(9) + ' ' + item.task + (item.failed ? '  провалено: ' + item.failedIds.join(', ') : '') + (item.error ? '  ' + item.error : ''));
    for (const result of item.results || []) {
      if (result.passed === false) {
        console.log('      ' + result.id + '  ' + formatMs(result.durationMs) + '  ' + (result.reasons || []).join('; '));
      }
    }
  }
  console.log('Итог: ok ' + report.summary.ok + ', regressed ' + report.summary.regressed
    + ', unproven ' + report.summary.unproven + ', untrusted ' + report.summary.untrusted
    + ', error ' + report.summary.error);
}

const failing = report.tasks.filter((item) => item.status === 'regressed' || item.status === 'error');
const strictFailing = strict ? report.tasks.filter((item) => item.status === 'unproven' || item.status === 'untrusted') : [];
process.exit(failing.length + strictFailing.length > 0 ? 1 : 0);
