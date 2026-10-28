#!/usr/bin/env node
/*
 * task-guard — коммит и пуш без задания отклоняются (2.5.0).
 *
 * Проверка стоит на границе истории: изменение, которое не покрыто активным
 * заданием, не должно попасть ни в коммит, ни в push. Покрытие (решение D3):
 *
 *   1. путь входит в allowedPaths задания, активного В ТОМ ЖЕ ДЕРЕВЕ, где лежит
 *      изменение: у задания есть criteria.lock и нет acceptance.json;
 *   2. путь лежит в каталоге задания docs/tasks/<id>/** — целиком, пока задание
 *      не закрыто, и только его артефакты (acceptance.json, отчёты, verify/red,
 *      criteria.lock, attack.json) после закрытия: запись о приёмке — тоже
 *      коммит, и порядок «приёмка → коммит → пуш» не должен блокироваться;
 *   3. путь входит в guard.allow;
 *   4. в сообщении коммита есть метка обхода guard.bypassMarker — осознанный
 *      разовый обход; он остаётся в аудите (--audit).
 *
 * Режимы:
 *   --staged [--message <text>]   проверка индекса (exit 1 + пути, если не покрыто)
 *   --range <from..to>            проверка каждого коммита диапазона
 *   --audit [--range <from..to>]  отчёт: метки обхода и нарушения; всегда exit 0
 *
 * Почему --range оценивает каждый коммит отдельно. Смотреть на текущее рабочее
 * дерево нельзя: после приёмки acceptance.json закрывает задание, и штатный
 * коммит, сделанный при открытом задании, при пуше выглядел бы «вне задания»
 * (дефект P1 задания 0004). Поэтому покрытие берётся из дерева самого коммита
 * (git ls-tree/cat-file на его ревизии), а метка обхода — из его сообщения:
 * у push нет --message, сообщения читаются из диапазона (дефект P2).
 *
 * Настройки — docs/subagent-workflow/workflow.config.json, блок guard:
 *   { "enabled": true, "mode": "fail", "allow": [], "bypassMarker": "workflow-bypass" }
 * Настройки читаются из рабочего дерева (это действующая политика сейчас), а
 * состояние заданий — из коммита (это факт истории).
 *
 * Инвариант 2.5.0: при guard.enabled !== true скрипт ничего не делает — exit 0
 * и ни одной строки вывода (кроме явного --audit, который говорит, что выключен).
 *
 * Пределы честные: git commit --no-verify и git push --no-verify пропускают
 * хуки целиком, следа в аудите не остаётся. Аудит показывает метки обхода, а
 * не запрещает их.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  exists,
  fail,
  git,
  loadConfig,
  matchesAny,
  parseArgv,
  parseTaskMeta,
  readText,
  toPosix,
} from './lib/common.mjs';

const DEFAULT_BYPASS_MARKER = 'workflow-bypass';
const GUARD_MODES = ['fail', 'warn', 'off'];
const HERE = fileURLToPath(import.meta.url);

/*
 * Артефакты задания, которые остаются покрытыми и после появления записи о
 * приёмке: metadata-коммит с acceptance.json — часть штатного порядка, а не
 * изменение «вне задания». task.md и criteria.json сюда не входят: контракт
 * закрытого задания молча менять нельзя.
 */
const CLOSED_TASK_ARTIFACTS = new Set([
  'acceptance.json', 'report.md', 'report.json',
  'verify.json', 'verify.log', 'red.json', 'red.log',
  'criteria.lock', 'attack.json',
]);

const USAGE = [
  'Usage: node task-guard.mjs --repo <dir> --staged [--message <text>]',
  '       node task-guard.mjs --repo <dir> --range <from..to>',
  '       node task-guard.mjs --repo <dir> --audit [--range <from..to>]',
  '',
  '  --staged    проверить индексированные изменения (exit 1, если путь не покрыт)',
  '  --range     проверить каждый коммит диапазона (сообщения читаются из коммитов)',
  '  --audit     печатать метки обхода и нарушения; всегда exit 0',
  '  --message   сообщение создаваемого коммита для поиска метки (только --staged)',
].join('\n');

/** Блок guard из workflow.config.json с умолчаниями пакета. */
function guardSettings(config) {
  const raw = (config && config.guard && typeof config.guard === 'object' && !Array.isArray(config.guard))
    ? config.guard
    : {};
  const mode = GUARD_MODES.includes(raw.mode) ? raw.mode : 'fail';
  return {
    enabled: raw.enabled === true,
    mode,
    allow: Array.isArray(raw.allow) ? raw.allow.map(String) : [],
    bypassMarker: typeof raw.bypassMarker === 'string' && raw.bypassMarker.trim() !== ''
      ? raw.bypassMarker.trim()
      : DEFAULT_BYPASS_MARKER,
  };
}

function parseTaskMetaSafe(text) {
  try {
    const meta = parseTaskMeta(text);
    return meta && typeof meta === 'object' && !Array.isArray(meta) ? meta : null;
  } catch {
    return null;
  }
}

function taskFromMeta(id, dir, meta, { hasLock, hasAcceptance }) {
  return {
    id: String(meta.id || id),
    dir,
    allowedPaths: Array.isArray(meta.allowedPaths) ? meta.allowedPaths.map(String) : [],
    active: hasLock && !hasAcceptance,
    open: !hasAcceptance,
  };
}

/** Состояние заданий в рабочем дереве — для проверки индекса. */
function coverageFromWorktree(repo, config) {
  const tasksDirRel = toPosix(config.tasksDir || 'docs/tasks');
  const tasksDir = path.join(repo, tasksDirRel);
  const tasks = [];
  let entries = [];
  try {
    entries = exists(tasksDir) ? fs.readdirSync(tasksDir, { withFileTypes: true }) : [];
  } catch {
    entries = [];
  }
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
    const dir = path.join(tasksDir, entry.name);
    const taskMd = path.join(dir, 'task.md');
    if (!exists(taskMd)) continue;
    const meta = parseTaskMetaSafe(readText(taskMd));
    if (!meta) continue;
    tasks.push(taskFromMeta(entry.name, tasksDirRel + '/' + entry.name, meta, {
      hasLock: exists(path.join(dir, 'criteria.lock')),
      hasAcceptance: exists(path.join(dir, 'acceptance.json')),
    }));
  }
  return { tasksDirRel, tasks };
}

/**
 * Состояние заданий В ДЕРЕВЕ КОММИТА. Один git ls-tree на коммит (только каталог
 * заданий) и кэш содержимого task.md по blob-хешу: у соседних коммитов
 * контракт обычно тот же самый.
 */
function coverageFromCommit(repo, config, rev, cache) {
  const cacheKey = 'coverage:' + rev;
  if (cache.has(cacheKey)) return cache.get(cacheKey);
  const tasksDirRel = toPosix(config.tasksDir || 'docs/tasks');
  const prefix = tasksDirRel + '/';
  const tasks = [];
  const listing = git(repo, ['ls-tree', '-r', '-z', '--full-tree', rev, '--', tasksDirRel]);
  if (listing.exitCode === 0) {
    const byTask = new Map();
    for (const chunk of String(listing.stdout || '').split('\u0000')) {
      if (!chunk) continue;
      const match = /^\d+ \w+ ([0-9a-f]+)\t(.+)$/.exec(chunk);
      if (!match) continue;
      const file = toPosix(match[2]);
      if (!file.startsWith(prefix)) continue;
      const rest = file.slice(prefix.length);
      const slash = rest.indexOf('/');
      if (slash <= 0) continue;
      const id = rest.slice(0, slash);
      if (!byTask.has(id)) byTask.set(id, new Map());
      byTask.get(id).set(rest.slice(slash + 1), match[1]);
    }
    for (const [id, files] of byTask) {
      const taskBlob = files.get('task.md');
      if (!taskBlob) continue;
      const blobKey = 'blob:' + taskBlob;
      let text = cache.get(blobKey);
      if (text === undefined) {
        const show = git(repo, ['cat-file', 'blob', taskBlob]);
        text = show.exitCode === 0 ? String(show.stdout || '') : '';
        cache.set(blobKey, text);
      }
      const meta = parseTaskMetaSafe(text);
      if (!meta) continue;
      tasks.push(taskFromMeta(id, prefix + id, meta, {
        hasLock: files.has('criteria.lock'),
        hasAcceptance: files.has('acceptance.json'),
      }));
    }
  }
  const coverage = { tasksDirRel, tasks, rev };
  cache.set(cacheKey, coverage);
  return coverage;
}

function parseNameList(raw) {
  return String(raw || '').split('\u0000').filter(Boolean).map(toPosix);
}

function stagedPaths(repo) {
  const result = git(repo, ['diff', '--cached', '--name-only', '-z', '--']);
  if (result.exitCode !== 0) {
    fail('git diff --cached не выполнился: ' + String(result.stderr || '').trim(), 2);
  }
  return parseNameList(result.stdout);
}

/** Пути одного коммита — без опоры на родителя: работает и для корневого. */
function commitPaths(repo, sha) {
  const result = git(repo, ['diff-tree', '--root', '--no-commit-id', '--name-only', '-r', '-z', sha, '--']);
  if (result.exitCode !== 0) return [];
  return parseNameList(result.stdout);
}

function commitsInRange(repo, range) {
  const result = git(repo, ['rev-list', '--reverse', range, '--']);
  if (result.exitCode !== 0) {
    fail('git rev-list ' + range + ' не выполнился: ' + String(result.stderr || '').trim(), 2);
  }
  return String(result.stdout || '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
}

function commitMessage(repo, sha) {
  const result = git(repo, ['show', '-s', '--format=%s%n%b', sha]);
  return result.exitCode === 0 ? String(result.stdout || '') : '';
}

function hasMarker(message, marker) {
  const text = String(message || '').toLowerCase();
  const needle = String(marker || '').toLowerCase();
  return needle !== '' && text.includes(needle);
}

function firstLine(text) {
  return String(text || '').split(/\r?\n/).map((line) => line.trim()).find(Boolean) || '';
}

/**
 * Чем покрыт путь: guard.allow, каталог задания (целиком — пока открыто, только
 * артефакты — после закрытия), allowedPaths задания, активного в этом дереве.
 */
function coverageHit(rel, coverage, guard) {
  if (matchesAny(rel, guard.allow)) return 'guard.allow';
  for (const task of coverage.tasks) {
    const inside = rel === task.dir || rel.startsWith(task.dir + '/');
    if (inside) {
      if (task.open) return 'каталог задания ' + task.id;
      if (CLOSED_TASK_ARTIFACTS.has(rel.slice(rel.lastIndexOf('/') + 1))) {
        return 'запись задания ' + task.id;
      }
      continue;
    }
    if (task.active && task.allowedPaths.length > 0 && matchesAny(rel, task.allowedPaths)) {
      return 'задание ' + task.id;
    }
  }
  return null;
}

function evaluate(paths, coverage, guard) {
  const covered = [];
  const uncovered = [];
  for (const rel of paths) {
    const hit = coverageHit(rel, coverage, guard);
    if (hit) covered.push({ path: rel, by: hit });
    else uncovered.push(rel);
  }
  return { covered, uncovered };
}

/** Один коммит: метка из его сообщения, покрытие — из его дерева. */
function evaluateCommit(repo, config, guard, rev, cache) {
  const message = commitMessage(repo, rev);
  const paths = commitPaths(repo, rev);
  if (hasMarker(message, guard.bypassMarker)) {
    return { rev, message, bypass: true, covered: paths.map((p) => ({ path: p, by: 'bypass' })), uncovered: [] };
  }
  const result = evaluate(paths, coverageFromCommit(repo, config, rev, cache), guard);
  return { rev, message, bypass: false, covered: result.covered, uncovered: result.uncovered };
}

function guardRel(repo) {
  return toPosix(path.relative(repo, HERE)) || 'docs/subagent-workflow/scripts/task-guard.mjs';
}

function hints(repo, guard) {
  return [
    'Покрытие (D3): allowedPaths задания, активного в том же коммите (criteria.lock есть,',
    'acceptance.json нет), каталог задания (после закрытия — его артефакты), guard.allow',
    'или метка обхода в сообщении коммита.',
    'Осознанный обход — метка "' + guard.bypassMarker + '" в сообщении коммита, например:',
    '  git commit -m "hotfix [' + guard.bypassMarker + ': причина]"',
    'След обхода остаётся в аудите: node ' + guardRel(repo) + ' --repo . --audit',
    'git commit --no-verify / git push --no-verify пропускают хуки целиком — следа не будет.',
  ];
}

function printStagedUncovered(repo, uncovered, guard) {
  const header = guard.mode === 'warn'
    ? 'task-guard: WARN — изменение вне активного задания (guard.mode=warn, коммит не отклонён)'
    : 'task-guard: коммит отклонён — изменение вне активного задания';
  const lines = [header];
  for (const rel of uncovered) lines.push('  не покрыт: ' + rel);
  lines.push('');
  lines.push(...hints(repo, guard));
  console.error(lines.join('\n'));
}

function printRangeUncovered(repo, range, failures, guard) {
  const header = guard.mode === 'warn'
    ? 'task-guard: WARN — в диапазоне есть коммиты вне заданий (guard.mode=warn, пуш не отклонён)'
    : 'task-guard: пуш отклонён — в диапазоне есть коммиты вне активных заданий';
  const lines = [header, '  диапазон: ' + range];
  for (const failure of failures) {
    lines.push('  ' + failure.rev.slice(0, 12) + ' ' + firstLine(failure.message) + ' — не покрыт: ' + failure.uncovered.join(', '));
  }
  lines.push('');
  lines.push(...hints(repo, guard));
  console.error(lines.join('\n'));
}

function checkRange(repo, config, guard, range) {
  const cache = new Map();
  const commits = commitsInRange(repo, range);
  const failures = [];
  for (const rev of commits) {
    const result = evaluateCommit(repo, config, guard, rev, cache);
    if (result.uncovered.length > 0) failures.push(result);
  }
  if (failures.length === 0) return 0;
  printRangeUncovered(repo, range, failures, guard);
  return guard.mode === 'warn' ? 0 : 1;
}

function auditRange(repo, config, guard, range) {
  const cache = new Map();
  const commits = commitsInRange(repo, range);
  const lines = ['task-guard: аудит диапазона ' + range + ' (коммитов: ' + commits.length + ')'];
  let markers = 0;
  let violations = 0;
  for (const rev of commits) {
    const result = evaluateCommit(repo, config, guard, rev, cache);
    const short = rev.slice(0, 12);
    const subject = firstLine(result.message);
    if (result.bypass) {
      markers += 1;
      lines.push('  ' + short + ' ' + subject + ' — обход по метке "' + guard.bypassMarker + '"');
      continue;
    }
    if (result.uncovered.length === 0) {
      lines.push('  ' + short + ' ' + subject + ' — покрыт (' + result.covered.length + ')');
      continue;
    }
    violations += result.uncovered.length;
    lines.push('  ' + short + ' ' + subject + ' — не покрыт: ' + result.uncovered.join(', '));
  }
  lines.push('  итог: меток обхода ' + markers + ', непокрытых путей ' + violations);
  console.log(lines.join('\n'));
  return 0;
}

function auditStaged(repo, config, guard) {
  const result = evaluate(stagedPaths(repo), coverageFromWorktree(repo, config), guard);
  const lines = ['task-guard: аудит индекса (сообщение создаваемого коммита здесь недоступно — его видит commit-msg)'];
  for (const rel of result.uncovered) lines.push('  не покрыт: ' + rel);
  lines.push('  итог: покрыто ' + result.covered.length + ', не покрыто ' + result.uncovered.length);
  console.log(lines.join('\n'));
  return 0;
}

function main() {
  const argv = parseArgv(process.argv.slice(2));
  if (argv.help) {
    console.log(USAGE);
    return 0;
  }
  const repo = path.resolve(String(argv.repo || process.cwd()));
  if (!exists(repo)) fail('нет каталога: ' + repo, 2);
  const audit = Boolean(argv.audit);
  const staged = Boolean(argv.staged);
  const rangeValue = argv.range;
  const range = typeof rangeValue === 'string' ? rangeValue.trim() : null;
  if (rangeValue === true) fail('--range требует значение <from..to>', 2);
  if (staged && range) fail('--staged и --range вместе не поддерживаются', 2);
  if (!staged && !range && !audit) {
    console.log(USAGE);
    return 2;
  }
  if (range !== null && (range === '' || range.startsWith('-'))) {
    fail('--range: ожидается <from..to>, получено "' + range + '"', 2);
  }

  const config = loadConfig(repo);
  const guard = guardSettings(config);
  if (!guard.enabled) {
    if (audit) console.log('task-guard: guard выключен (guard.enabled !== true) — аудит не выполняется');
    return 0;
  }

  if (audit) {
    if (range !== null) return auditRange(repo, config, guard, range);
    return auditStaged(repo, config, guard);
  }
  if (guard.mode === 'off') return 0;

  if (staged) {
    /*
     * Сообщение создаваемого коммита передаёт commit-msg: у индекса его нет.
     * Для --range --message не используется — там сообщения читаются из коммитов.
     */
    const message = typeof argv.message === 'string' ? argv.message : '';
    if (hasMarker(message, guard.bypassMarker)) {
      console.log('task-guard: обход по метке "' + guard.bypassMarker + '" — коммит допущен, след остаётся в аудите');
      return 0;
    }
    const result = evaluate(stagedPaths(repo), coverageFromWorktree(repo, config), guard);
    if (result.uncovered.length === 0) return 0;
    printStagedUncovered(repo, result.uncovered, guard);
    return guard.mode === 'warn' ? 0 : 1;
  }

  return checkRange(repo, config, guard, range);
}

try {
  process.exit(main());
} catch (error) {
  console.error('task-guard: ' + (error && error.message ? error.message : error));
  process.exit(error && error.exitCode ? error.exitCode : 2);
}
