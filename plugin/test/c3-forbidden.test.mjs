/**
 * 0138 (P1): тесты C3 — запрещённые пути.
 *
 * c1: pathForbidden — нормализация регистра и слешей ловит обход;
 * c2: путь вне запретов — не запрещён;
 * c3: движок краснеет, когда дифф касается forbidden контракта;
 * c4: пустой forbidden — not-applicable, а не pass (честно).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathForbidden, appendFact, factFileOf, readFactFile, sha256Text } from '../../spec/lib/facts.mjs';
import { evaluateTask } from '../../spec/engine.mjs';

test('c1: регистр и слеши не обходят запрет', () => {
  assert.equal(pathForbidden('Plugin/Lib/API.JS', ['plugin/lib/**']), true);
  assert.equal(pathForbidden('\\Plugin\\Lib\\api.js', ['plugin/lib/**']), true);
  assert.equal(pathForbidden('./Spec/Checks/X.mjs', ['spec/checks/**']), true);
});

test('c2: путь вне запретов не запрещён', () => {
  assert.equal(pathForbidden('docs/tasks/0076/report.md', ['spec/checks/**', 'plugin/lib/api.js']), false);
  assert.equal(pathForbidden('plugin/lib/wait-guard.js', ['plugin/lib/api.js']), false);
});

function buildTask(ws, diffPaths, forbidden) {
  const file = factFileOf(ws, '0050');
  appendFact(file, { kind: 'genesis', task: '0050', contract_hash: 'h', at: 't', writer: 'w' });
  appendFact(file, { kind: 'task', id: '0050', contract_hash: 'h', risk: 'medium', writer: 'w', at: 't' });
  appendFact(file, { kind: 'contract', task: '0050', hash: 'h', criteria: 'c', forbidden, writer: 'w', at: 't' });
  appendFact(file, { kind: 'run', id: '0050:1', task: '0050', commit: 'h', ruleset_hash: 'u', command: 'x', writer: 'a' });
  appendFact(file, { kind: 'diff', task: '0050', run: '0050:1', commit: 'h', paths: diffPaths, diff_hash: 'd', writer: 'a' });
  appendFact(file, { kind: 'evidence', task: '0050', run: '0050:1', gate: 'red', artifact_hash: 'e1', exit: 0, writer: 'a' });
  appendFact(file, { kind: 'evidence', task: '0050', run: '0050:1', gate: 'verify', artifact_hash: 'e2', exit: 0, writer: 'a' });
  const manifest = sha256Text(['e1', 'e2'].sort().join(','));
  appendFact(file, { kind: 'judgment', task: '0050', run: '0050:1', artifact_hash: 'd', by: 'j', role: 'judge', model: 'x', verdict: 'accepted', writer: 'a' });
  appendFact(file, { kind: 'accept', task: '0050', run: '0050:1', contract_hash: 'h', diff_hash: 'd', ruleset_hash: 'u', evidence_manifest_hash: manifest, by: 'j', at: 't' });
  return file;
}

test('c3: дифф в запрещённом пути — C3 fail, вердикт rejected', () => {
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-c3-'));
  const file = buildTask(ws, ['plugin/lib/api.js'], ['plugin/lib/**']);
  const result = evaluateTask(readFactFile(file));
  const c3 = result.report.find((item) => item.id === 'C3');
  assert.equal(c3.status, 'fail');
  assert.equal(result.verdict, 'rejected');
});

test('c4: пустой forbidden — not-applicable', () => {
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-c3-'));
  const file = buildTask(ws, ['a.js'], []);
  const result = evaluateTask(readFactFile(file));
  const c3 = result.report.find((item) => item.id === 'C3');
  assert.equal(c3.status, 'not-applicable');
});