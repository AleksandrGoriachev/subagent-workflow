#!/usr/bin/env node
/*
 * 2.6.17 (0046, WC-12): независимые критерии ворот идут параллельно — доказывается
 * НАЛОЖЕНИЕМ интервалов, а не настенным временем.
 *
 * Первая версия (0045) мерила стену: три критерия по 1,2 с обязаны уложиться в 2,5 с.
 * Внутри пула тот же критерий соседствовал с другими, и на Windows стоимость запуска
 * процессов (cmd.exe + node ~500–700 мс) сдвигала измерение: standalone 1,7 с, рядом
 * с одним соседом 2,2–2,4 с, рядом с тремя — 2,7–3,3 с. Критерий краснел не из-за
 * логики пула, а из-за нагрузки. Здесь критерий пишет в файл метки start/end, и
 * проверяется именно перекрытие интервалов — от загрузки машины не зависит.
 *
 * Вне пакета — SKIP (конвенция deployed-copy).
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSyncPipeFree } from '../scripts/lib/common.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PKG = path.resolve(HERE, '..', '..');

if (!fs.existsSync(path.join(PKG, 'spec'))) {
  console.log('SKIP: проверка пакета вне пакета');
  process.exit(0);
}

const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-overlap-'));
const RUNNER = path.join(ROOT, 'runner.mjs');
fs.writeFileSync(RUNNER, [
  "import fs from 'node:fs';",
  'const [file, ms] = process.argv.slice(2);',
  'const t0 = Date.now();',
  'setTimeout(() => { fs.writeFileSync(file, JSON.stringify({ start: t0, end: Date.now() })); }, Number(ms));',
  '',
].join('\n'));

function truthy(value, label) {
  if (!value) throw new Error(label);
}

const common = await import(pathToFileURL(path.join(PKG, 'spec', 'scripts', 'lib', 'common.mjs')).href);

function markerCommand(dir, id, ms) {
  return 'node "' + RUNNER + '" "' + path.join(dir, id + '.json') + '" ' + ms;
}

function intervals(dir, ids) {
  const out = new Map();
  for (const id of ids) {
    const file = path.join(dir, id + '.json');
    if (!fs.existsSync(file)) continue;
    out.set(id, JSON.parse(fs.readFileSync(file, 'utf8')));
  }
  return out;
}

function overlapping(a, b) {
  return a.start < b.end && b.start < a.end;
}

async function c1() {
  truthy(typeof common.runCriteria === 'function', 'в common.mjs нет runCriteria');
  const dir = fs.mkdtempSync(path.join(ROOT, 'c1-'));
  const ids = ['A', 'B', 'C'];
  const criteria = ids.map((id) => ({ id, command: markerCommand(dir, id, 900) }));
  const rows = await common.runCriteria(criteria, { repo: PKG, env: { ...process.env }, timeoutMs: 60000, concurrency: 3 });
  truthy(rows.length === 3, 'строк ' + rows.length);
  truthy(rows.map((r) => r.id).join(',') === 'A,B,C', 'порядок нарушен: ' + rows.map((r) => r.id).join(','));
  truthy(rows.every((r) => r.exitCode === 0), 'не все exit 0: ' + JSON.stringify(rows.map((r) => [r.id, r.exitCode])));
  const at = intervals(dir, ids);
  truthy(at.size === 3, 'метки интервалов не все: ' + [...at.keys()].join(','));
  const pairs = [['A', 'B'], ['A', 'C'], ['B', 'C']];
  const overlapped = pairs.filter(([x, y]) => overlapping(at.get(x), at.get(y)));
  truthy(overlapped.length >= 2, 'интервалы не перекрываются (' + overlapped.length + ' из 3): '
    + JSON.stringify([...at.entries()]).slice(0, 500));
  console.log('OVERLAP OK c1 (перекрытий ' + overlapped.length + ' из 3)');
}

async function c2() {
  const dir = fs.mkdtempSync(path.join(ROOT, 'c2-'));
  const criteria = [
    { id: 'A', command: markerCommand(dir, 'A', 300) },
    { id: 'B', command: 'node -e "process.exit(3)"' },
    { id: 'C', command: markerCommand(dir, 'C', 300) },
  ];
  const rows = await common.runCriteria(criteria, { repo: PKG, env: { ...process.env }, timeoutMs: 60000, concurrency: 2 });
  truthy(rows.length === 3, 'строк ' + rows.length);
  truthy(rows.find((r) => r.id === 'B').exitCode === 3, 'падение B не проброшено');
  truthy(rows.find((r) => r.id === 'A').exitCode === 0, 'A не выполнился после падения B');
  truthy(rows.find((r) => r.id === 'C').exitCode === 0, 'C не выполнился после падения B');
  console.log('OVERLAP OK c2');
}

async function c3() {
  for (const gate of ['task-red.mjs', 'task-verify.mjs', 'task-accept.mjs']) {
    const file = path.join(PKG, 'spec', 'scripts', gate);
    truthy(fs.existsSync(file), 'нет ' + gate);
    const text = fs.readFileSync(file, 'utf8');
    truthy(/runCriteria/u.test(text), gate + ' не использует runCriteria');
    const syntax = spawnSyncPipeFree(process.execPath, ['--check', file], { encoding: 'utf8' });
    truthy(syntax.status === 0, file + ': ' + String(syntax.stderr || '').trim());
  }
  const source = fs.readFileSync(path.join(PKG, 'spec', 'scripts', 'lib', 'common.mjs'), 'utf8');
  truthy(/WF_CRITERIA_PARALLEL/u.test(source), 'нет WF_CRITERIA_PARALLEL');
  truthy(/concurrency/u.test(source), 'нет concurrency');
  console.log('OVERLAP OK c3');
}

const table = { c1, c2, c3 };
const which = process.argv[2];
if (!table[which]) {
  console.log('usage: node spec/checks/criteria-overlap.mjs c1|c2|c3');
  process.exit(2);
}
try {
  await table[which]();
} catch (error) {
  console.log('OVERLAP FAIL ' + which + ': ' + (error && error.message ? error.message : error));
  process.exit(1);
}
