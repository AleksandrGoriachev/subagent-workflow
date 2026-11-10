/**
 * 0141 (P1): C8 — план против фактических действий.
 *
 * c1: writePathsOf берёт записи, не чтение;
 * c2: pathsOutsidePlan — вне плана ловится, внутри нет;
 * c3: пустой план → null (C8 not-applicable), а не тихий pass;
 * c4: движок краснеет, когда действие вне плана, и проходит, когда внутри.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { writePathsOf, pathsOutsidePlan } from '../../spec/lib/actions.mjs';
import { appendFact, factFileOf, readFactFile } from '../../spec/lib/facts.mjs';
import { evaluateTask } from '../../spec/engine.mjs';

test('c1: записи ловятся, чтение — нет', () => {
  assert.deepEqual(writePathsOf('write', JSON.stringify({ file_path: 'a/b.js', content: 'x' })), ['a/b.js']);
  assert.deepEqual(writePathsOf('edit', JSON.stringify({ file_path: 'c/d.js' })), ['c/d.js']);
  const runCode = 'fs.writeFileSync("docs/x.md", "text"); await tools.read({ file_path: "secret.md" });';
  const paths = writePathsOf('run_code', runCode);
  assert.ok(paths.includes('docs/x.md'), JSON.stringify(paths));
  assert.ok(!paths.includes('secret.md'), 'чтение не считается действием: ' + JSON.stringify(paths));
});

test('c2: вне плана ловится глобом, внутри — нет', () => {
  const outside = pathsOutsidePlan(['plugin/lib/api.js', 'docs/tasks/0050/report.md'], ['plugin/lib/api.js', 'docs/tasks/0050/**']);
  assert.deepEqual(outside, []);
  const bad = pathsOutsidePlan(['other/secret.js'], ['plugin/lib/api.js']);
  assert.deepEqual(bad, ['other/secret.js']);
  const caseBypass = pathsOutsidePlan(['PLUGIN\\LIB\\API.JS'], ['plugin/lib/api.js']);
  assert.deepEqual(caseBypass, [], 'регистр и слеши не обходят план');
});

test('c3: пустой план — null', () => {
  assert.equal(pathsOutsidePlan(['a.js'], []), null);
  assert.equal(pathsOutsidePlan(['a.js'], undefined), null);
});

function buildFacts(ws, planned, actionPaths) {
  const file = factFileOf(ws, '0050');
  appendFact(file, { kind: 'genesis', task: '0050', contract_hash: 'h', at: 't', writer: 'w' });
  appendFact(file, { kind: 'task', id: '0050', contract_hash: 'h', risk: 'medium', writer: 'w', at: 't' });
  appendFact(file, { kind: 'contract', task: '0050', hash: 'h', criteria: 'c', forbidden: [], planned, plannedDeclared: true, seal: null, writer: 'w', at: 't' });
  appendFact(file, { kind: 'run', id: '0050:1', task: '0050', commit: 'h', ruleset_hash: 'u', command: 'x', writer: 'a' });
  appendFact(file, { kind: 'diff', task: '0050', run: '0050:1', commit: 'h', paths: ['a.js'], diff_hash: 'd', writer: 'a' });
  if (actionPaths) appendFact(file, { kind: 'action', task: '0050', run: '0050:1', cmd: 'journal', paths: actionPaths, writer: 'executor', at: 't' });
  appendFact(file, { kind: 'evidence', task: '0050', run: '0050:1', gate: 'red', artifact_hash: 'e1', exit: 0, writer: 'a' });
  appendFact(file, { kind: 'evidence', task: '0050', run: '0050:1', gate: 'verify', artifact_hash: 'e2', exit: 0, writer: 'a' });
  appendFact(file, { kind: 'judgment', task: '0050', run: '0050:1', artifact_hash: 'd', by: 'j', role: 'judge', model: 'x', verdict: 'accepted', writer: 'a' });
  appendFact(file, { kind: 'accept', task: '0050', run: '0050:1', contract_hash: 'h', diff_hash: 'd', ruleset_hash: 'u', evidence_manifest_hash: 'm', by: 'j', at: 't' });
  return file;
}

test('c4: C8 падает на действии вне плана и проходит внутри', () => {
  const ws1 = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-c8-'));
  buildFacts(ws1, ['a.js'], ['other/secret.js']);
  const bad = evaluateTask(readFactFile(factFileOf(ws1, '0050')));
  assert.equal(bad.report.find((i) => i.id === 'C8').status, 'fail');
  assert.equal(bad.verdict, 'rejected');
  const ws2 = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-c8-'));
  buildFacts(ws2, ['a.js', 'docs/**'], ['docs/x.md']);
  const good = evaluateTask(readFactFile(factFileOf(ws2, '0050')));
  assert.equal(good.report.find((i) => i.id === 'C8').status, 'pass');
});