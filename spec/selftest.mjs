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
import { summarizeDecisions, evaluateEffects, TOOL, loadConfig } from './scripts/lib/common.mjs';
import { detectActor, assessIndependence } from './scripts/actor.mjs';
import { classifyAcceptance, loadBaseline, baselineEntry, isExpired, baselineCandidates, shouldFail } from './scripts/lib/regress.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CHECKER = path.join(HERE, 'scripts', 'task-check-acceptance.mjs');
const DOCTOR = path.join(HERE, 'scripts', 'doctor.mjs');
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

  /*
   * 2.3.1: регресс и долг провенанса — разные вещи. Классификация проверяется
   * отдельно от прогона: это чистая функция, ей не нужен git и ворота.
   */
  const classify = (record, extra) => classifyAcceptance(record, extra).status;
  report('regress: medium без красного — нарушение', classify({ version: 6, status: 'accepted', risk: 'medium', contractCommit: 'a' }) === 'unproven-violation');
  report('regress: low без красного и без обхода — нарушение', classify({ version: 6, status: 'accepted', risk: 'low', contractCommit: 'a' }) === 'unproven-violation');
  report('regress: low + allowMissingRed — законный долг', classify({ version: 6, status: 'accepted', risk: 'low', contractCommit: 'a', bypasses: { allowMissingRed: true } }) === 'unproven-lawful');
  report('regress: запись v3 — legacy', classify({ version: 3, status: 'accepted', risk: 'low' }) === 'legacy');
  report('regress: подпись не сходится — untrusted', classify({ version: 6, status: 'accepted', risk: 'medium', contractCommit: 'a', red: { baseSha: 'a', contractCommit: 'a' } }, { signatureOk: false }) === 'untrusted');
  report('regress: свежий красный — ok', classify({ version: 6, status: 'accepted', risk: 'medium', contractCommit: 'a', red: { baseSha: 'a', contractCommit: 'a' } }) === 'ok');
  report('regress: красный от другого контракта — нарушение', classify({ version: 6, status: 'accepted', risk: 'medium', contractCommit: 'b', red: { baseSha: 'a', contractCommit: 'b' } }) === 'unproven-violation');
  report('regress: baseline просрочен', isExpired({ reviewBy: '2020-01-01' }) === true && isExpired({ reviewBy: '2999-01-01' }) === false);
  const baselineProbe = loadBaseline(JSON.stringify({ version: 1, entries: [{ task: '0001', status: 'unproven-lawful', reviewBy: '2026-11-26' }] }));
  report('regress: baseline находит запись по задаче и статусу', baselineEntry(baselineProbe, '0001', 'unproven-lawful') !== null && baselineEntry(baselineProbe, '0001', 'unproven-violation') === null);

  /* 2.3.2: baseline фиксирует долг провенанса, а не разрешение ломаться. */
  report('regress: задача из baseline с регрессом всё равно валит прогон',
    shouldFail({ status: 'regressed', baseline: { task: '0001', reviewBy: '2999-01-01' } }, false) === true
    && shouldFail({ status: 'regressed', baseline: { task: '0001' } }, true) === true);
  report('regress: погашенный долг валит только при --strict и просрочке',
    shouldFail({ status: 'baselined', expiredBaseline: false }, false) === false
    && shouldFail({ status: 'baselined', expiredBaseline: true }, false) === false
    && shouldFail({ status: 'baselined', expiredBaseline: true }, true) === true);
  report('regress: нарушение не гасится baseline',
    shouldFail({ status: 'unproven-violation', baseline: { task: '0001' } }, false) === true);
  const candidates = baselineCandidates([
    { task: '0001', provenance: 'unproven-lawful', reason: 'low' },
    { task: '0002', provenance: 'unproven-violation', reason: 'medium' },
    { task: '0003', provenance: 'ok', reason: '' },
  ], {});
  report('regress: --write-baseline берёт только законный долг',
    candidates.length === 1 && candidates[0].task === '0001');
  report('regress: нарушения попадают в baseline только с --include-violations',
    baselineCandidates([{ task: '0002', provenance: 'unproven-violation' }], { includeViolations: true }).length === 1);

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
    version: 6,
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
    attack: null,
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

  /* 2.3.1: запись v3 — история, а не подделка: ворота говорят «legacy» и не валят CI. */
  const legacyPath = path.join(tmp, 'legacy-v3.json');
  fs.writeFileSync(legacyPath, JSON.stringify({ version: 3, status: 'accepted', task: '0001' }, null, 2) + '\n');
  const legacyRun = spawnSync(process.execPath, [CHECKER, '--file', legacyPath, '--repo', repo, '--keys', keysFile], { encoding: 'utf8' });
  report('запись v3 принимается как legacy', legacyRun.status === 0 && /legacy/.test(legacyRun.stdout + legacyRun.stderr), legacyRun.stdout + legacyRun.stderr);

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
   * 2.6.0: источники актора. Уровень держится не на «переменная есть», а на
   * виде источника: harness/runner — env/separate-session, ci/manual —
   * declared. Пустое окружение — none/declared. Legacy-конфиг не меняет
   * поведения, неизвестный вид закрывает ворота.
   */
  const resolveActor = (actorConfig, env) => {
    const actor = detectActor(env, actorConfig);
    const independence = assessIndependence({ actor, issuedBy: null, executorSession: null, risk: 'medium' });
    return { actor, independence };
  };
  const sourceCases = [
    { kind: 'harness', envName: 'DSH_SESSION_ID', env: { DSH_SESSION_ID: 'harness-1' }, attestedBy: 'env', level: 'separate-session' },
    { kind: 'runner', envName: 'WF_ACTOR_SESSION', env: { WF_ACTOR_SESSION: 'runner-1' }, attestedBy: 'env', level: 'separate-session' },
    { kind: 'ci', envName: 'GITHUB_RUN_ID', env: { GITHUB_RUN_ID: '42' }, attestedBy: 'declared', level: 'declared' },
    { kind: 'manual', envName: 'TASK_ACTOR_SESSION', env: { TASK_ACTOR_SESSION: 'manual-1' }, attestedBy: 'declared', level: 'declared' },
  ];
  for (const item of sourceCases) {
    const resolved = resolveActor({ sources: [{ env: item.envName, kind: item.kind }] }, item.env);
    report('актор ' + item.kind + ': ' + item.attestedBy + ' / ' + item.level,
      resolved.actor.attestedBy === item.attestedBy
        && resolved.actor.source === item.envName
        && resolved.actor.sourceKind === item.kind
        && resolved.independence.level === item.level
        && resolved.independence.basis === item.kind,
      JSON.stringify(resolved));
  }

  const emptyActor = resolveActor({ sources: [{ env: 'WF_ACTOR_SESSION', kind: 'runner' }] }, {});
  report('пустое окружение: none/declared, сессии и источника нет',
    emptyActor.actor.attestedBy === 'none'
      && emptyActor.actor.session === null
      && emptyActor.actor.source === null
      && emptyActor.actor.sourceKind === null
      && emptyActor.independence.level === 'declared'
      && emptyActor.independence.basis === 'none'
      && emptyActor.independence.ok === false,
    JSON.stringify(emptyActor));

  const cfgDir = path.join(tmp, 'config-cases');
  const loadActorConfig = (name, actorConfig) => {
    write(path.join(cfgDir, name + '.json'), JSON.stringify({ version: 1, actor: actorConfig }, null, 2) + '\n');
    return loadConfig(cfgDir, name + '.json').actor;
  };
  const legacyConfig = loadActorConfig('legacy', { primaryEnv: 'DSH_SESSION_ID', fallbackEnv: 'TASK_ACTOR_SESSION', modelEnv: 'DSH_MODEL' });
  report('legacy-конфиг: primary → harness, fallback → manual',
    legacyConfig.sources.length === 2
      && legacyConfig.sources[0].env === 'DSH_SESSION_ID' && legacyConfig.sources[0].kind === 'harness'
      && legacyConfig.sources[1].env === 'TASK_ACTOR_SESSION' && legacyConfig.sources[1].kind === 'manual'
      && legacyConfig.errors.length === 0,
    JSON.stringify(legacyConfig));
  const legacyPrimary = resolveActor(legacyConfig, { DSH_SESSION_ID: 'legacy-primary' });
  const legacyFallback = resolveActor(legacyConfig, { TASK_ACTOR_SESSION: 'legacy-fallback' });
  report('legacy-конфиг не меняет поведения: env/separate-session и declared',
    legacyPrimary.actor.attestedBy === 'env' && legacyPrimary.independence.level === 'separate-session'
      && legacyFallback.actor.attestedBy === 'declared' && legacyFallback.independence.level === 'declared',
    JSON.stringify({ legacyPrimary, legacyFallback }));

  const bareConfig = loadActorConfig('bare', { sources: [{ env: 'WF_ACTOR_SESSION', kind: 'runner' }] });
  report('конфиг без legacy-полей не падает: дефолты подставлены',
    bareConfig.primaryEnv === 'DSH_SESSION_ID'
      && bareConfig.fallbackEnv === 'TASK_ACTOR_SESSION'
      && bareConfig.modelEnv === 'DSH_MODEL'
      && bareConfig.sources.length === 1
      && bareConfig.errors.length === 0,
    JSON.stringify(bareConfig));

  const vendorConfig = loadActorConfig('vendor', { sources: [{ env: 'WF_ACTOR_SESSION', kind: 'vendor' }] });
  const vendorActor = resolveActor(vendorConfig, { WF_ACTOR_SESSION: 'vendor-session' });
  report('неизвестный вид источника: ошибка конфига, а не сессия',
    vendorConfig.errors.length === 1
      && /vendor/.test(vendorConfig.errors[0])
      && vendorConfig.sources.length === 0
      && vendorActor.actor.attestedBy === 'none'
      && vendorActor.independence.level === 'declared',
    JSON.stringify({ vendorConfig, vendorActor }));

  const modelConfig = loadActorConfig('models', { sources: [{ env: 'WF_ACTOR_SESSION', kind: 'runner' }], modelSources: ['WF_ACTOR_MODEL'] });
  report('модель берётся из modelSources, без них — unknown',
    detectActor({ WF_ACTOR_SESSION: 'x', WF_ACTOR_MODEL: 'model-r' }, modelConfig).model === 'model-r'
      && detectActor({}, { sources: [] }).model === 'unknown',
    JSON.stringify({ model: detectActor({ WF_ACTOR_SESSION: 'x', WF_ACTOR_MODEL: 'model-r' }, modelConfig).model }));

  /*
   * Сверка записи: вид источника обязан совпадать с уровнем. Запись с
   * runner/separate-session принимается, ci с separate-session — отклоняется
   * словами «источник актора ci не соответствует уровню …».
   */
  const runnerRecord = signRecord({
    ...base,
    actor: { ...base.actor, source: 'WF_ACTOR_SESSION', sourceKind: 'runner' },
    independence: { ...base.independence, basis: 'runner' },
  }, { privateKeyPem: agent.privateKeyPem, keyId: 'agent-main' });
  const runnerRecordPath = path.join(tmp, 'record-runner.json');
  fs.writeFileSync(runnerRecordPath, JSON.stringify(runnerRecord, null, 2) + '\n');
  const runnerRecordRun = runChecker(runnerRecordPath, repo, keysFile);
  report('запись с источником runner и separate-session принимается', runnerRecordRun.status === 0, runnerRecordRun.stdout + runnerRecordRun.stderr);

  const ciRecord = signRecord({
    ...base,
    actor: { ...base.actor, session: 'ci-session', attestedBy: 'declared', source: 'GITHUB_RUN_ID', sourceKind: 'ci' },
    independence: { ...base.independence, level: 'separate-session', basis: 'ci' },
  }, { privateKeyPem: agent.privateKeyPem, keyId: 'agent-main' });
  const ciRecordPath = path.join(tmp, 'record-ci.json');
  fs.writeFileSync(ciRecordPath, JSON.stringify(ciRecord, null, 2) + '\n');
  const ciRecordRun = runChecker(ciRecordPath, repo, keysFile);
  report('источник ci с уровнем separate-session отклоняется',
    ciRecordRun.status !== 0 && /источник актора ci не соответствует уровню/.test(ciRecordRun.stdout + ciRecordRun.stderr),
    ciRecordRun.stdout + ciRecordRun.stderr);

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
    red: { ...base.red, baseSha: candidate2, contractCommit: candidate2, criteriaJsonSha256: sha(path.join(task2, 'criteria.json')) },
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

  /*
   * I-32 (2.3.0): запись v6 с красным прогоном от другого контракта отклоняется —
   * перевыпуск не наследует старый красный.
   */
  const record2StaleRed = signRecord({
    ...record2,
    red: { ...record2.red, baseSha: base.red.baseSha },
  }, { privateKeyPem: agent.privateKeyPem, keyId: 'agent-main' });
  const record2StaleRedPath = path.join(tmp, 'record2-stale-red.json');
  fs.writeFileSync(record2StaleRedPath, JSON.stringify(record2StaleRed, null, 2) + '\n');
  const record2StaleRedRun = runChecker(record2StaleRedPath, repo, keysFile, ['--task', 'docs/tasks/0002']);
  report('красный прогон от другого контракта отклоняется', record2StaleRedRun.status !== 0 && /baseSha/.test(record2StaleRedRun.stdout + record2StaleRedRun.stderr));

  const record2Attack = signRecord({
    ...record2,
    attack: { present: true, sha256: 'c'.repeat(64), session: 'critic-session', model: 'critic-model', family: null, level: 'unknown', findings: { total: 1, blocking: 0, unresolved: 0 }, attestation: 'declared' },
  }, { privateKeyPem: agent.privateKeyPem, keyId: 'agent-main' });
  const record2AttackPath = path.join(tmp, 'record2-attack.json');
  fs.writeFileSync(record2AttackPath, JSON.stringify(record2Attack, null, 2) + '\n');
  const record2AttackRun = runChecker(record2AttackPath, repo, keysFile, ['--task', 'docs/tasks/0002']);
  report('запись со ссылкой на отсутствующий attack.json отклоняется', record2AttackRun.status !== 0 && /attack\.json/.test(record2AttackRun.stdout + record2AttackRun.stderr));

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

  /*
   * 2.4.0 (I-34): доказательство решения и эффект — одна цепь. Чистые кейсы:
   * evaluateEffects проверяется как функция, без git и без запуска критериев.
   */
  const criteriaBase = () => ([
    { id: 'C1', command: 'node checks/add.mjs' },
    { id: 'C2', command: 'node checks/negative.mjs', tags: ['negative'] },
    { id: 'C3', command: 'node checks/effect.mjs', effect: { observable: 'пользователь получает сумму', threshold: 'ok 3', measuredBy: 'C1' } },
    { id: 'C4', command: 'node checks/other.mjs' },
  ]);
  const decision = (id, impact, ref, extra = {}) => ({
    id, class: 'semantic', question: 'q', chosen: 'c', options: ['a', 'b'], impact, reversible: false,
    ...(ref ? { evidence: { kind: 'criterion', ref } } : {}),
    ...extra,
  });
  const checkEffects = (decisions, criteria) => evaluateEffects({ decisions }, { criteria });

  const u1 = checkEffects([decision('D1', 'user-visible', 'C1')], criteriaBase());
  report('U1: решение ссылается на измеритель — связь есть',
    u1.issues.length === 0 && u1.links.length === 1 && u1.links[0].carrier === 'C3' && u1.links[0].measuredBy === 'C1',
    JSON.stringify(u1));

  const u2 = checkEffects([decision('D1', 'user-visible', 'C3')], criteriaBase());
  report('U2: решение ссылается на носитель — связь есть',
    u2.issues.length === 0 && u2.links.length === 1 && u2.links[0].criterion === 'C3' && u2.links[0].carrier === 'C3',
    JSON.stringify(u2));

  const u3 = checkEffects([decision('D1', 'user-visible', 'C4')], criteriaBase());
  report('U3: решение вне цепи эффекта — ошибка с именем решения и цепи',
    u3.issues.length === 1 && /D1/.test(u3.issues[0]) && /C4/.test(u3.issues[0]) && /C3→C1/.test(u3.issues[0]) && u3.consistencyIssues.length === 1,
    JSON.stringify(u3));

  const u4 = checkEffects([decision('D1', 'user-visible', 'C1'), decision('D2', 'user-visible', 'C4')], criteriaBase());
  report('U4: наружу выходит только несвязанное решение',
    u4.issues.length === 1 && /D2/.test(u4.issues[0]) && !/D1/.test(u4.issues[0]),
    JSON.stringify(u4));

  const u5 = checkEffects([decision('D1', 'user-visible', 'C1'), decision('D2', 'internal', 'C4')], criteriaBase());
  report('U5: внутреннее решение вне цепи — не нарушение',
    u5.issues.length === 0 && u5.links.length === 1,
    JSON.stringify(u5));

  const u6 = checkEffects([decision('D1', 'user-visible', null, { evidence: { kind: 'spec', ref: 'SPEC §5' } })], criteriaBase());
  report('U6: доказательство спецификацией — не применимо',
    u6.issues.length === 0 && u6.links.length === 0,
    JSON.stringify(u6));

  const u7 = checkEffects(
    [decision('D1', 'user-visible', 'Cm')],
    [...criteriaBase(), { id: 'Cm', command: 'node checks/manual.mjs', manual: true }],
  );
  report('U7: manual-критерий — человеческое доказательство, не применимо',
    u7.issues.length === 0 && u7.links.length === 0,
    JSON.stringify(u7));

  const u8a = checkEffects(
    [{ id: 'D1', class: 'mechanical', question: 'q', chosen: 'c', impact: 'user-visible' }],
    [{ id: 'C1', command: 'node checks/add.mjs' }],
  );
  report('U8a: mechanical user-visible без эффекта — required ловит, consistency молчит',
    u8a.required === true && u8a.issues.some((issue) => /ни один критерий не объявляет effect/.test(issue))
      && u8a.consistencyIssues.length === 0,
    JSON.stringify(u8a));

  const u8b = checkEffects(
    [{ id: 'D1', class: 'mechanical', question: 'q', chosen: 'c', impact: 'user-visible', evidence: { kind: 'criterion', ref: 'C4' } }],
    criteriaBase(),
  );
  report('U8b: mechanical user-visible вне цепи — consistency не применяется',
    u8b.required === true && u8b.issues.length === 0 && u8b.consistencyIssues.length === 0,
    JSON.stringify(u8b));

  const u9 = checkEffects([], criteriaBase());
  report('U9: решений нет — правило молчит, checked=false',
    u9.issues.length === 0 && u9.checked === false && u9.links.length === 0,
    JSON.stringify(u9));

  const u10 = checkEffects(
    [decision('D1', 'user-visible', 'C2')],
    [...criteriaBase(), { id: 'C5', command: 'node checks/two.mjs', effect: { observable: 'второй эффект', threshold: 'ok', measuredBy: 'C2' } }],
  );
  report('U10: решение входит во вторую цепь — pass',
    u10.issues.length === 0 && u10.links.length === 1 && u10.links[0].carrier === 'C5' && u10.links[0].measuredBy === 'C2',
    JSON.stringify(u10));

  let u11;
  try {
    u11 = checkEffects([null, 42], criteriaBase());
  } catch (err) {
    u11 = { error: String(err) };
  }
  report('U11: мусор в decisions не роняет проверку',
    !u11.error && u11.issues.length === 0 && u11.checked === false,
    JSON.stringify(u11));

  const u12 = checkEffects(
    [decision('D1', 'user-visible', 'C1')],
    [...criteriaBase(), { id: 'C5', command: 'node checks/bad.mjs', effect: { observable: 'x', threshold: 'y', measuredBy: 'C5' } }],
  );
  report('U12: невалидный эффект не даёт каскада consistency',
    u12.issues.some((issue) => /сам критерий/.test(issue)) && u12.consistencyIssues.length === 0 && u12.links.length === 1,
    JSON.stringify(u12));

  /*
   * R1–R6 (2.4.0): запись и CI. Согласованность пересчитывается по контракту,
   * links сверяются, legacy-записи без блока не ломаются, policy.decisions
   * управляет строгостью (Q9).
   */
  const makeTask = (id, decisionRef) => {
    const dir = path.join(repo, 'docs', 'tasks', id);
    const decisions = [{
      id: 'D1', class: 'semantic', question: 'q', chosen: 'c', options: ['a', 'b'],
      impact: 'user-visible', reversible: false, evidence: { kind: 'criterion', ref: decisionRef },
      status: 'confirmed',
    }];
    write(path.join(dir, 'task.md'), '# Задание ' + id + '\n\n<!-- TASK-META\n' + JSON.stringify({
      id, version: 1, risk: 'medium', created: '2026-10-27', owner: 'architect',
      executor: 'subagent:executor', acceptor: 'subagent:judge', base: 'HEAD',
      criteria: 'criteria.json', allowedPaths: ['src/**'],
      issuedBy: { kind: 'agent', session: 'issuer-session' }, decisions,
    }, null, 2) + '\n-->\n');
    const criteria = [
      { id: 'C1', title: 'сложение', command: 'node checks/add.mjs', covers: ['src/**'], expect: { exitCode: 0 } },
      { id: 'C2', title: 'негатив', command: 'node checks/negative.mjs', tags: ['negative'], expect: { exitCode: 1 } },
      { id: 'C3', title: 'эффект', command: 'node checks/effect.mjs', effect: { observable: 'сумма', threshold: 'sum 3', measuredBy: 'C1' }, expect: { exitCode: 0 } },
    ];
    write(path.join(dir, 'criteria.json'), JSON.stringify({ task: id, criteria }, null, 2) + '\n');
    git(repo, ['add', '-A']);
    git(repo, ['commit', '-q', '-m', 'task ' + id + ' contract']);
    return {
      id, decisions, criteria,
      commit: git(repo, ['rev-parse', 'HEAD']),
      tree: git(repo, ['rev-parse', 'HEAD^{tree}']),
    };
  };
  const makeRecord = (task, extra = {}) => {
    const summary = summarizeDecisions(task.decisions, task.criteria);
    const digest = sha(path.join(repo, 'docs/tasks', task.id, 'task.md'));
    const criteriaDigest = sha(path.join(repo, 'docs/tasks', task.id, 'criteria.json'));
    return signRecord({
      ...base,
      task: task.id,
      taskFileSha256: digest,
      criteriaSha256: criteriaDigest,
      criteriaJsonSha256: criteriaDigest,
      contractCommit: task.commit,
      baseCommit: task.commit,
      candidateCommit: task.commit,
      tree: task.tree,
      red: { ...base.red, baseSha: task.commit, contractCommit: task.commit, criteriaJsonSha256: criteriaDigest },
      acceptorRun: { ...base.acceptorRun, verifySha256: null },
      decisions: { count: summary.count, digest: summary.digest, assumed: summary.assumed, confirmed: summary.confirmed },
      effects: [{ criterion: 'C3', observable: 'сумма', threshold: 'sum 3', measuredBy: 'C1' }],
      effectsRequired: true,
      effectConsistency: {
        checked: true, ok: true, mode: 'fail',
        links: [{ decision: 'D1', criterion: 'C1', carrier: 'C3', measuredBy: 'C1' }],
      },
      releaseReady: true,
      review: null,
      ...extra,
    }, { privateKeyPem: agent.privateKeyPem, keyId: 'agent-main' });
  };
  const writeRecord = (name, record) => {
    const file = path.join(tmp, name);
    fs.writeFileSync(file, JSON.stringify(record, null, 2) + '\n');
    return file;
  };

  const task3 = makeTask('0003', 'C1');
  const record3 = makeRecord(task3);
  const record3Run = runChecker(writeRecord('record3.json', record3), repo, keysFile, ['--task', 'docs/tasks/0003']);
  report('R1: согласованная запись принимается', record3Run.status === 0, record3Run.stdout + record3Run.stderr);

  const record3BadOk = signRecord({ ...record3, effectConsistency: { ...record3.effectConsistency, ok: false } }, { privateKeyPem: agent.privateKeyPem, keyId: 'agent-main' });
  const badOkRun = runChecker(writeRecord('record3-bad-ok.json', record3BadOk), repo, keysFile, ['--task', 'docs/tasks/0003']);
  report('R2: ok=false при согласованном контракте — расхождение записи', badOkRun.status !== 0 && /effectConsistency/.test(badOkRun.stdout + badOkRun.stderr), badOkRun.stdout + badOkRun.stderr);

  const record3BadLinks = signRecord({ ...record3, effectConsistency: { ...record3.effectConsistency, links: [] } }, { privateKeyPem: agent.privateKeyPem, keyId: 'agent-main' });
  const badLinksRun = runChecker(writeRecord('record3-bad-links.json', record3BadLinks), repo, keysFile, ['--task', 'docs/tasks/0003']);
  report('R4: links не совпадают с контрактом', badLinksRun.status !== 0 && /links/.test(badLinksRun.stdout + badLinksRun.stderr), badLinksRun.stdout + badLinksRun.stderr);

  const legacyRecord = { ...record3 };
  delete legacyRecord.effectConsistency;
  const legacyRecordRun = runChecker(writeRecord('record3-legacy.json', signRecord(legacyRecord, { privateKeyPem: agent.privateKeyPem, keyId: 'agent-main' })), repo, keysFile, ['--task', 'docs/tasks/0003']);
  report('R5: запись без блока (до 2.4.0) не ломается', legacyRecordRun.status === 0, legacyRecordRun.stdout + legacyRecordRun.stderr);

  const legacyNoFlag = { ...legacyRecord };
  delete legacyNoFlag.effectsRequired;
  const legacyNoFlagRun = runChecker(writeRecord('record3-legacy-noflag.json', signRecord(legacyNoFlag, { privateKeyPem: agent.privateKeyPem, keyId: 'agent-main' })), repo, keysFile, ['--task', 'docs/tasks/0003']);
  report('R6: запись без блока и без флага не ломается', legacyNoFlagRun.status === 0, legacyNoFlagRun.stdout + legacyNoFlagRun.stderr);

  /* R3: политика проверки — на контракте, где решение реально вне цепи. */
  const task4 = makeTask('0004', 'C2');
  const record4 = makeRecord(task4, {
    effectConsistency: { checked: true, ok: false, mode: 'fail', links: [] },
  });
  const record4Path = writeRecord('record4.json', record4);
  const failRun = runChecker(record4Path, repo, keysFile, ['--task', 'docs/tasks/0004']);
  report('R3a: policy.decisions=fail валит несогласованную запись', failRun.status !== 0 && /не входит в цепь/.test(failRun.stdout + failRun.stderr), failRun.stdout + failRun.stderr);

  const selftestConfigPath = path.join(repo, 'docs/subagent-workflow/workflow.config.json');
  const hadConfig = fs.existsSync(selftestConfigPath);
  const savedConfig = hadConfig ? fs.readFileSync(selftestConfigPath, 'utf8') : null;
  const warnConfig = savedConfig ? JSON.parse(savedConfig) : { policy: { decisions: 'fail' } };
  warnConfig.policy = { ...(warnConfig.policy || {}), decisions: 'warn' };
  write(selftestConfigPath, JSON.stringify(warnConfig, null, 2) + '\n');
  const warnRun = runChecker(record4Path, repo, keysFile, ['--task', 'docs/tasks/0004']);
  if (hadConfig) fs.writeFileSync(selftestConfigPath, savedConfig);
  else fs.rmSync(selftestConfigPath, { force: true });
  report('R3b: policy.decisions=warn — предупреждение, запись принимается', warnRun.status === 0 && /не входит в цепь/.test(warnRun.stdout + warnRun.stderr), warnRun.stdout + warnRun.stderr);

  /*
   * 2.4.2: TOOL не должен отставать от VERSION — иначе записи приёмки и
   * verify.json представляются старым пакетом.
   */
  const versionFile = fs.existsSync(path.join(HERE, 'VERSION'))
    ? path.join(HERE, 'VERSION')
    : path.join(HERE, '..', 'VERSION');
  const versionValue = fs.readFileSync(versionFile, 'utf8').trim();
  report('TOOL совпадает с VERSION', TOOL === 'subagent-workflow/' + versionValue,
    TOOL + ' != subagent-workflow/' + versionValue);

  /*
   * 2.4.3: ключ человека нужен только для risk: high (SPEC §11, I-18).
   * Раньше доктор предупреждал про human-* всегда, и в проекте без high-задач
   * это читалось как «не хватает внешнего приёмщика» — агент шёл искать людей
   * вместо работы. Проверяем оба конца: молчание без high и предупреждение с ним.
   */
  const doctorRepo = path.join(tmp, 'doctor-repo');
  fs.mkdirSync(doctorRepo, { recursive: true });
  git(doctorRepo, ['init', '-q']);
  const doctorWorkflow = path.join(doctorRepo, 'docs', 'subagent-workflow');
  write(path.join(doctorWorkflow, 'workflow.config.json'),
    JSON.stringify({ version: 1, tasksDir: 'docs/tasks', keysFile: 'docs/subagent-workflow/acceptors.json' }, null, 2) + '\n');
  write(path.join(doctorWorkflow, 'acceptors.json'),
    JSON.stringify({ acceptors: [{ keyId: 'agent-judge', kind: 'agent', owner: 'selftest', publicKeyPem: 'x', fingerprint: 'x' }] }, null, 2) + '\n');
  const doctorTask = (id, risk) => write(path.join(doctorRepo, 'docs', 'tasks', id, 'task.md'),
    '# Задание ' + id + '\n\n<!-- TASK-META\n{ "id": "' + id + '", "risk": "' + risk + '" }\n-->\n');
  doctorTask('0001', 'medium');
  const doctor = () => spawnSync(process.execPath, [DOCTOR, '--repo', doctorRepo], { encoding: 'utf8' });
  const quietDoctor = doctor();
  report('doctor: без задач risk: high про ключ human-* молчит',
    /задач risk: high нет — ключ human-\* не нужен/.test(quietDoctor.stdout),
    quietDoctor.stdout + quietDoctor.stderr);
  doctorTask('0002', 'high');
  const warnedDoctor = doctor();
  report('doctor: задача risk: high включает предупреждение о human-*',
    /WARN\s+ключи: human-\* для high-risk/.test(warnedDoctor.stdout) && /задач risk: high: 1/.test(warnedDoctor.stdout),
    warnedDoctor.stdout + warnedDoctor.stderr);
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
