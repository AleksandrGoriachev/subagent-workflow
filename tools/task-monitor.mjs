#!/usr/bin/env node
/*
 * 0106 (2.6.96): монитор задач воркспейса.
 *
 * Читает docs/tasks/<id>/ (criteria.lock, red.json, verify.json, acceptance.json,
 * closure.json), выводит стадию, время с последнего артефакта и флаги проблем,
 * чтобы баг или зависшая задача были видны сразу, а не через релиз.
 *
 *   node tools/task-monitor.mjs [--json] [--publish <корень>] [--root <корень>]
 *                               [--stall-hours 6]
 *
 * Ничего не меняет в задачах. --publish пишет снимок
 * <корень>/.dsh/workflow/tasks.json (его читает /api/tasks панели).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PKG = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const DEFAULT_STALL_HOURS = 6;

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/u, ''));
  } catch {
    return null;
  }
}

function metaOf(text) {
  const match = /<!--\s*TASK-META\s*\n([\s\S]*?)\n-->/u.exec(String(text || ''));
  if (!match) return {};
  try {
    return JSON.parse(match[1]);
  } catch {
    return {};
  }
}

/** Попытки red/verify/accept из gates.jsonl и причины переделок из notes записи. */
export function countAttempts(dir) {
  const counts = { red: 0, verify: 0, accept: 0 };
  let rework = [];
  const journal = path.join(dir, 'gates.jsonl');
  if (fs.existsSync(journal)) {
    let text = '';
    try { text = fs.readFileSync(journal, 'utf8'); } catch { text = ''; }
    for (const line of text.replaceAll(String.fromCharCode(13), '').split(String.fromCharCode(10))) {
      if (line.trim() === '') continue;
      try {
        const row = JSON.parse(line);
        const kind = String((row && row.kind) || '');
        if (Object.prototype.hasOwnProperty.call(counts, kind)) counts[kind] += 1;
      } catch { /* битая строка журнала счётчик не валит */ }
    }
  }
  const acceptance = readJson(path.join(dir, 'acceptance.json'));
  const notes = acceptance && typeof acceptance.notes === 'string' ? acceptance.notes : '';
  rework = notes.split(';').map((part) => part.trim())
    .filter((part) => part.startsWith('rework:'))
    .map((part) => part.slice('rework:'.length).trim())
    .filter(Boolean);
  return { ...counts, total: counts.red + counts.verify + counts.accept, rework };
}

/** Стадия и флаги одной задачи. */
export function taskHealth(dir, now = new Date(), stallHours = DEFAULT_STALL_HOURS) {
  const taskFile = path.join(dir, 'task.md');
  if (!fs.existsSync(taskFile)) return null;
  const meta = metaOf(fs.readFileSync(taskFile, 'utf8'));
  const files = {
    contract: path.join(dir, 'criteria.lock'),
    red: path.join(dir, 'red.json'),
    verify: path.join(dir, 'verify.json'),
    acceptance: path.join(dir, 'acceptance.json'),
    closure: path.join(dir, 'closure.json'),
  };
  const red = readJson(files.red);
  const verify = readJson(files.verify);
  const acceptance = readJson(files.acceptance);
  const closure = readJson(files.closure);
  const accepted = Boolean(acceptance && acceptance.status === 'accepted');
  const closed = Boolean(closure && ['superseded', 'closed'].includes(String(closure.status)));
  const hasContract = fs.existsSync(files.contract);
  const stage = closed ? 'closed' : accepted ? 'accepted' : verify && verify.allPassed ? 'verified' : red && red.redProven ? 'red' : hasContract ? 'contract' : 'draft';
  const flags = [];
  if (closed) flags.push('superseded');
  if (red && red.redProven === false) flags.push('red-not-proven');
  if (!closed && !accepted && hasContract && !red && meta.risk && meta.risk !== 'low') flags.push('red-missing');
  if (verify && verify.allPassed === false) flags.push('verify-red');
  if (!closed && !accepted && hasContract && (meta.risk === 'medium' || meta.risk === 'high')) flags.push('no-acceptance');
  const stamps = [taskFile, ...Object.values(files)].filter((file) => fs.existsSync(file)).map((file) => fs.statSync(file).mtimeMs);
  const lastAt = stamps.length ? new Date(Math.max(...stamps)) : null;
  const stalledHours = lastAt ? Math.round(((now.getTime() - lastAt.getTime()) / 3600000) * 10) / 10 : null;
  if (!closed && !accepted && stalledHours !== null && stalledHours > stallHours) flags.push('stalled');
  /*
   * 0131 (2.6.107): попытки и переделки — в карточке задачи. Замер structure просил
   * счётчик попыток в run-store; отдельного поля в записи приёмки нет (схема требует
   * fresh:true для medium/high), поэтому считаем из журнала ворот и notes записи.
   */
  /*
   * 0133 (2.6.108): флаг — только ПОВТОРЫ. Обычный принятый пакет имеет red=1,
   * verify=1, accept=1 (три стадии), и это не «попытки»: счёт total>1 давал флаг
   * на каждой принятой задаче (79 из 110 после 2.6.107). Повтор — то, что сверх
   * первой стадии каждого вида.
   */
  const attempts = countAttempts(dir);
  /*
   * Базовая линия: принятый пакет — red=1, verify=2 (исполнитель + свежий прогон
   * приёмщика), accept=1. Повтор — второй red или второй accept; verify в норме
   * уже двойной, поэтому его считаем только свыше двух.
   */
  const repeats = Math.max(0, attempts.red - 1) + Math.max(0, attempts.accept - 1) + Math.max(0, attempts.verify - 2);
  attempts.repeats = repeats;
  if (repeats > 0) flags.push('attempts:' + repeats);
  if (attempts.rework.length > 0) flags.push('rework:' + attempts.rework.length);
  return {
    id: String(meta.id || path.basename(dir)),
    attempts,
    title: String(meta.title || ''),
    risk: String(meta.risk || ''),
    stage,
    flags,
    stalledHours,
    redProven: red ? red.redProven === true : null,
    verifyPassed: verify ? verify.allPassed === true : null,
    acceptedAt: acceptance && acceptance.acceptedAt ? String(acceptance.acceptedAt) : null,
  };
}

/** Сводка по всем задачам каталога. */
export function summarizeTasks(root, options = {}) {
  const now = options.now instanceof Date ? options.now : new Date();
  const stallHours = Number.isFinite(options.stallHours) ? options.stallHours : DEFAULT_STALL_HOURS;
  const tasksDir = path.join(path.resolve(String(root)), 'docs', 'tasks');
  const tasks = [];
  if (fs.existsSync(tasksDir)) {
    for (const name of fs.readdirSync(tasksDir)) {
      if (!/^\d{3,4}$/u.test(name)) continue;
      const dir = path.join(tasksDir, name);
      let isDir = false;
      try { isDir = fs.statSync(dir).isDirectory(); } catch { isDir = false; }
      if (!isDir) continue;
      const row = taskHealth(dir, now, stallHours);
      if (row) tasks.push(row);
    }
  }
  tasks.sort((left, right) => left.id.localeCompare(right.id));
  const byStage = {};
  for (const row of tasks) byStage[row.stage] = (byStage[row.stage] || 0) + 1;
  const flagged = tasks.filter((row) => row.flags.length > 0).map((row) => row.id);
  return {
    version: 1,
    generatedAt: now.toISOString(),
    root: path.resolve(String(root)),
    tasks,
    summary: { total: tasks.length, flagged: flagged.length, flaggedIds: flagged, byStage },
  };
}

function main() {
  const argv = process.argv.slice(2);
  const value = (flag) => { const at = argv.indexOf(flag); return at >= 0 ? argv[at + 1] : undefined; };
  const root = path.resolve(String(value('--root') || PKG));
  const stallHours = Number(value('--stall-hours')) || DEFAULT_STALL_HOURS;
  const payload = summarizeTasks(root, { stallHours });
  const publish = value('--publish');
  if (publish) {
    const target = path.join(path.resolve(String(publish)), '.dsh', 'workflow', 'tasks.json');
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, JSON.stringify(payload, null, 2) + '\n');
    console.log('task-monitor: снимок опубликован в ' + target);
    console.log('задач: ' + payload.tasks.length + ' | с флагами: ' + payload.summary.flagged);
    return;
  }
  if (argv.includes('--json')) {
    console.log(JSON.stringify(payload, null, 2));
    return;
  }
  console.log('task-monitor: ' + payload.tasks.length + ' задач, с флагами ' + payload.summary.flagged);
  for (const row of payload.tasks) {
    console.log('  ' + row.id + '  ' + row.stage.padEnd(9) + (row.flags.length ? ' флаги: ' + row.flags.join(', ') : ' ок') + (row.stalledHours !== null ? '  (' + row.stalledHours + ' ч)' : ''));
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
