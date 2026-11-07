#!/usr/bin/env node
/*
 * 0091 (WC-19): пачка приёмки 2–3 заданий.
 *
 * Обязательства:
 *  - c1: список заданий разбирается из запятых и пробелов, дубли убираются, не-четырёхзначные отвергаются;
 *  - c2: пачка больше 3 заданий отвергается (не экономит церемонию, а прячет ошибку);
 *  - c3: в каждый task-accept уходят все аргументы, кроме пачечных --tasks/--parallel;
 *  - c4: отсутствующий каталог задания виден до запуска приёмки.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseTaskList, batchPlan, forwardedArgs } from '../scripts/lib/batch-tasks.mjs';

const truthy = (value, label) => { if (!value) throw new Error(label); };
const equal = (actual, expected, label) => {
  if (actual !== expected) throw new Error(label + ': ожидалось ' + JSON.stringify(expected) + ', получено ' + JSON.stringify(actual));
};

/* c1 */
equal(JSON.stringify(parseTaskList('0110,0111 0112')), JSON.stringify(['0110', '0111', '0112']), 'c1: список');
equal(JSON.stringify(parseTaskList('0110, 0110')), JSON.stringify(['0110']), 'c1: дубли');
let rejected = 0;
for (const bad of ['010', 'ab12', '']) {
  try { parseTaskList(bad); } catch { rejected += 1; }
}
equal(rejected, 3, 'c1: неверные id отвергнуты');

/* c2 */
let tooMany = '';
try { parseTaskList('0110,0111,0112,0113'); } catch (error) { tooMany = String(error.message); }
truthy(/2–3 задания/u.test(tooMany), 'c2: пачка больше трёх отвергнута с причиной');

/* c3 */
const forwarded = forwardedArgs(['--tasks', '0110,0111', '--key', 'k.pem', '--key-id', 'agent-judge-4', '--parallel', '2', '--dry-run']);
equal(JSON.stringify(forwarded), JSON.stringify(['--key', 'k.pem', '--key-id', 'agent-judge-4', '--dry-run']), 'c3: проброс аргументов');

/* c4 */
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-batch-'));
fs.mkdirSync(path.join(root, 'docs', 'tasks', '0110'), { recursive: true });
const plan = batchPlan({ root, ids: ['0110', '0111'] });
equal(plan.missing.join(','), '0111', 'c4: отсутствующее задание');
truthy(plan.tasks.find((item) => item.id === '0110').exists, 'c4: существующее задание');
fs.rmSync(root, { recursive: true, force: true });

console.log('batch-accept: OK c1–c4');
