#!/usr/bin/env node
/*
 * 0163: реестр отклонений тени и честный статус невычислимой тени.
 *
 *   c1 — запись реестра, совпадающая с конфликтующими строками поимённо, делает
 *        сводку зелёной и печатает причину; без записи та же тень красная;
 *   c2 (негатив) — лишняя строка evidence, чужое задание, хеш не тот, пустая причина:
 *        отклонение не действует (код 1) или реестр отвергается (код 2);
 *   c3 — строка со статусом error печатается как «не вычислима», а не расхождение.
 *
 * Политику античита (0143/0144) проверка не трогает: она проверяет адресность
 * исключения, а не замену правила.
 *
 * Вне пакета — SKIP (конвенция deployed-copy).
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSyncPipeFree } from '../scripts/lib/common.mjs';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PKG = path.resolve(HERE, '..', '..');
if (!fs.existsSync(path.join(PKG, 'spec'))) {
  console.log('SKIP: проверка пакета вне пакета');
  process.exit(0);
}

const HASH_A = 'a'.repeat(64);
const HASH_B = 'b'.repeat(64);
const HASH_C = 'c'.repeat(64);

const mode = String(process.argv[2] || '').toLowerCase();
let bad = 0;
function fail(tag, message) { bad += 1; console.log('FAIL ' + tag + ': ' + message); }

function runSummary(workspace, extra = []) {
  const r = spawnSyncPipeFree(process.execPath, [path.join(PKG, 'spec', 'scripts', 'engine-shadow-summary.mjs'), '--workspace', workspace, ...extra], { cwd: PKG, encoding: 'utf8', timeout: 120000 });
  return { code: r.status, out: String(r.stdout || '') + String(r.stderr || '') };
}

/* Воркспейс с расходящейся тенью; реестр и лишняя строка — по параметрам. */
function makeWorkspace({ deviations = null, extraEvidence = false, task = '0002', statusError = false } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-shadow-reconcile-'));
  const taskDir = path.join(dir, 'docs', 'tasks', task);
  fs.mkdirSync(taskDir, { recursive: true });
  const shadow = {
    version: 1,
    at: '2026-11-26T00:00:00.000Z',
    agree: false,
    report: [{ id: 'C5', status: 'fail' }],
  };
  if (statusError) {
    shadow.status = 'error';
    shadow.problem = 'факт не проходит схему: ruleset: нет полей signature';
  } else {
    shadow.engineVerdict = 'rejected';
    shadow.acceptanceStatus = 'accepted';
  }
  fs.writeFileSync(path.join(taskDir, 'engine-shadow.json'), JSON.stringify(shadow, null, 2) + '\n');
  const factsDir = path.join(dir, 'docs', 'facts');
  fs.mkdirSync(factsDir, { recursive: true });
  const rows = [
    { kind: 'evidence', gate: 'red', verdict: 'red-proven', exit: 0, artifact_hash: 'r'.repeat(64) },
    { kind: 'evidence', gate: 'verify', verdict: 'failed', exit: 1, artifact_hash: HASH_A },
    { kind: 'evidence', gate: 'verify', verdict: 'passed', exit: 0, artifact_hash: HASH_B },
  ];
  if (extraEvidence) rows.push({ kind: 'evidence', gate: 'verify', verdict: 'passed', exit: 0, artifact_hash: HASH_C });
  fs.writeFileSync(path.join(factsDir, task + '.jsonl'), rows.map((row) => JSON.stringify(row)).join('\n') + '\n');
  if (deviations !== null) {
    fs.writeFileSync(path.join(dir, 'docs', 'shadow-deviations.json'), JSON.stringify(deviations, null, 2) + '\n');
  }
  return dir;
}

function entry({ task = '0002', reason = 'пример: предусловие исправлено между прогонами', evidence = [HASH_A, HASH_B], exits = [0, 1], by = 'lead', at = '2026-11-26T00:00:00+03:00' } = {}) {
  return {
    version: 1,
    entries: [{
      task,
      facts: 'docs/facts/' + task + '.jsonl',
      reason,
      by,
      at,
      conflicts: [{ gate: 'verify', exits, evidence }],
    }],
  };
}

if (mode === 'c1') {
  const ok = makeWorkspace({ deviations: entry() });
  try {
    const r = runSummary(ok);
    if (r.code !== 0) fail('c1', 'сводка с действующим отклонением вышла ' + r.code + ' вместо 0: ' + r.out.trim().slice(-400));
    if (!/WAIV 0002/u.test(r.out)) fail('c1', 'отклонение не названо: ' + r.out.trim().slice(-400));
    if (!/пример: предусловие исправлено/u.test(r.out)) fail('c1', 'причина отклонения не напечатана: ' + r.out.trim().slice(-400));
    if (!/расхождений 0/u.test(r.out)) fail('c1', 'в итоге нет «расхождений 0»: ' + r.out.trim().slice(-400));
    if (!/docs\/shadow-deviations\.json/u.test(r.out)) fail('c1', 'не назван реестр решений: ' + r.out.trim().slice(-400));
  } finally { fs.rmSync(ok, { recursive: true, force: true }); }

  const blind = makeWorkspace({});
  try {
    const r = runSummary(blind);
    if (r.code !== 1) fail('c1', 'без реестра та же тень вышла ' + r.code + ' вместо 1 (детектор глухой)');
    if (!/DIFF 0002/u.test(r.out)) fail('c1', 'без реестра расхождение не названо: ' + r.out.trim().slice(-400));
  } finally { fs.rmSync(blind, { recursive: true, force: true }); }
  if (bad === 0) console.log('SHADOW-RECONCILE OK c1');
  process.exit(bad === 0 ? 0 : 1);
}

if (mode === 'c2') {
  const cases = [
    { name: 'лишняя строка evidence', opts: { deviations: entry(), extraEvidence: true } },
    { name: 'чужое задание в реестре', opts: { deviations: entry({ task: '0003' }) } },
    { name: 'хеш не тот', opts: { deviations: entry({ evidence: [HASH_A, HASH_C] }) } },
    { name: 'exit не те', opts: { deviations: entry({ exits: [0, 2] }) } },
  ];
  for (const item of cases) {
    const ws = makeWorkspace(item.opts);
    try {
      const r = runSummary(ws);
      if (r.code !== 1) fail('c2', item.name + ': сводка вышла ' + r.code + ' вместо 1');
      if (!/DIFF 0002/u.test(r.out)) fail('c2', item.name + ': расхождение не названо: ' + r.out.trim().slice(-300));
      if (/WAIV/u.test(r.out)) fail('c2', item.name + ': отклонение сработало без точной привязки');
    } finally { fs.rmSync(ws, { recursive: true, force: true }); }
  }
  /* Пустая причина — не отклонение, а ошибка реестра: код 2 и названная запись. */
  const broken = makeWorkspace({ deviations: entry({ reason: '   ' }) });
  try {
    const r = runSummary(broken);
    if (r.code !== 2) fail('c2', 'реестр без причины дал код ' + r.code + ' вместо 2');
    if (!/SHADOW PROBLEM/u.test(r.out)) fail('c2', 'битый реестр не назван: ' + r.out.trim().slice(-300));
    if (/WAIV/u.test(r.out)) fail('c2', 'отклонение без причины сработало');
  } finally { fs.rmSync(broken, { recursive: true, force: true }); }

  /* Контроль: правильная запись всё равно срабатывает (детектор не глухой). */
  const good = makeWorkspace({ deviations: entry() });
  try {
    const r = runSummary(good);
    if (r.code !== 0) fail('c2', 'контроль: правильная запись не сработала, код ' + r.code);
  } finally { fs.rmSync(good, { recursive: true, force: true }); }
  if (bad === 0) console.log('SHADOW-RECONCILE OK c2');
  process.exit(bad === 0 ? 0 : 1);
}

if (mode === 'c3') {
  const ws = makeWorkspace({ statusError: true });
  try {
    const r = runSummary(ws);
    if (r.code !== 0) fail('c3', 'невычислимая тень вышла ' + r.code + ' вместо 0: ' + r.out.trim().slice(-400));
    if (!/N\/A  0002 — тень не вычислима: факт не проходит схему/u.test(r.out)) fail('c3', 'статус не назван: ' + r.out.trim().slice(-400));
    if (/DIFF 0002/u.test(r.out)) fail('c3', 'невычислимая тень названа расхождением');
    if (!/не вычислима 1/u.test(r.out)) fail('c3', 'в итоге нет счёта невычислимых: ' + r.out.trim().slice(-400));
  } finally { fs.rmSync(ws, { recursive: true, force: true }); }

  /* Контроль: настоящая тень с расхождением по-прежнему красная. */
  const real = makeWorkspace({});
  try {
    const r = runSummary(real);
    if (r.code !== 1) fail('c3', 'расхождение перестало быть красным, код ' + r.code);
  } finally { fs.rmSync(real, { recursive: true, force: true }); }
  if (bad === 0) console.log('SHADOW-RECONCILE OK c3');
  process.exit(bad === 0 ? 0 : 1);
}

console.log('usage: node spec/checks/shadow-reconcile.mjs c1|c2|c3');
process.exit(2);
