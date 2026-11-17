#!/usr/bin/env node
/*
 * Regress (2.3.0, уточнён в 2.3.1): принятые задания перезапускаются на текущем HEAD.
 *
 * Приёмка проверяет задачу один раз. Если общий код позже ломает проверку закрытой
 * задачи, об этом никто не узнаёт до следующего перевыпуска: «зелёный» гниёт.
 * Этот шаг ничего не принимает и не пишет в артефакты задачи.
 *
 * Регресс (код сломался) и долг провенанса (красного не было) — разные вещи:
 *   regressed            — критерий падает                                -> fail
 *   unproven-violation   — medium/high без красного / low без обхода     -> fail
 *   unproven-lawful      — low + записанный allowMissingRed              -> warn
 *   untrusted            — запись v4+ не проверяется ключом              -> fail
 *   legacy               — запись v1–v3: машинно не проверяется          -> warn/строка
 *   error                — запись/прогон не разбирается                  -> fail
 *
 *   node scripts/task-regress.mjs --repo . [--task docs/tasks/0001] [--strict] [--json]
 *   node scripts/task-regress.mjs --repo . --baseline regress.baseline.json
 *   node scripts/task-regress.mjs --repo . --write-baseline regress.baseline.json
 */
import fs from 'node:fs';
import path from 'node:path';
import {
  parseArgv, readTask, loadConfig, exists, writeJson, relPosix,
  runCommand, evaluateExpectation, isManual, formatMs, headCommit,
} from './lib/common.mjs';
import { loadAcceptors, verifyRecord } from './sign.mjs';
import {
  classifyAcceptance, loadBaseline, baselineEntry, isExpired, baselineCandidates, shouldFail,
  parseAllowlist, allowlistCandidates, applyAllowlistToResults, ALLOWLIST_PROJECT_PATH,
} from './lib/regress.mjs';

const argv = parseArgv(process.argv.slice(2));
if (argv.help) {
  console.log('Usage: node task-regress.mjs --repo <dir> [--task <dir>] [--strict] [--json] [--out <file>]');
  console.log('       [--baseline <file>] [--write-baseline <file>] [--include-violations] [--timeout <ms>]');
  console.log('       [--allowlist <file>]');
  console.log('Перезапускает критерии принятых заданий; ничего не принимает и не пишет в задачи.');
  console.log('--allowlist: известные провалы критериев (по умолчанию ' + ALLOWLIST_PROJECT_PATH + ').');
  console.log('  Порядок: --allowlist → workflow.config.json → regress.allowlist → проект → docs/tasks/<id>/regress.allowlist.json.');
  console.log('--strict: unproven-lawful и просроченный baseline тоже дают exit 1.');
  console.log('--include-violations: писать в baseline и unproven-violation (по умолчанию — только законный долг).');
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

/*
 * Проектный allowlist (2.6.82): известный провал критерия не выдаётся за регресс,
 * но и не исчезает — попадает в отчёт как allowed с причиной и сроком.
 * Порядок источников: --allowlist → config regress.allowlist → проект → legacy
 * docs/tasks/<id>/regress.allowlist.json (у каждой задачи свой).
 */
const allowlistState = {
  global: null,
  source: null,
  files: [],
  problems: [],
};

function loadAllowlistFrom(file, source) {
  const parsed = parseAllowlist(fs.readFileSync(file, 'utf8'), source);
  allowlistState.files.push({ file: relPosix(repo, file), source, entries: parsed.entries.length });
  for (const problem of parsed.problems) allowlistState.problems.push(source + ': ' + problem);
  if (parsed.fatal) {
    console.error('task-regress: allowlist не разобран (' + relPosix(repo, file) + '): ' + parsed.problems.join('; '));
    process.exit(1);
  }
  return parsed;
}

(function resolveGlobalAllowlist() {
  const configured = config.regress && typeof config.regress === 'object' ? config.regress.allowlist : undefined;
  const candidates = allowlistCandidates({ repo, argvAllowlist: argv.allowlist, configAllowlist: configured });
  for (const candidate of candidates) {
    if (!exists(candidate.file)) {
      if (candidate.required) {
        console.error('task-regress: allowlist не найден (' + candidate.source + '): ' + relPosix(repo, candidate.file));
        process.exit(1);
      }
      continue;
    }
    allowlistState.global = loadAllowlistFrom(candidate.file, candidate.source);
    allowlistState.source = candidate.source;
    break;
  }
})();

const legacyAllowlists = new Map();

/** Allowlist для конкретной задачи: глобальный файл, иначе legacy в каталоге задачи. */
function allowlistForTask(taskDir, taskId, criteriaIds) {
  if (allowlistState.global) {
    for (const entry of allowlistState.global.entries) {
      if (entry.task !== taskId) continue;
      for (const criterion of entry.criteria) {
        if (!criteriaIds.includes(criterion)) {
          allowlistState.problems.push('allowlist: ' + taskId + '/' + criterion + ' — такого критерия нет в criteria.json задания');
        }
      }
    }
    return allowlistState.global;
  }
  const legacy = path.join(taskDir, 'regress.allowlist.json');
  if (!exists(legacy)) return null;
  if (!legacyAllowlists.has(legacy)) legacyAllowlists.set(legacy, loadAllowlistFrom(legacy, 'legacy задачи ' + taskId));
  return legacyAllowlists.get(legacy);
}

function readRecord(file) {
  const buffer = fs.readFileSync(file);
  if (buffer[0] === 0xff && buffer[1] === 0xfe) return JSON.parse(buffer.subarray(2).toString('utf16le'));
  return JSON.parse(buffer.toString('utf8').replace(/^\uFEFF/, ''));
}

function taskDirs() {
  if (argv.task) return [path.resolve(String(argv.task))];
  let names = [];
  try {
    names = fs.readdirSync(tasksRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();
  } catch { names = []; }
  return names
    .map((name) => path.join(tasksRoot, name))
    .filter((dir) => exists(path.join(dir, 'acceptance.json')) && exists(path.join(dir, 'task.md')));
}

async function regressTask(taskDir, allowlistForTask) {
  const { meta, criteria } = readTask(taskDir);
  const taskAllowlist = typeof allowlistForTask === 'function'
    ? allowlistForTask(taskDir, String(meta.id), criteria.criteria.map((criterion) => String(criterion.id)))
    : null;
  const record = readRecord(path.join(taskDir, 'acceptance.json'));
  const entry = acceptors.find((item) => item.keyId === record.keyId);
  const signatureOk = Boolean(entry) && verifyRecord(record, entry.publicKeyPem);
  const revoked = Boolean(entry && entry.revokedAt && record.acceptedAt
    && new Date(record.acceptedAt) > new Date(entry.revokedAt));
  const base = classifyAcceptance(record, { signatureOk, revoked });
  const result = {
    task: String(meta.id),
    dir: path.relative(repo, taskDir).split(path.sep).join('/'),
    status: base.status,
    provenance: base.status,
    reason: base.reason,
    version: record.version,
    risk: record.risk,
    redProven: Boolean(record.red) && record.version >= 6
      ? record.red.baseSha === record.contractCommit
      : Boolean(record.red) && record.red.contractCommit === record.contractCommit,
    executed: 0,
    failed: 0,
    failedIds: [],
    timedOutIds: [],
    results: [],
    allowed: [],
    baseline: null,
    expiredBaseline: false,
  };

  /* Легаси и недоверенные записи не исполняем: команды из них не доказаны ключом. */
  if (base.status === 'legacy' || base.status === 'untrusted' || base.status === 'error') return result;

  const env = { TASK_ID: String(meta.id), TASK_DIR: taskDir, REPO_ROOT: repo, TASK_RUN: 'regress', NO_COLOR: '1' };
  const results = [];

  for (const cmd of criteria.setup) {
    const run = await runCommand(cmd, { cwd: repo, env, timeoutMs: 300000 });
    if (run.exitCode !== 0) {
      return { ...result, status: 'error', reason: 'setup: ' + cmd + ' (exit ' + run.exitCode + ')', executed: 0 };
    }
  }
  try {
    for (const criterion of criteria.criteria) {
      const id = String(criterion.id);
      if (isManual(criterion)) { results.push({ id, passed: null, manual: true, durationMs: 0, reasons: [] }); continue; }
      const cwd = criterion.cwd ? path.resolve(repo, criterion.cwd) : repo;
      const run = await runCommand(criterion.command, { cwd, env, timeoutMs: Number(criterion.timeoutMs || timeoutMs) });
      const expectation = evaluateExpectation(criterion.expect, run);
      results.push({
        id,
        passed: expectation.passed,
        durationMs: run.durationMs,
        reasons: run.timedOut
          ? [...expectation.reasons, 'таймаут после ' + Number(criterion.timeoutMs || timeoutMs) + ' ms']
          : expectation.reasons,
        exitCode: run.exitCode,
        timedOut: run.timedOut,
      });
    }
  } finally {
    for (const cmd of criteria.teardown) {
      await runCommand(cmd, { cwd: repo, env, timeoutMs: 300000 });
    }
  }

  /*
   * Известный провал (allowlist) не становится регрессом, но остаётся в отчёте:
   * строка allowed несёт причину, владельца и срок. При --strict просроченная
   * запись не подавляет провал — долг обязан быть починен или переутверждён.
   */
  result.allowed.push(...applyAllowlistToResults(results, taskAllowlist, String(meta.id), { strict }));
  const executed = results.filter((item) => item.passed !== null);
  const failed = executed.filter((item) => item.passed === false && !item.allowedBy);
  result.executed = executed.length;
  result.failed = failed.length;
  result.failedIds = failed.map((item) => item.id);
  result.timedOutIds = failed.filter((item) => item.timedOut).map((item) => item.id);
  result.results = results;
  if (failed.length > 0) {
    /* Падение важнее статуса провенанса: это и есть регресс. Таймаут — тоже
     * провал, но в выводе он помечается отдельно: это сигнал о перегрузке
     * раннера, а не о сломанном коде. */
    result.status = 'regressed';
    result.reason = 'провалены: ' + result.failedIds.join(', ')
      + (result.timedOutIds.length > 0 ? ' (таймаут: ' + result.timedOutIds.join(', ') + ')' : '');
  }
  return result;
}

const tasks = taskDirs();
const report = {
  version: 2,
  kind: 'regress',
  createdAt: new Date().toISOString(),
  repo,
  head: headCommit(repo),
  strict,
  baseline: null,
  tasks: [],
};

if (tasks.length === 0) {
  console.log('task-regress: принятых заданий нет (в ' + path.relative(repo, tasksRoot) + ')');
  process.exit(0);
}

for (const taskDir of tasks) {
  try {
    report.tasks.push(await regressTask(taskDir, allowlistForTask));
  } catch (err) {
    report.tasks.push({
      task: path.basename(taskDir),
      dir: path.relative(repo, taskDir).split(path.sep).join('/'),
      status: 'error',
      provenance: 'error',
      reason: err.message,
      results: [],
    });
  }
}

report.allowlist = {
  source: allowlistState.source,
  files: allowlistState.files,
  entries: allowlistState.global
    ? allowlistState.global.entries.length
    : allowlistState.files.reduce((sum, item) => sum + item.entries, 0),
  problems: allowlistState.problems,
};

/* Baseline: осознанный долг, зафиксированный в репозитории. */
const baselinePath = argv.baseline ? path.resolve(repo, String(argv.baseline)) : null;
const baseline = baselinePath && exists(baselinePath)
  ? loadBaseline(fs.readFileSync(baselinePath, 'utf8'))
  : null;
if (baseline) {
  report.baseline = { file: path.relative(repo, baselinePath).split(path.sep).join('/'), entries: baseline.entries.length, generatedAt: baseline.generatedAt };
  for (const item of report.tasks) {
    const entry = baselineEntry(baseline, item.task, item.provenance);
    if (!entry) continue;
    item.expiredBaseline = isExpired(entry);
    item.baseline = entry;
    /*
     * Только законный долг можно «погасить» baseline. Регресс остаётся регрессом:
     * baseline фиксирует, что красного не было, а не разрешение ломаться.
     */
    if (item.provenance === 'unproven-lawful' && item.status === 'unproven-lawful') {
      item.status = 'baselined';
    }
  }
}

const counts = {};
for (const item of report.tasks) counts[item.status] = (counts[item.status] || 0) + 1;
const timeouts = report.tasks.filter((item) => (item.timedOutIds || []).length > 0).length;
const allowedCount = report.tasks.reduce((sum, item) => sum + (item.allowed || []).length, 0);
const allowedExpired = report.tasks.reduce((sum, item) => sum + (item.allowed || []).filter((entry) => entry.expired).length, 0);
report.summary = {
  total: report.tasks.length,
  ...counts,
  ...(allowedCount > 0 ? { allowed: allowedCount } : {}),
  ...(allowedExpired > 0 ? { allowlistExpired: allowedExpired } : {}),
  ...(timeouts > 0 ? { timeout: timeouts } : {}),
};

const writeBaselinePath = argv['write-baseline'] ? path.resolve(repo, String(argv['write-baseline'])) : null;
if (writeBaselinePath) {
  const reviewBy = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const entries = baselineCandidates(report.tasks, { includeViolations: Boolean(argv['include-violations']) })
    .map((entry) => ({ ...entry, since: new Date().toISOString().slice(0, 10), reviewBy }));
  writeJson(writeBaselinePath, { version: 1, generatedAt: new Date().toISOString(), entries });
  console.log('task-regress: baseline записан в ' + path.relative(repo, writeBaselinePath) + ' (' + entries.length + ' записей)');
}

const out = String(argv.out || '');
if (out) writeJson(path.resolve(repo, out), report);

if (argv.json) {
  console.log(JSON.stringify(report, null, 2));
} else {
  console.log('task-regress: ' + report.summary.total + ' задач(и)' + (strict ? ' [strict]' : ''));
  if (report.allowlist && report.allowlist.entries > 0) {
    console.log('  allowlist: ' + report.allowlist.entries + ' записей (' + (report.allowlist.source || 'legacy') + ')');
  }
  for (const problem of report.allowlist && report.allowlist.problems ? report.allowlist.problems : []) {
    console.log('  WARN allowlist: ' + problem);
  }
  for (const item of report.tasks) {
    const mark = item.status.toUpperCase();
    const extra = item.baseline
      ? '  baseline' + (item.expiredBaseline ? ' ПРОСРОЧЕН (' + item.baseline.reviewBy + ')' : ' до ' + (item.baseline.reviewBy || '—'))
      : '';
    console.log('  ' + mark.padEnd(20) + ' ' + item.task + '  ' + (item.reason || '') + extra);
    for (const allowed of item.allowed || []) {
      const term = allowed.reviewBy
        ? (allowed.expired ? ' ПРОСРОЧЕН ' + allowed.reviewBy : ' до ' + allowed.reviewBy)
        : ' без срока';
      console.log('      ДОПУЩЕНО ' + allowed.id + term + '  ' + allowed.reason);
    }
    for (const result of item.results || []) {
      if (result.passed === false && !result.allowedBy) {
        console.log('      ' + result.id + (result.timedOut ? ' (таймаут)' : '') + '  '
          + formatMs(result.durationMs) + '  ' + (result.reasons || []).join('; '));
      }
    }
  }
  console.log('Итог: ' + Object.entries(report.summary).filter(([key]) => key !== 'total').map(([key, value]) => key + ' ' + value).join(', '));
}

/* Exit: регресс, ошибка, недоверенная запись и нарушение — всегда; долг — по правилам. */
const failing = report.tasks.filter((item) => shouldFail(item, strict));
process.exit(failing.length > 0 ? 1 : 0);
