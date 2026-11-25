#!/usr/bin/env node
/*
 * 0146 (2.6.111): доказательство красного из red.json, когда в журнале ворот
 * строки red нет.
 *
 * Случай: задача сдана с task-red --at-contract — красный прогон шёл во
 * временном worktree, строка журнала осталась там, в задании лежит только
 * red.json. Раньше evidence строился лишь из gates.jsonl, и такой гейт
 * считался непокрытым: C5 «гейты без успешного доказательства: red», тень
 * движка расходилась с приёмкой, selftest (шаг SHADOW) краснел.
 *
 * c1: реальная конвертация задачи 0144 даёт evidence red (exit 0, red-proven);
 * c2 (негатив): red.json без redProven=true успешного доказательства не даёт.
 *
 * Вне пакета — SKIP (конвенция deployed-copy).
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { convertToWorkspace } from '../scripts/facts-convert.mjs';
import { evaluateGates } from '../lib/policy.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PKG = path.resolve(HERE, '..', '..');

if (!fs.existsSync(path.join(PKG, 'spec'))) {
  console.log('SKIP: проверка пакета вне пакета');
  process.exit(0);
}

function rowsOf(file) {
  return fs.readFileSync(file, 'utf8').replace(/^\uFEFF/u, '').split('\n').filter((line) => line.trim() !== '').map((line) => JSON.parse(line));
}

function tempWorkspace() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'wf-red-evidence-'));
}

/* c1: у задачи 0144 журнал без строки red, доказательство — в red.json. */
function c1() {
  const workspace = tempWorkspace();
  try {
    const result = convertToWorkspace(path.join(PKG, 'docs', 'tasks', '0144'), workspace, { force: true, repoRoot: PKG });
    if (!result.ok) throw new Error('конвертация не удалась: ' + (result.problems || []).join('; '));
    const rows = rowsOf(result.file);
    const red = rows.filter((row) => row.kind === 'evidence' && row.gate === 'red');
    if (red.length !== 1) throw new Error('ожидалась одна строка evidence red, получено ' + red.length);
    if (red[0].exit !== 0) throw new Error('evidence red не успешный: exit=' + red[0].exit);
    if (red[0].verdict !== 'red-proven') throw new Error('verdict=' + red[0].verdict + ', ожидался red-proven');
    console.log('RED-EVIDENCE OK c1');
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true });
  }
}

/* c2: без redProven=true успешного доказательства нет. */
function c2() {
  const workspace = tempWorkspace();
  const taskDir = path.join(workspace, 'docs', 'tasks', '9001');
  try {
    fs.mkdirSync(taskDir, { recursive: true });
    const meta = {
      id: '9001', version: 1, title: 'фикстура', risk: 'low', owner: 'probe', executor: 'agent',
      acceptor: 'agent', issuedBy: { kind: 'agent', session: 's' }, base: 'HEAD', criteria: 'criteria.json',
      allowedPaths: ['src/**'], protectedPaths: [], hashExclude: [], decisions: [],
      resultShape: { artifact: 'x', format: 'x', criterion: 'C1' }, securityReview: false, humanSignoff: false, followUps: [],
    };
    fs.writeFileSync(path.join(taskDir, 'task.md'), '# t\n\n<!-- TASK-META\n' + JSON.stringify(meta, null, 2) + '\n-->\n\n## Цель\n\nфикстура\n');
    fs.writeFileSync(path.join(taskDir, 'criteria.json'), JSON.stringify({ task: '9001', criteria: [{ id: 'C1', title: 'p', command: 'node -e "process.exit(0)"', expect: { exitCode: 0 } }] }, null, 2));
    fs.writeFileSync(path.join(taskDir, 'gates.jsonl'), JSON.stringify({ kind: 'verify', verdict: 'passed', exitSummary: 'exit=0; failed=0/1' }) + '\n');
    fs.writeFileSync(path.join(taskDir, 'red.json'), JSON.stringify({ redProven: false, redExpectation: { ok: true } }, null, 2));
    fs.writeFileSync(path.join(taskDir, 'verify.json'), JSON.stringify({ allPassed: true, changedPaths: [], criteriaSha256: 'a'.repeat(64), headSha: 'b'.repeat(40) }, null, 2));
    fs.writeFileSync(path.join(taskDir, 'acceptance.json'), JSON.stringify({ status: 'accepted', task: '9001', risk: 'low', criteriaSha256: 'a'.repeat(64), candidateCommit: 'b'.repeat(40), worktreeDigest: 'c'.repeat(64), issuedAt: '2026-11-25T00:00:00Z' }, null, 2));
    const result = convertToWorkspace(taskDir, workspace, { force: true, repoRoot: PKG });
    if (!result.ok) throw new Error('конвертация не удалась: ' + (result.problems || []).join('; '));
    const rows = rowsOf(result.file);
    const red = rows.filter((row) => row.kind === 'evidence' && row.gate === 'red');
    if (red.length !== 0) throw new Error('без redProven появилась строка evidence red: ' + JSON.stringify(red[0]));
    const gates = evaluateGates(rows.filter((row) => row.kind === 'evidence'), ['red', 'verify'], true);
    if (gates.status !== 'fail') throw new Error('C5 не отказал без доказательства красного: ' + gates.status);
    if (!String(gates.detail || '').includes('red')) throw new Error('в отказе не назван гейт: ' + gates.detail);
    console.log('RED-EVIDENCE OK c2');
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true });
  }
}

const table = { c1, c2 };
const which = process.argv[2];
if (!table[which]) {
  console.log('usage: node spec/checks/red-evidence.mjs c1|c2');
  process.exit(2);
}
try {
  table[which]();
} catch (error) {
  console.log('RED-EVIDENCE FAIL ' + which + ': ' + (error && error.message ? error.message : error));
  process.exit(1);
}
