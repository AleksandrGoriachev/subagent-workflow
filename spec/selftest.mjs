#!/usr/bin/env node
/*
 * Самопроверка эталонных скриптов 2.0: аттестация актора и проверка записи.
 * Работает во временном каталоге, на настоящем git-репозитории.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { generateKeyPair, signRecord } from './scripts/sign.mjs';
import { summarizeDecisions } from './scripts/lib/common.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CHECKER = path.join(HERE, 'scripts', 'task-check-acceptance.mjs');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wf2-selftest-'));
let failed = 0;

function report(label, ok, detail) {
  if (ok) console.log('PASS  ' + label);
  else { failed += 1; console.log('FAIL  ' + label + (detail ? '\n      ' + String(detail).slice(0, 800) : '')); }
}

function git(repo, args) {
  const r = spawnSync('git', ['-C', repo, ...args], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error('git ' + args.join(' ') + ': ' + r.stderr);
  return r.stdout.trim();
}

function write(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
}

function sha(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function runChecker(file, repo, keys, extra = []) {
  return spawnSync(process.execPath, [CHECKER, '--file', file, '--repo', repo, '--keys', keys, '--task', 'docs/tasks/0001', ...extra], { encoding: 'utf8' });
}

try {
  const repo = path.join(tmp, 'repo');
  fs.mkdirSync(repo, { recursive: true });
  git(repo, ['init', '-q']);
  git(repo, ['config', 'user.email', 'selftest@local']);
  git(repo, ['config', 'user.name', 'selftest']);

  const taskDir = path.join(repo, 'docs', 'tasks', '0001');
  write(path.join(taskDir, 'task.md'), '# Задание 0001\n\n<!-- TASK-META\n{ "id": "0001", "risk": "medium",\n  "issuedBy": { "kind": "agent", "session": "issuer-session" } }\n-->\n\n## Цель\n\nСложение.\n');
  write(path.join(taskDir, 'criteria.json'), JSON.stringify({ task: '0001', redExpect: { mustFail: ['C1'], mustPass: [], reasons: { C1: 'add' } }, criteria: [{ id: 'C1', command: 'node checks/add.mjs', expect: { exitCode: 0 }, tags: ['behavior'] }] }, null, 2) + '\n');
  write(path.join(repo, 'src', 'app.js'), 'export const add = (a, b) => a - b;\n');
  git(repo, ['add', '-A']);
  git(repo, ['commit', '-q', '-m', 'contract']);
  const contractCommit = git(repo, ['rev-parse', 'HEAD']);
  const mainBranch = git(repo, ['rev-parse', '--abbrev-ref', 'HEAD']);

  write(path.join(repo, 'src', 'app.js'), 'export const add = (a, b) => a + b;\n');
  write(path.join(taskDir, 'verify.json'), JSON.stringify({ version: 4, kind: 'verify', allPassed: true }) + '\n');
  write(path.join(taskDir, 'red.json'), JSON.stringify({ version: 4, kind: 'red', redProven: true }) + '\n');
  git(repo, ['add', '-A']);
  git(repo, ['commit', '-q', '-m', 'accepted candidate']);
  const candidateCommit = git(repo, ['rev-parse', 'HEAD']);
  const tree = git(repo, ['rev-parse', 'HEAD^{tree}']);

  const keysDir = path.join(tmp, 'keys');
  fs.mkdirSync(keysDir, { recursive: true });
  const agent = generateKeyPair();
  const human = generateKeyPair();
  write(path.join(keysDir, 'agent-main.key.pem'), agent.privateKeyPem);
  write(path.join(keysDir, 'human-judge.key.pem'), human.privateKeyPem);
  const keysFile = path.join(tmp, 'acceptors.json');
  write(keysFile, JSON.stringify({ acceptors: [
    { keyId: 'agent-main', kind: 'agent', owner: 'judge', publicKeyPem: agent.publicKeyPem },
    { keyId: 'human-judge', kind: 'human', owner: 'Ирина', publicKeyPem: human.publicKeyPem },
  ] }, null, 2) + '\n');

  const base = {
    version: 5,
    status: 'accepted',
    task: '0001',
    risk: 'medium',
    taskFileSha256: sha(path.join(taskDir, 'task.md')),
    criteriaSha256: sha(path.join(taskDir, 'criteria.json')),
    criteriaJsonSha256: sha(path.join(taskDir, 'criteria.json')),
    contractCommit,
    baseCommit: contractCommit,
    candidateCommit,
    tree,
    worktreeDigest: 'a'.repeat(64),
    issuedBy: { kind: 'agent', session: 'issuer-session' },
    actor: { kind: 'agent', session: 'judge-session', model: 'm', host: 'h', keyId: 'agent-main', attestedBy: 'env' },
    independence: { level: 'separate-session', separateSession: true, reportWithheld: true, keyCustody: 'agent-key' },
    acceptorRun: { fresh: true, runKind: 'accept', nonce: 'b'.repeat(32), startedAt: '2026-10-25T10:00:00.000Z', finishedAt: '2026-10-25T10:01:00.000Z', durationMs: 60000, host: 'h', node: 'v25.4.0', verifySha256: sha(path.join(taskDir, 'verify.json')), verifyLogSha256: null },
    bypasses: {},
    red: { baseSha: contractCommit, contractCommit, criteriaJsonSha256: sha(path.join(taskDir, 'criteria.json')), failed: 1, failedIds: ['C1'], redExpectation: { configured: true, ok: true, errors: [] } },
    checks: [{ id: 'C1', command: 'node checks/add.mjs', exitCode: 0, durationMs: 10, passed: true }],
    acceptor: 'judge',
    acceptedAt: '2026-10-25T10:01:00.000Z',
    humanSignoff: false,
    signedBy: null,
    securityReview: false,
    decisions: { count: 0, digest: summarizeDecisions([]).digest, assumed: [], confirmed: 0 },
    releaseReady: true,
  };

  const acceptancePath = path.join(taskDir, 'acceptance.json');
  fs.writeFileSync(acceptancePath, JSON.stringify(signRecord(base, { privateKeyPem: agent.privateKeyPem, keyId: 'agent-main' }), null, 2) + '\n');
  git(repo, ['add', 'docs/tasks/0001/acceptance.json']);
  git(repo, ['commit', '-q', '-m', 'acceptance metadata']);
  const metadataCommit = git(repo, ['rev-parse', 'HEAD']);

  const happy = runChecker(acceptancePath, repo, keysFile, ['--metadata', metadataCommit]);
  report('запись medium с отдельной сессией принимается', happy.status === 0, happy.stdout + happy.stderr);

  const tampered = JSON.parse(fs.readFileSync(acceptancePath, 'utf8'));
  tampered.notes = 'подмена';
  const tamperedPath = path.join(tmp, 'tampered.json');
  fs.writeFileSync(tamperedPath, JSON.stringify(tampered, null, 2));
  report('подмена поля ломает подпись', runChecker(tamperedPath, repo, keysFile).status !== 0);

  const selfAccept = signRecord({ ...base, actor: { ...base.actor, session: 'issuer-session' }, independence: { ...base.independence, level: 'same-session' } }, { privateKeyPem: agent.privateKeyPem, keyId: 'agent-main' });
  const selfPath = path.join(tmp, 'self.json');
  fs.writeFileSync(selfPath, JSON.stringify(selfAccept, null, 2));
  const selfRun = runChecker(selfPath, repo, keysFile);
  report('самоприёмка (сессия = issuedBy) отклоняется', selfRun.status !== 0 && /issuedBy/.test(selfRun.stdout + selfRun.stderr));

  const noSession = signRecord({ ...base, actor: { ...base.actor, session: null, attestedBy: 'none' } }, { privateKeyPem: agent.privateKeyPem, keyId: 'agent-main' });
  const noSessionPath = path.join(tmp, 'nosession.json');
  fs.writeFileSync(noSessionPath, JSON.stringify(noSession, null, 2));
  report('medium без аттестованной сессии отклоняется', runChecker(noSessionPath, repo, keysFile).status !== 0);

  const declaredMedium = signRecord({ ...base, actor: { ...base.actor, session: 'x', attestedBy: 'declared' } }, { privateKeyPem: agent.privateKeyPem, keyId: 'agent-main' });
  const declaredPath = path.join(tmp, 'declared.json');
  fs.writeFileSync(declaredPath, JSON.stringify(declaredMedium, null, 2));
  report('declared-актор не проходит для medium', runChecker(declaredPath, repo, keysFile).status !== 0);

  const highAgent = signRecord({ ...base, risk: 'high', humanSignoff: true, securityReview: true, signedBy: 'judge' }, { privateKeyPem: agent.privateKeyPem, keyId: 'agent-main' });
  const highAgentPath = path.join(tmp, 'high-agent.json');
  fs.writeFileSync(highAgentPath, JSON.stringify(highAgent, null, 2));
  report('high-risk с ключом агента отклоняется', runChecker(highAgentPath, repo, keysFile).status !== 0);

  const highHuman = signRecord({
    ...base,
    risk: 'high',
    humanSignoff: true,
    securityReview: true,
    signedBy: 'Ирина',
    actor: { kind: 'human', session: null, model: '', host: 'h', keyId: 'human-judge', attestedBy: 'key' },
    independence: { level: 'human', separateSession: true, reportWithheld: true, keyCustody: 'human-key' },
  }, { privateKeyPem: human.privateKeyPem, keyId: 'human-judge' });
  const highHumanPath = path.join(tmp, 'high-human.json');
  fs.writeFileSync(highHumanPath, JSON.stringify(highHuman, null, 2));
  const highHumanRun = runChecker(highHumanPath, repo, keysFile);
  report('high-risk с человеческим ключом принимается', highHumanRun.status === 0, highHumanRun.stdout + highHumanRun.stderr);

  const low = signRecord({
    ...base,
    risk: 'low',
    red: null,
    actor: { kind: 'agent', session: null, model: 'm', host: 'h', keyId: 'agent-main', attestedBy: 'none' },
    independence: { level: 'declared', separateSession: false, reportWithheld: true, keyCustody: 'agent-key' },
    acceptorRun: { ...base.acceptorRun, fresh: false, nonce: null },
  }, { privateKeyPem: agent.privateKeyPem, keyId: 'agent-main' });
  const lowPath = path.join(tmp, 'low.json');
  fs.writeFileSync(lowPath, JSON.stringify(low, null, 2));
  const lowRun = runChecker(lowPath, repo, keysFile);
  report('low с declared-актором принимается', lowRun.status === 0, lowRun.stdout + lowRun.stderr);

  /*
   * 2.1.0: решения. Запись v5 с assumed-решением принимается (работа шла), но
   * releaseReady=false; запись, которая прячет assumed, отклоняется.
   */
  const task2 = path.join(repo, 'docs', 'tasks', '0002');
  const decisions2 = [
    { id: 'D1', class: 'semantic', question: 'что считается доставкой', chosen: 'квитанция о получении', options: ['отправка', 'квитанция'], impact: 'user-visible', reversible: false, confirmation: { kind: 'customer', who: 'заказчик', at: '2026-10-26' } },
    { id: 'D2', class: 'semantic', question: 'сколько ретраев', chosen: 'два', options: ['один', 'два'], impact: 'internal', reversible: true },
  ];
  write(path.join(task2, 'task.md'), '# Задание 0002\n\n<!-- TASK-META\n' + JSON.stringify({ id: '0002', risk: 'medium', issuedBy: { kind: 'agent', session: 'issuer-session' }, decisions: decisions2 }, null, 2) + '\n-->\n\n## Цель\n\nПроверка решений.\n');
  write(path.join(task2, 'criteria.json'), JSON.stringify({ task: '0002', redExpect: { mustFail: ['C1'], mustPass: [], reasons: { C1: 'x' } }, criteria: [{ id: 'C1', command: 'node checks/add.mjs', covers: ['src/**'], expect: { exitCode: 0 }, tags: ['behavior'] }] }, null, 2) + '\n');
  git(repo, ['add', '-A']);
  git(repo, ['commit', '-q', '-m', 'task 0002 contract']);
  const candidate2 = git(repo, ['rev-parse', 'HEAD']);
  const summary2 = summarizeDecisions(decisions2, [{ id: 'C1' }]);
  const record2 = signRecord({
    ...base,
    task: '0002',
    taskFileSha256: sha(path.join(task2, 'task.md')),
    criteriaSha256: sha(path.join(task2, 'criteria.json')),
    criteriaJsonSha256: sha(path.join(task2, 'criteria.json')),
    contractCommit: candidate2,
    baseCommit: candidate2,
    candidateCommit: candidate2,
    tree: git(repo, ['rev-parse', 'HEAD^{tree}']),
    red: { ...base.red, contractCommit: candidate2, criteriaJsonSha256: sha(path.join(task2, 'criteria.json')) },
    acceptorRun: { ...base.acceptorRun, verifySha256: null, verifyLogSha256: null },
    decisions: { count: summary2.count, digest: summary2.digest, assumed: summary2.assumed, confirmed: summary2.confirmed },
    releaseReady: false,
    review: null,
  }, { privateKeyPem: agent.privateKeyPem, keyId: 'agent-main' });
  const record2Path = path.join(tmp, 'record2.json');
  fs.writeFileSync(record2Path, JSON.stringify(record2, null, 2) + '\n');
  const record2Run = runChecker(record2Path, repo, keysFile, ['--task', 'docs/tasks/0002']);
  report('запись v5 с assumed-решением принимается, но releaseReady=false', record2Run.status === 0, record2Run.stdout + record2Run.stderr);

  const record2Ready = signRecord({ ...record2, releaseReady: true }, { privateKeyPem: agent.privateKeyPem, keyId: 'agent-main' });
  const record2ReadyPath = path.join(tmp, 'record2-ready.json');
  fs.writeFileSync(record2ReadyPath, JSON.stringify(record2Ready, null, 2) + '\n');
  const record2ReadyRun = runChecker(record2ReadyPath, repo, keysFile, ['--task', 'docs/tasks/0002']);
  report('releaseReady=true при assumed-решениях отклоняется', record2ReadyRun.status !== 0 && /releaseReady/.test(record2ReadyRun.stdout + record2ReadyRun.stderr));

  const record2Hidden = signRecord({ ...record2, decisions: { ...record2.decisions, assumed: [] } }, { privateKeyPem: agent.privateKeyPem, keyId: 'agent-main' });
  const record2HiddenPath = path.join(tmp, 'record2-hidden.json');
  fs.writeFileSync(record2HiddenPath, JSON.stringify(record2Hidden, null, 2) + '\n');
  const record2HiddenRun = runChecker(record2HiddenPath, repo, keysFile, ['--task', 'docs/tasks/0002']);
  report('спрятанный assumed ловится по контракту', record2HiddenRun.status !== 0 && /assumed/.test(record2HiddenRun.stdout + record2HiddenRun.stderr));

  write(path.join(repo, 'src', 'app.js'), 'export const add = (a, b) => a + b + 0;\n');
  git(repo, ['add', '-A']);
  git(repo, ['commit', '-q', '-m', 'metadata that changes code']);
  const badMetadata = git(repo, ['rev-parse', 'HEAD']);
  fs.writeFileSync(acceptancePath, JSON.stringify(signRecord(base, { privateKeyPem: agent.privateKeyPem, keyId: 'agent-main' }), null, 2) + '\n');
  const metaRun = runChecker(acceptancePath, repo, keysFile, ['--metadata', badMetadata]);
  report('metadata-коммит с правкой кода отклоняется', metaRun.status !== 0);

  git(repo, ['checkout', '-q', candidateCommit]);
  write(path.join(taskDir, 'acceptance.json'), JSON.stringify(signRecord(base, { privateKeyPem: agent.privateKeyPem, keyId: 'agent-main' }), null, 2) + '\n');
  git(repo, ['add', '-A']);
  git(repo, ['commit', '-q', '-m', 'candidate with acceptance']);
  const badCandidate = git(repo, ['rev-parse', 'HEAD']);
  const badCandidateRecord = signRecord({ ...base, candidateCommit: badCandidate, tree: git(repo, ['rev-parse', 'HEAD^{tree}']) }, { privateKeyPem: agent.privateKeyPem, keyId: 'agent-main' });
  const badCandidatePath = path.join(tmp, 'bad-candidate.json');
  fs.writeFileSync(badCandidatePath, JSON.stringify(badCandidateRecord, null, 2));
  report('acceptance внутри кандидата отклоняется', runChecker(badCandidatePath, repo, keysFile).status !== 0);
  git(repo, ['checkout', '-q', mainBranch]);
} catch (err) {
  failed += 1;
  console.error('SELFTEST ERROR: ' + err.stack);
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}

if (failed) {
  console.log('\nSELFTEST FAILED: ' + failed);
  process.exit(1);
}
console.log('\nSELFTEST OK');
