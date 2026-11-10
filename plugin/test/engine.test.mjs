/**
 * 0136 (P0): тесты исполнителя ограничений.
 *
 * c1: полный набор фактов — вердикт accepted, применимые ограничения проходят;
 * c2: суждение на чужой артефакт — C4 краснеет, вердикт rejected;
 * c3: конвертер строит факты из минимальных артефактов и не трогает оригиналы.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { appendFact, factFileOf, readFactFile } from '../../spec/lib/facts.mjs';
import { evaluateTask } from '../../spec/engine.mjs';
import { convertTask } from '../../spec/scripts/facts-convert.mjs';

function buildTask(ws, options = {}) {
  const file = factFileOf(ws, '0042');
  appendFact(file, { kind: 'genesis', task: '0042', contract_hash: 'h1', at: '2026-11-10T00:00:00Z', writer: 'workflow' });
  appendFact(file, { kind: 'task', id: '0042', contract_hash: 'h1', risk: 'normal', writer: 'workflow', at: '2026-11-10T00:00:01Z' });
  appendFact(file, { kind: 'contract', task: '0042', hash: 'h1', criteria: 'c1', writer: 'workflow', at: '2026-11-10T00:00:02Z' });
  appendFact(file, { kind: 'run', id: '0042:1', task: '0042', commit: 'h1', ruleset_hash: 'unknown', command: 'task-accept', writer: 'acceptor' });
  appendFact(file, { kind: 'diff', task: '0042', run: '0042:1', commit: 'h1', paths: ['a.js'], diff_hash: 'd1', writer: 'acceptor' });
  appendFact(file, { kind: 'evidence', task: '0042', run: '0042:1', gate: 'verify', artifact_hash: 'e1', exit: 0, writer: 'acceptor' });
  const judgmentHash = options.otherArtifact === true ? 'd-other' : 'd1';
  appendFact(file, { kind: 'judgment', task: '0042', run: '0042:1', artifact_hash: judgmentHash, by: 'agent-judge', role: 'judge', model: 'x', verdict: 'accepted', writer: 'acceptor' });
  appendFact(file, { kind: 'accept', task: '0042', run: '0042:1', contract_hash: 'h1', diff_hash: 'd1', ruleset_hash: 'unknown', evidence_manifest_hash: 'm1', by: 'agent-judge', at: '2026-11-10T00:00:03Z' });
  return file;
}

test('c1: полный набор — accepted', () => {
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-engine-'));
  const file = buildTask(ws);
  const result = evaluateTask(readFactFile(file));
  assert.equal(result.verdict, 'accepted', JSON.stringify(result.report));
  assert.equal(result.passed, result.applicable);
});

test('c2: суждение на чужой артефакт — rejected, C4 fail', () => {
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-engine-'));
  const file = buildTask(ws, { otherArtifact: true });
  const result = evaluateTask(readFactFile(file));
  assert.equal(result.verdict, 'rejected');
  const c4 = result.report.find((item) => item.id === 'C4');
  assert.equal(c4.status, 'fail');
});

test('c3: конвертер строит факты и не трогает оригиналы', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-conv-'));
  fs.writeFileSync(path.join(dir, 'acceptance.json'), JSON.stringify({ version: 6, status: 'accepted', task: '0042', risk: 'low', criteriaSha256: 'h1', criteriaJsonSha256: 'c1', baseCommit: 'b1', candidateCommit: 'b1', worktreeDigest: 'd1', actor: { keyId: 'agent-judge', node: 'judge', model: 'x' } }));
  fs.writeFileSync(path.join(dir, 'verify.json'), JSON.stringify({ version: 4, task: '0042', createdAt: '2026-11-10T00:00:00Z', headSha: 'b1', criteriaSha256: 'h1', criteriaJsonSha256: 'c1', changedPaths: ['a.js'] }));
  const before = fs.readFileSync(path.join(dir, 'acceptance.json'), 'utf8');
  const converted = convertTask(dir);
  assert.ok(converted.rows.length >= 8, 'строк фактов: ' + converted.rows.length);
  assert.equal(fs.readFileSync(path.join(dir, 'acceptance.json'), 'utf8'), before);
});