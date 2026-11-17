#!/usr/bin/env node
/*
 * Закрытие задания без приёмки (2.6.82, ответ structure по 208/209).
 *
 * Задание, которое никогда не будет принято, не должно оставаться активным:
 * пока оно активно, его allowedPaths расширяют гейт записи, а сам контракт
 * нельзя ни удалить, ни сузить (правка allowedPaths — новый контракт и новый
 * красный прогон).
 *
 * Закрытие — отдельный факт, а не приёмка:
 *   acceptance.json — «исполнено и доказано»;
 *   closure.json    — «не будет принято: брошено или заменено».
 * Смешивать их нельзя: один файл не может означать и то, и другое.
 *
 * Формат closure.json:
 *   { version: 1, task, status: 'closed'|'superseded', reason, by, at,
 *     successor: '<id>'|null, evidence: [] }
 *
 * Пишет только этот скрипт (руками файл не заводится): на каждое действие —
 * строка аудита docs/subagent-workflow/audit/task-closures.jsonl.
 *
 * Использование:
 *   node task-close.mjs --task <dir> --status closed|superseded --reason "<почему>" --by "<кто>"
 *     [--successor <id>] [--evidence <письмо|отчёт>]... [--delete-contract] [--full]
 *     [--repo <dir>] [--dry-run] [--json]
 *
 * --delete-contract удаляет task.md и criteria.json (контракт остаётся в
 * git-истории); --full добавляет артефакты задания (criteria.lock, red*,
 * verify*, attack.json, report*, preflight.json). Для активного (не закрытого)
 * задания удаление запрещено — это делает только сам task-close в том же
 * действии, которым пишется closure.json.
 */
import fs from 'node:fs';
import path from 'node:path';
import {
  parseArgv, parseTaskMeta, readText, exists, writeJson, repoRoot, relPosix, toPosix,
  TASK_ARTIFACTS, isMainModule, loadConfig,
} from './lib/common.mjs';

export const CLOSURE_FILE = 'closure.json';
export const CLOSURE_VERSION = 1;

/** Файл аудита закрытий: одна строка JSON на действие. */
export function auditFile(repo) {
  return path.join(repo, 'docs', 'subagent-workflow', 'audit', 'task-closures.jsonl');
}

/** Запись закрытия каталога, если она есть. */
export function closureOf(taskDir) {
  const file = path.join(taskDir, CLOSURE_FILE);
  return exists(file) ? JSON.parse(readText(file)) : null;
}

function fail(message) {
  const err = new Error(message);
  err.exitCode = 1;
  throw err;
}

function requiredString(value, label) {
  const text = typeof value === 'string' ? value.trim() : '';
  if (text === '') fail(label + ' обязателен и не может быть пустым');
  return text;
}

/** Список файлов, которые удаляются вместе с контрактом. */
export function contractFilesToDelete(full) {
  const base = ['task.md', 'criteria.json'];
  if (!full) return base;
  const extra = [...TASK_ARTIFACTS].filter((name) => name !== 'acceptance.json' && name !== 'task.md' && name !== 'criteria.json');
  /* attack.json — разбор атаки спецификации; preflight.json — предполёт контракта. */
  return [...base, ...extra, 'attack.json', 'preflight.json'];
}

/**
 * Закрыть задание. Бросает Error с причиной отказа; при успехе возвращает
 * { closure, audit, deleted, closureFile }.
 */
export function closeTask(options) {
  const {
    repo,
    taskDir,
    status,
    reason,
    by,
    successor = null,
    evidence = [],
    deleteContract = false,
    full = false,
    at = new Date().toISOString(),
  } = options || {};

  const dir = path.resolve(String(taskDir || ''));
  if (!exists(dir)) fail('каталог задания не найден: ' + dir);
  /*
   * Порядок отказов: сначала состояние каталога (закрыт/принят) — оно
   * объясняет, почему действие невозможно, даже если контракт уже удалён
   * прошлым закрытием. Потом — наличие контракта.
   */
  if (exists(path.join(dir, CLOSURE_FILE))) {
    fail('задание уже закрыто (closure.json): повторное закрытие запрещено — закрытие окончательное, переоткрытие идёт новым id');
  }
  if (exists(path.join(dir, 'acceptance.json'))) {
    fail('задание уже принято (acceptance.json): закрытие без приёмки не применяется — у принятого задания есть доказательство исполнения');
  }
  const taskMd = path.join(dir, 'task.md');
  if (!exists(taskMd)) fail('нет task.md: это не контракт задания: ' + dir);
  if (!['closed', 'superseded'].includes(String(status))) fail('status должен быть closed или superseded');
  const reasonText = requiredString(reason, '--reason');
  const byText = requiredString(by, '--by');
  let meta = null;
  try { meta = parseTaskMeta(readText(taskMd)); } catch { meta = null; }
  const id = String((meta && meta.id) || path.basename(dir));
  const successorText = successor === null || successor === undefined || String(successor).trim() === ''
    ? null
    : String(successor).trim();
  if (successorText !== null) {
    if (!/^\d{4}$/u.test(successorText)) fail('--successor должен быть номером задания из 4 цифр');
    if (successorText === id) fail('--successor не может совпадать с закрываемым заданием');
  }
  const evidenceList = (Array.isArray(evidence) ? evidence : [evidence])
    .map((item) => String(item || '').trim())
    .filter((item) => item !== '');

  const closure = {
    version: CLOSURE_VERSION,
    task: id,
    status: String(status),
    reason: reasonText,
    by: byText,
    at: String(at),
    successor: successorText,
    evidence: evidenceList,
  };
  const closureFile = path.join(dir, CLOSURE_FILE);
  const auditPath = auditFile(repo);
  const deleted = [];

  if (options.dryRun) {
    return { closure, closureFile, audit: auditPath, deleted: deleteContract ? contractFilesToDelete(full) : [], dryRun: true };
  }

  writeJson(closureFile, closure);
  let deleteError = null;
  if (deleteContract) {
    for (const name of contractFilesToDelete(full)) {
      const target = path.join(dir, name);
      if (!exists(target)) continue;
      try {
        fs.rmSync(target, { force: true });
        deleted.push(name);
      } catch (error) {
        /* Аудит обязан состояться и при сбое удаления: иначе действие невидимо. */
        deleteError = error;
        break;
      }
    }
  }
  const audit = {
    version: CLOSURE_VERSION,
    at: closure.at,
    task: id,
    dir: toPosix(relPosix(repo, dir)),
    status: closure.status,
    reason: closure.reason,
    by: closure.by,
    successor: closure.successor,
    evidence: closure.evidence,
    deleted,
    deleteContract: Boolean(deleteContract),
  };
  if (deleteError) audit.error = String(deleteError.message || deleteError);
  fs.mkdirSync(path.dirname(auditPath), { recursive: true });
  fs.appendFileSync(auditPath, JSON.stringify(audit) + String.fromCharCode(10), 'utf8');
  if (deleteError) fail('closure.json записан, но удаление не завершено (' + deleted.join(', ') + '): ' + String(deleteError.message || deleteError));
  return { closure, closureFile, audit: auditPath, deleted, dryRun: false };
}

if (isMainModule(import.meta.url)) {
  const argv = parseArgv(process.argv.slice(2));
  if (argv.help) {
    console.log('Usage: node task-close.mjs --task <dir> --status closed|superseded --reason "<почему>" --by "<кто>"');
    console.log('       [--successor <id>] [--evidence <ссылка>]... [--delete-contract] [--full] [--repo <dir>] [--dry-run] [--json]');
    process.exit(0);
  }
  const taskDir = path.resolve(argv.task || argv._[0] || '.');
  const repo = path.resolve(argv.repo || repoRoot(taskDir));
  const config = loadConfig(repo);
  /* --evidence можно указать несколько раз: parseArgv хранит только последнее значение. */
  const rawArgs = process.argv.slice(2);
  const evidence = [];
  for (let i = 0; i < rawArgs.length; i += 1) {
    if (rawArgs[i] === '--evidence' && rawArgs[i + 1] !== undefined && !rawArgs[i + 1].startsWith('--')) {
      evidence.push(rawArgs[i + 1]);
      i += 1;
    }
  }
  try {
    const result = closeTask({
      repo,
      taskDir,
      status: argv.status,
      reason: argv.reason,
      by: argv.by,
      successor: argv.successor,
      evidence,
      deleteContract: Boolean(argv['delete-contract']),
      full: Boolean(argv.full),
      dryRun: Boolean(argv['dry-run']),
    });
    if (argv.json) {
      console.log(JSON.stringify({ ok: true, ...result }, null, 2));
    } else {
      const c = result.closure;
      console.log('task-close: ' + c.task + ' ' + c.status + (result.dryRun ? ' (dry-run)' : '') + ' — ' + c.reason);
      console.log('  closure: ' + relPosix(repo, result.closureFile));
      console.log('  audit: ' + relPosix(repo, result.audit));
      if (c.successor) console.log('  successor: ' + c.successor);
      if (result.deleted.length) console.log('  удалено: ' + result.deleted.join(', '));
      if (result.deleted.length > 0 && !result.dryRun) {
        const marker = (config.guard && config.guard.bypassMarker) || 'workflow-bypass';
        console.log('  коммит: docs/tasks не защищён guard; при включённом guard удаление контракта идёт с меткой [' + marker + ': закрытие без приёмки — task-close]');
      }
      if (result.dryRun) console.log('  dry-run: файлы не изменены');
    }
    process.exit(0);
  } catch (error) {
    const message = error && error.message ? error.message : String(error);
    if (argv.json) console.log(JSON.stringify({ ok: false, error: message }, null, 2));
    else console.error('task-close: ' + message);
    process.exit(1);
  }
}
