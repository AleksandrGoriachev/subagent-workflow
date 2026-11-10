/**
 * 0140 (WC-81): запечатанный прогон.
 *
 * c1: тест вне дерева с совпадающим хешем — прогон проходит, факт sealed появляется;
 * c2: подмена файла (хеш не сходится) — отказ без прогона;
 * c3: тест внутри воркспейса — отказ (это не held-out);
 * c4: C2 pass при доказательстве, fail при объявленном seal без доказательства,
 *     not-applicable без seal.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { appendFact, factFileOf, readFactFile } from '../../spec/lib/facts.mjs';
import { evaluateTask } from '../../spec/engine.mjs';
import { runSealed } from '../../spec/scripts/sealed-run.mjs';

const sha = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');

function makeFixture(script = 'process.exit(0)') {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-seal-'));
  const ws = path.join(base, 'ws');
  const taskDir = path.join(ws, 'docs', 'tasks', '0050');
  fs.mkdirSync(taskDir, { recursive: true });
  const testFile = path.join(base, 'sealed', 'check.mjs');
  fs.mkdirSync(path.dirname(testFile), { recursive: true });
  fs.writeFileSync(testFile, script);
  const hash = sha(testFile);
  fs.writeFileSync(path.join(taskDir, 'task.md'), '# Задание\n\n<!-- TASK-META\n' + JSON.stringify({ id: '0050', sealedTest: { path: testFile, hash } }, null, 2) + '\n-->\n');
  return { base, ws, taskDir, testFile, hash };
}

test('c1: запечатанный тест вне дерева проходит и пишет факт', () => {
  const f = makeFixture('process.exit(0)');
  appendFact(factFileOf(f.ws, '0050'), { kind: 'genesis', task: '0050', contract_hash: 'h', at: 't', writer: 'w' });
  const result = runSealed(f.taskDir, f.ws, {});
  assert.equal(result.ok, true, (result.problems || []).join('; '));
  const read = readFactFile(factFileOf(f.ws, '0050'));
  assert.equal(read.ok, true, read.problems.join('; '));
  const sealed = read.rows.find((row) => row.gate === 'sealed');
  assert.ok(sealed, 'факт sealed должен быть записан');
  assert.equal(sealed.seal_hash, f.hash);
});

test('c2: подмена файла — отказ без прогона', () => {
  const f = makeFixture('process.exit(0)');
  fs.writeFileSync(f.testFile, 'process.exit(1)');
  const result = runSealed(f.taskDir, f.ws, {});
  assert.equal(result.ok, false);
  assert.match(result.problems.join(' '), /хеш запечатанного теста не совпадает/u);
});

test('c3: тест внутри воркспейса — отказ', () => {
  const f = makeFixture();
  const inside = path.join(f.ws, 'docs', 'sealed-check.mjs');
  fs.writeFileSync(inside, 'process.exit(0)');
  fs.writeFileSync(path.join(f.taskDir, 'task.md'), '# Задание\n\n<!-- TASK-META\n' + JSON.stringify({ id: '0050', sealedTest: { path: inside, hash: sha(inside) } }, null, 2) + '\n-->\n');
  const result = runSealed(f.taskDir, f.ws, {});
  assert.equal(result.ok, false);
  assert.match(result.problems.join(' '), /внутри воркспейса/u);
});

function buildFacts(ws, options = {}) {
  const file = factFileOf(ws, '0050');
  appendFact(file, { kind: 'genesis', task: '0050', contract_hash: 'h', at: 't', writer: 'w' });
  appendFact(file, { kind: 'task', id: '0050', contract_hash: 'h', risk: 'medium', writer: 'w', at: 't' });
  appendFact(file, { kind: 'contract', task: '0050', hash: 'h', criteria: 'c', forbidden: [], seal: options.seal || null, writer: 'w', at: 't' });
  appendFact(file, { kind: 'run', id: '0050:1', task: '0050', commit: 'h', ruleset_hash: 'u', command: 'x', writer: 'a' });
  appendFact(file, { kind: 'diff', task: '0050', run: '0050:1', commit: 'h', paths: ['a.js'], diff_hash: 'd', writer: 'a' });
  appendFact(file, { kind: 'evidence', task: '0050', run: '0050:1', gate: 'red', artifact_hash: 'e1', exit: 0, writer: 'a' });
  appendFact(file, { kind: 'evidence', task: '0050', run: '0050:1', gate: 'verify', artifact_hash: 'e2', exit: 0, writer: 'a' });
  if (options.sealedEvidence) appendFact(file, { kind: 'evidence', task: '0050', run: '0050:1', gate: 'sealed', artifact_hash: 'e3', exit: options.sealedExit || 0, seal_hash: options.seal.hash, writer: 'a' });
  appendFact(file, { kind: 'judgment', task: '0050', run: '0050:1', artifact_hash: 'd', by: 'j', role: 'judge', model: 'x', verdict: 'accepted', writer: 'a' });
  appendFact(file, { kind: 'accept', task: '0050', run: '0050:1', contract_hash: 'h', diff_hash: 'd', ruleset_hash: 'u', evidence_manifest_hash: 'm', by: 'j', at: 't' });
  return file;
}

test('c4: C2 — pass / fail / not-applicable', () => {
  const seal = { path: 'x', hash: 'a'.repeat(64) };
  const ws1 = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-c2-'));
  buildFacts(ws1, { seal, sealedEvidence: true });
  const pass = evaluateTask(readFactFile(factFileOf(ws1, '0050')));
  assert.equal(pass.report.find((i) => i.id === 'C2').status, 'pass');
  const ws2 = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-c2-'));
  buildFacts(ws2, { seal });
  const fail = evaluateTask(readFactFile(factFileOf(ws2, '0050')));
  assert.equal(fail.report.find((i) => i.id === 'C2').status, 'fail');
  assert.equal(fail.verdict, 'rejected');
  const ws3 = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-c2-'));
  buildFacts(ws3, {});
  const na = evaluateTask(readFactFile(factFileOf(ws3, '0050')));
  assert.equal(na.report.find((i) => i.id === 'C2').status, 'not-applicable');
});