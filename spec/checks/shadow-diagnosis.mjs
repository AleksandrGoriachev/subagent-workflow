#!/usr/bin/env node
/*
 * 0161: расхождение тени объясняется данными, а не названием задачи.
 *
 *   c1 — в фактах задания два доказательства одного гейта с разными exit;
 *        сводка --explain называет гейт, оба exit и файл фактов;
 *   c2 (негатив) — файла фактов нет: причина не выводится, гейт не выдумывается.
 *
 * Политику античита (0143/0144) проверка не трогает — только диагностику.
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

const mode = String(process.argv[2] || '').toLowerCase();
let bad = 0;
function fail(tag, message) { bad += 1; console.log('FAIL ' + tag + ': ' + message); }

function run(cmd, args, cwd) {
  const r = spawnSyncPipeFree(cmd, args, { cwd, encoding: 'utf8', timeout: 120000 });
  return { code: r.status, out: String(r.stdout || '') + String(r.stderr || '') };
}

/* Воркспейс с расходящейся тенью; факты пишутся или нет — по параметру. */
function makeWorkspace({ withFacts }) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-shadow-diag-'));
  const taskDir = path.join(dir, 'docs', 'tasks', '0001');
  fs.mkdirSync(taskDir, { recursive: true });
  fs.writeFileSync(path.join(taskDir, 'engine-shadow.json'), JSON.stringify({
    version: 1,
    at: '2026-11-26T00:00:00.000Z',
    engineVerdict: 'rejected',
    acceptanceStatus: 'accepted',
    agree: false,
    report: [{ id: 'C5', status: 'fail' }],
  }, null, 2) + '\n');
  if (withFacts) {
    const factsDir = path.join(dir, 'docs', 'facts');
    fs.mkdirSync(factsDir, { recursive: true });
    const rows = [
      { kind: 'evidence', gate: 'red', verdict: 'red-proven', exit: 1, head: 'aaaa111122223333444455556666777788889999' },
      { kind: 'evidence', gate: 'verify', verdict: 'failed', exit: 1, head: 'aaaa111122223333444455556666777788889999' },
      { kind: 'evidence', gate: 'verify', verdict: 'passed', exit: 0, head: 'aaaa111122223333444455556666777788889999' },
      { kind: 'evidence', gate: 'accept', verdict: 'accepted', exit: 0, head: 'aaaa111122223333444455556666777788889999' },
    ];
    fs.writeFileSync(path.join(factsDir, '0001.jsonl'), rows.map((row) => JSON.stringify(row)).join('\n') + '\n');
  }
  return dir;
}

function summary(workspace, extra = []) {
  return run(process.execPath, [path.join(PKG, 'spec', 'scripts', 'engine-shadow-summary.mjs'), '--workspace', workspace, ...extra], PKG);
}

if (mode === 'c1') {
  const ws = makeWorkspace({ withFacts: true });
  try {
    const r = summary(ws, ['--explain']);
    if (r.code !== 1) fail('c1', 'сводка при расхождении вышла ' + r.code + ' вместо 1');
    if (!/конфликт гейта verify/u.test(r.out)) fail('c1', 'не назван гейт verify: ' + r.out.trim().slice(-400));
    if (!/exit 0 и 1/u.test(r.out)) fail('c1', 'не названы оба exit: ' + r.out.trim().slice(-400));
    if (!/docs\/facts\/0001\.jsonl/u.test(r.out)) fail('c1', 'не назван файл фактов: ' + r.out.trim().slice(-400));
    if (!/head aaaa11112222/u.test(r.out)) fail('c1', 'не назван head: ' + r.out.trim().slice(-400));
    /* Без флага объяснения нет: поведение по умолчанию не менялось. */
    const plain = summary(ws);
    if (/объяснение/u.test(plain.out)) fail('c1', 'без --explain печатается объяснение');
  } finally { fs.rmSync(ws, { recursive: true, force: true }); }
  if (bad === 0) console.log('SHADOW-DIAG OK c1');
  process.exit(bad === 0 ? 0 : 1);
}

if (mode === 'c2') {
  const ws = makeWorkspace({ withFacts: false });
  try {
    const r = summary(ws, ['--explain']);
    if (r.code !== 1) fail('c2', 'сводка вышла ' + r.code + ' вместо 1');
    if (!/файл фактов не найден/u.test(r.out)) fail('c2', 'нет честного «файла фактов нет»: ' + r.out.trim().slice(-400));
    if (/конфликт гейта/u.test(r.out)) fail('c2', 'гейт выдуман без данных: ' + r.out.trim().slice(-400));
  } finally { fs.rmSync(ws, { recursive: true, force: true }); }

  /* Контроль: правильный аргумент всё равно объясняет (детектор не глухой). */
  const good = makeWorkspace({ withFacts: true });
  try {
    const r = summary(good, ['--explain']);
    if (!/конфликт гейта verify/u.test(r.out)) fail('c2', 'детектор не сработал на правильных данных');
  } finally { fs.rmSync(good, { recursive: true, force: true }); }
  if (bad === 0) console.log('SHADOW-DIAG OK c2');
  process.exit(bad === 0 ? 0 : 1);
}

console.log('usage: node spec/checks/shadow-diagnosis.mjs c1|c2');
process.exit(2);
