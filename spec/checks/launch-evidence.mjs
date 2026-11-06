#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  findAcceptorLaunch,
  findLaunchByRun,
  modelVerdict,
  policyEnforced,
  acceptorModelDeclaration,
} from '../scripts/lib/launch-evidence.mjs';

const truthy = (value, label) => { if (!value) throw new Error(label); };
const equal = (actual, expected, label) => {
  if (actual !== expected) throw new Error(label + ': ожидалось ' + expected + ', получено ' + actual);
};

const store = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-launch-check-'));
process.env.WF_LAUNCH_STORE = store;
const root = path.join(store, 'project');
fs.mkdirSync(root, { recursive: true });

const hash = crypto.createHash('sha256').update(path.resolve(root)).digest('hex').slice(0, 12);
const dir = path.join(store, 'runs', hash);
fs.mkdirSync(dir, { recursive: true });

function writeLaunches(lines) {
  fs.writeFileSync(path.join(dir, 'launches.jsonl'), lines.map((line) => JSON.stringify(line)).join('\n') + '\n');
}

const started = {
  v: 1, runId: 'run-1', at: '2026-11-06T07:00:00.000+03:00', root,
  task: '0001', node: 'judge', childId: 'session-judge', provider: 'opencode-go',
  model: 'glm-5.3-flash', depth: 1, state: 'started',
};
writeLaunches([started, { v: 1, runId: 'run-1', at: '2026-11-06T07:10:00.000+03:00', state: 'settled', ok: true, endedAt: '2026-11-06T07:10:00.000+03:00' }]);

/* c1: своя сессия — свидетельство есть, чужая — нет. */
const own = findAcceptorLaunch({ root, sessionId: 'session-judge', node: 'judge' });
truthy(own.ok, 'c1: своя сессия должна найти запуск');
equal(own.record.runId, 'run-1', 'c1: runId');
const foreign = findAcceptorLaunch({ root, sessionId: 'session-other', node: 'judge' });
truthy(foreign.ok === false, 'c1: чужая сессия не должна проходить');
equal(foreign.code, 'acceptor-not-launched', 'c1: код отказа');

/* c2: --run с чужим childId и неизвестный runId. */
const wrongRun = findAcceptorLaunch({ root, sessionId: 'session-other', node: 'judge', runId: 'run-1' });
equal(wrongRun.code, 'run-mismatch', 'c2: чужой runId');
const missingRun = findAcceptorLaunch({ root, sessionId: 'session-judge', node: 'judge', runId: 'run-404' });
equal(missingRun.code, 'run-not-found', 'c2: неизвестный runId');

/* c6: --run без объявленного узла — свидетельство по childId. */
const byRun = findLaunchByRun({ root, runId: 'run-1', sessionId: 'session-judge' });
truthy(byRun.ok, 'c6: свой runId должен найти запуск');
equal(byRun.record.node, 'judge', 'c6: узел из записи');
equal(findLaunchByRun({ root, runId: 'run-1', sessionId: 'session-other' }).code, 'run-mismatch', 'c6: чужая сессия');
equal(findLaunchByRun({ root, runId: 'run-404', sessionId: 'session-judge' }).code, 'run-not-found', 'c6: неизвестный runId');

/* c3: модель из записи против объявления. */
equal(modelVerdict(own.record, { model: 'glm-5.3-flash' }), 'matched', 'c3: совпадение');
equal(modelVerdict(own.record, { model: 'deepseek-v4.1-flash' }), 'mismatch', 'c3: расхождение');
equal(modelVerdict(own.record, { model: null }), 'unknown', 'c3: без объявления');

/* c4: императив структуры. */
fs.writeFileSync(path.join(store, 'health.json'), JSON.stringify({ at: '2026-11-06T07:00:00.000+03:00', root, structurePolicy: 'fail', preExecuteSubscribed: false, error: 'cannot get property "tools" without inject' }));
const denied = policyEnforced({ enforcement: { structurePolicy: 'fail' } });
truthy(denied.ok === false, 'c4: fail + снятая подписка должен отклонять');
equal(denied.code, 'policy-not-enforced', 'c4: код');
fs.rmSync(path.join(store, 'health.json'));
truthy(policyEnforced({ enforcement: { structurePolicy: 'fail' } }).ok, 'c4: без health — легаси проходит');
truthy(policyEnforced({ enforcement: { structurePolicy: 'warn' } }).ok, 'c4: warn не блокирует');

/* c5: объявление модели узла из structure/*.json. */
const structureDir = path.join(root, 'structure');
fs.mkdirSync(structureDir, { recursive: true });
fs.writeFileSync(path.join(structureDir, 'graph.json'), JSON.stringify({ nodes: [{ id: 'judge', model: 'glm-5.3-flash' }] }));
const declared = acceptorModelDeclaration(root, 'judge');
equal(declared.model, 'glm-5.3-flash', 'c5: модель узла');
equal(acceptorModelDeclaration(root, 'worker').model, null, 'c5: неизвестный узел');

fs.rmSync(store, { recursive: true, force: true });
console.log('launch-evidence: OK c1–c6');
