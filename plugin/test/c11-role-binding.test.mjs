/**
 * 0191 (A14): C11 — работу выполняет назначенный узел, роли не слипаются.
 *
 * c1: разные узлы, исполнитель совпадает с объявленным — pass;
 * c2: исполнитель == приёмщик — fail;
 * c3: фактический исполнитель ≠ объявленного — fail;
 * c4: данных о ролях нет — not-applicable (честно, а не pass).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { appendFact, factFileOf, readFactFile, sha256Text } from '../../spec/lib/facts.mjs';
import { evaluateTask } from '../../spec/engine.mjs';

function build(ws, { declared = 'worker', actual = 'worker', reviewer = 'reviewer-1', acceptor = 'judge' } = {}) {
  const file = factFileOf(ws, '0050');
  const run = '0050:1';
  appendFact(file, { kind: 'genesis', task: '0050', contract_hash: 'h', at: 't', writer: 'w' });
  appendFact(file, { kind: 'task', id: '0050', contract_hash: 'h', risk: 'medium', writer: 'w', at: 't' });
  appendFact(file, { kind: 'contract', task: '0050', hash: 'h', criteria: 'c', forbidden: [], planned: ['src/**'], plannedDeclared: true, seal: null, executor_node: declared, writer: 'w', at: 't' });
  appendFact(file, { kind: 'run', id: run, task: '0050', commit: 'h', ruleset_hash: 'u', command: 'x', executor_node: actual, writer: 'a' });
  appendFact(file, { kind: 'diff', task: '0050', run, commit: 'h', paths: ['src/a.js'], diff_hash: 'd', writer: 'a' });
  appendFact(file, { kind: 'evidence', task: '0050', run, gate: 'red', artifact_hash: 'e1', exit: 0, writer: 'a' });
  appendFact(file, { kind: 'evidence', task: '0050', run, gate: 'verify', artifact_hash: 'e2', exit: 0, writer: 'a' });
  appendFact(file, { kind: 'judgment', task: '0050', run, artifact_hash: 'd', by: 'j', role: 'judge', reviewer_node: reviewer, model: 'x', verdict: 'accepted', writer: 'a' });
  appendFact(file, { kind: 'accept', task: '0050', run, contract_hash: 'h', diff_hash: 'd', ruleset_hash: 'u', evidence_manifest_hash: sha256Text(['e1', 'e2'].sort().join(',')), by: 'j', actor_node: acceptor, at: 't' });
  return evaluateTask(readFactFile(file), { signatures: false });
}

test('c1: назначенный исполнитель и разные роли — pass', () => {
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-c11-'));
  const result = build(ws);
  assert.equal(result.report.find((i) => i.id === 'C11').status, 'pass');
});

test('c2: исполнитель совпал с приёмщиком — fail', () => {
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-c11-'));
  const result = build(ws, { actual: 'judge', acceptor: 'judge' });
  const c11 = result.report.find((i) => i.id === 'C11');
  assert.equal(c11.status, 'fail');
  assert.match(c11.detail, /слиплись/u);
});

test('c3: фактический исполнитель не совпал с объявленным — fail', () => {
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-c11-'));
  const result = build(ws, { declared: 'worker', actual: 'coordinator' });
  const c11 = result.report.find((i) => i.id === 'C11');
  assert.equal(c11.status, 'fail');
  assert.match(c11.detail, /не совпадает с объявленным/u);
});

test('c4: ролей нет — not-applicable', () => {
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-c11-'));
  const result = build(ws, { declared: null, actual: null, reviewer: null, acceptor: null });
  assert.equal(result.report.find((i) => i.id === 'C11').status, 'not-applicable');
});