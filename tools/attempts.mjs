#!/usr/bin/env node
/*
 * 0126 (2.6.106): счётчик попыток и переделок из журнала ворот.
 *
 * Замер structure (docs/analysis/subagents-workflow-causes.md, причины 3–4): 16 лишних
 * прогонов review/accept, и «rework vs повтор» не разделены — run-store не может
 * посчитать попытки. Поле attempts в acceptance.json требует смены схемы записи
 * (v7), поэтому счётчик живёт отдельным инструментом поверх уже существующих
 * артефактов: gates.jsonl (строки red/verify/accept с вердиктами) и notes записи
 * приёмки (причина переделки после 2.6.105 помечается «rework: …»).
 *
 *   node tools/attempts.mjs [--tasks <каталог>] [--task <id>] [--json]
 *
 * Коды: 0 — посчитано (в том числе когда задач нет), 2 — ошибка аргументов.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PKG = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const NL = String.fromCharCode(10);

const argv = process.argv.slice(2);
if (argv.includes('--help') || argv.includes('-h')) {
  process.stdout.write('attempts: node tools/attempts.mjs [--tasks <каталог>] [--task <id>] [--json]' + NL);
  process.exit(0);
}
function valueOf(flag) {
  const at = argv.indexOf(flag);
  return at >= 0 && argv[at + 1] !== undefined && !String(argv[at + 1]).startsWith('--') ? String(argv[at + 1]) : '';
}
const tasksRoot = path.resolve(valueOf('--tasks') || path.join(PKG, 'docs', 'tasks'));
const onlyTask = valueOf('--task').trim();
const asJson = argv.includes('--json');

if (!fs.existsSync(tasksRoot)) {
  process.stderr.write('attempts: нет каталога задач ' + tasksRoot + NL);
  process.exit(2);
}

function readGateRows(file) {
  let text = '';
  try { text = fs.readFileSync(file, 'utf8'); } catch { return []; }
  const rows = [];
  for (const line of text.replaceAll(String.fromCharCode(13), '').split(NL)) {
    if (line.trim() === '') continue;
    try {
      const row = JSON.parse(line);
      if (row && typeof row === 'object' && !Array.isArray(row)) rows.push(row);
    } catch { /* битая строка журнала не валит счётчик */ }
  }
  return rows;
}

function reworkReasons(dir) {
  const file = path.join(dir, 'acceptance.json');
  let record = null;
  try { record = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return []; }
  const notes = record && typeof record.notes === 'string' ? record.notes : '';
  return notes.split(';').map((part) => part.trim())
    .filter((part) => part.startsWith('rework:'))
    .map((part) => part.slice('rework:'.length).trim())
    .filter(Boolean);
}

const names = fs.readdirSync(tasksRoot, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort();
const report = [];
for (const name of names) {
  if (onlyTask !== '' && name !== onlyTask) continue;
  const dir = path.join(tasksRoot, name);
  const rows = readGateRows(path.join(dir, 'gates.jsonl'));
  const counts = { red: 0, verify: 0, accept: 0 };
  const verdicts = [];
  for (const row of rows) {
    const kind = String(row.kind || '');
    if (Object.prototype.hasOwnProperty.call(counts, kind)) counts[kind] += 1;
    if (row.verdict) verdicts.push(String(row.verdict));
  }
  const rework = reworkReasons(dir);
  const total = counts.red + counts.verify + counts.accept;
  if (total === 0 && rework.length === 0) continue;
  report.push({ task: name, ...counts, total, lastVerdict: verdicts.length > 0 ? verdicts[verdicts.length - 1] : null, rework });
}

if (asJson) {
  process.stdout.write(JSON.stringify({ tasksRoot, count: report.length, tasks: report }, null, 2) + NL);
} else {
  process.stdout.write('attempts: ' + tasksRoot + NL);
  if (report.length === 0) process.stdout.write('  нет задач с журналом ворот' + NL);
  for (const item of report) {
    process.stdout.write('  ' + item.task + '  red=' + item.red + ' verify=' + item.verify + ' accept=' + item.accept
      + '  последний ' + (item.lastVerdict || '—')
      + (item.rework.length > 0 ? '  переделки: ' + item.rework.join(' | ') : '') + NL);
  }
}
process.exit(0);
