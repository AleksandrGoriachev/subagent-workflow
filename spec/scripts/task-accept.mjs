#!/usr/bin/env node
/*
 * Приёмка: свежий прогон, аттестация актора, подпись Ed25519, кандидатный коммит.
 *
 * Главное отличие от «приёмки по отчёту»: этот процесс сам запускает проверки,
 * сам читает свою сессию из окружения и сам подписывает запись ключом, публичная
 * часть которого закреплена в репозитории. Строка --acceptor остаётся ролью для
 * чтения, но доказательством независимости больше не служит.
 */
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import {
  parseArgv, readTask, verifyLock, repoRoot, runSync, quoteArg, exists,
  readJson, writeJson, computeWorktreeDigest, sha256File, relPosix, truncate, loadConfig,
  summarizeDecisions, evaluateEffects,
} from './lib/common.mjs';
import { policyOf, applyLevel, modelLevel, familyOf } from './lib/policy.mjs';
import { evaluateAttack } from './lib/attack.mjs';
import { detectActor, assessIndependence } from './actor.mjs';
import { signRecord, loadAcceptors, publicKeyFingerprint } from './sign.mjs';
import { validateReview } from './lib/review.mjs';

const argv = parseArgv(process.argv.slice(2));
if (argv.help) {
  console.log('Usage: node task-accept.mjs --task <dir> --key <private.pem> --key-id <keyId> [--repo <dir>]');
  console.log('       [--acceptor <name>] [--human <who>] [--expect-contract <sha>] [--note <text>]');
  console.log('       [--allow-missing-red] [--allow-manual] [--allow-declared-actor]');
  console.log('       [--review <review.json>] [--reuse-verify] [--report-read] [--dry-run] [--force] [--json]');
  console.log('Запись подписывается Ed25519; для high-risk нужен ключ human-* и --human <кто>.');
  process.exit(0);
}

const taskDir = path.resolve(argv.task || argv._[0] || '.');
const repo = path.resolve(argv.repo || repoRoot(taskDir));
const config = loadConfig(repo);
const logsCommitted = config.logs === 'commit';
const VERIFY_SCRIPT = path.join(path.dirname(fileURLToPath(import.meta.url)), 'task-verify.mjs');

function fail(message) { console.error('task-accept: ' + message); process.exit(1); }

function validateVerify(verify, lockCheck, contractCommit, nonce) {
  if (verify.version !== 4) fail('verify.json: версия ' + verify.version + ' устарела, нужна 4 — прогоните task-verify заново');
  if (verify.kind !== 'verify') fail('verify.json: это не результат task-verify');
  if (verify.task !== String(lockCheck.expected.task)) fail('verify.json относится к другой задаче: ' + verify.task);
  if (!verify.allPassed) fail('verify.json не зелёный: allPassed=false');
  if (Array.isArray(verify.violations) && verify.violations.length > 0) fail('в verify.json есть нарушения: ' + verify.violations.join('; '));
  for (const key of ['criteriaSha256', 'criteriaJsonSha256', 'taskFileSha256', 'contractCommit']) {
    if (verify[key] !== lockCheck.expected[key]) fail(key + ' в verify.json не совпадает с lock');
  }
  if (verify.headSha !== contractCommit) fail('HEAD изменился после verify: ' + verify.headSha + ' -> ' + contractCommit);
  if (nonce !== null && verify.acceptanceNonce !== nonce) fail('verify.json не содержит nonce приёмщика: результат не от свежего прогона');
}

function ignoredPaths(repoRoot, paths) {
  if (paths.length === 0) return new Set();
  const r = runSync('git check-ignore -- ' + paths.map(quoteArg).join(' '), { cwd: repoRoot });
  if (r.exitCode !== 0 && r.exitCode !== 1) fail('git check-ignore: ' + r.stderr.trim());
  return new Set(r.stdout.split(/\r?\n/).filter(Boolean));
}

function createCandidate(repoRoot, filesToAdd, message) {
  const indexPath = path.join(os.tmpdir(), 'task-accept-' + process.pid + '-' + Date.now() + '.index');
  const env = {
    ...process.env,
    GIT_INDEX_FILE: indexPath,
    GIT_AUTHOR_NAME: process.env.GIT_AUTHOR_NAME || 'task-accept',
    GIT_AUTHOR_EMAIL: process.env.GIT_AUTHOR_EMAIL || 'task-accept@local',
    GIT_COMMITTER_NAME: process.env.GIT_COMMITTER_NAME || 'task-accept',
    GIT_COMMITTER_EMAIL: process.env.GIT_COMMITTER_EMAIL || 'task-accept@local',
  };
  delete env.TASK_ACCEPT_KEY;
  delete env.TASK_SIGN_KEY;
  try {
    const read = runSync('git read-tree HEAD', { cwd: repoRoot, env });
    if (read.exitCode !== 0) fail('git read-tree: ' + read.stderr.trim());
    if (filesToAdd.length > 0) {
      const add = runSync('git add -A -- ' + filesToAdd.map(quoteArg).join(' '), { cwd: repoRoot, env });
      if (add.exitCode !== 0) fail('git add: ' + add.stderr.trim());
    }
    const treeRes = runSync('git write-tree', { cwd: repoRoot, env });
    if (treeRes.exitCode !== 0) fail('git write-tree: ' + treeRes.stderr.trim());
    const tree = treeRes.stdout.trim();
    const commitRes = runSync('git commit-tree ' + quoteArg(tree) + ' -p HEAD -m ' + quoteArg(message), { cwd: repoRoot, env });
    if (commitRes.exitCode !== 0) fail('git commit-tree: ' + commitRes.stderr.trim());
    return { commit: commitRes.stdout.trim(), tree };
  } finally {
    try { fs.rmSync(indexPath, { force: true }); } catch { /* ignore */ }
  }
}

try {
  const { files, taskMd, meta, criteria } = readTask(taskDir);
  const lockCheck = verifyLock(repo, taskDir, meta, taskMd, criteria);
  if (!lockCheck.ok) {
    for (const e of lockCheck.errors) console.error('task-accept: lock: ' + e);
    process.exit(1);
  }
  const contractCommit = lockCheck.expected.contractCommit;
  if (argv['expect-contract'] && String(argv['expect-contract']) !== contractCommit) {
    fail('контрактный коммит ' + contractCommit + ' не совпадает с ожидаемым ' + argv['expect-contract'] + ': задание выдавалось на другом контракте');
  }

  const acceptor = String(argv.acceptor || meta.acceptor || '');
  if (!acceptor) fail('не указан acceptor (--acceptor или TASK-META.acceptor)');
  if (acceptor === meta.executor) fail('acceptor не может совпадать с executor');

  const keyId = String(argv['key-id'] || '');
  const keyFile = argv.key ? path.resolve(String(argv.key)) : '';
  if (!keyId || !keyFile) fail('нужны --key <private.pem> и --key-id <keyId>: запись подписывается Ed25519');
  if (!exists(keyFile)) fail('нет файла ключа: ' + keyFile);
  const keysFile = path.resolve(String(argv.keys || config.keysFile));
  if (!exists(keysFile)) fail('нет acceptors.json: ' + keysFile);
  const entry = loadAcceptors(keysFile).find((item) => item.keyId === keyId);
  if (!entry) fail('ключ ' + keyId + ' не закреплён в ' + keysFile);
  if (entry.revokedAt) fail('ключ ' + keyId + ' отозван ' + entry.revokedAt);
  const privateKeyPem = fs.readFileSync(keyFile, 'utf8');
  const derivedPublic = crypto.createPublicKey(privateKeyPem).export({ type: 'spki', format: 'pem' }).toString();
  if (publicKeyFingerprint(derivedPublic) !== publicKeyFingerprint(entry.publicKeyPem)) {
    fail('приватный ключ не соответствует закреплённому публичному ключу ' + keyId);
  }

  const actor = detectActor(process.env, {
    kind: entry.kind,
    model: String(process.env[config.actor.modelEnv] || 'unknown'),
    host: os.hostname(),
    primaryEnv: config.actor.primaryEnv,
    fallbackEnv: config.actor.fallbackEnv,
  });
  const issuedBy = meta.issuedBy || null;
  const executorSession = typeof meta.executorSession === 'string' ? meta.executorSession : null;
  const independence = assessIndependence({ actor, issuedBy, executorSession, risk: meta.risk });
  if (!independence.ok) {
    for (const e of independence.errors) console.error('task-accept: независимость: ' + e);
    process.exit(1);
  }
  if (meta.risk !== 'low' && !issuedBy) fail('нет TASK-META.issuedBy: для medium/high постановщик должен быть зафиксирован в контракте');
  if (actor.attestedBy === 'declared' && meta.risk !== 'low') fail('attestedBy=declared допустим только для low');
  if (actor.attestedBy === 'none' && !argv['allow-declared-actor']) fail('нет сессии приёмщика: добавьте --allow-declared-actor (только low) и --note');
  if (actor.attestedBy === 'none' && !argv.note) fail('--allow-declared-actor требует --note с причиной');

  const requiresHuman = meta.risk === 'high' || meta.humanSignoff === true;
  if (meta.risk === 'high' && meta.securityReview !== true) fail('risk=high без securityReview: true');
  if (meta.risk === 'high' && meta.humanSignoff !== true) fail('risk=high без humanSignoff: true');
  if (requiresHuman) {
    if (entry.kind !== 'human') fail('high-risk принимает только ключ human-*');
    if (typeof argv.human !== 'string' || argv.human.trim() === '') fail('high-risk требует --human <кто> (имя человека)');
  }
  const humanSigner = typeof argv.human === 'string' && argv.human.trim() !== '' ? argv.human.trim() : null;

  /*
   * Решения (2.1.0). Приёмка не спорит с семантикой, но фиксирует её состояние:
   * unproven — решение о пользовательском контракте без критерия и без человека,
   * это отказ; assumed — решение без доказательства, принять можно (работа шла),
   * но releaseReady=false; high — только подтверждённые.
   */
  const gatePolicy = policyOf(config);
  const decisionSummary = summarizeDecisions(meta.decisions, criteria.criteria);
  const decisionApplied = applyLevel(
    gatePolicy.decisions,
    decisionSummary.unproven.map((id) => 'решение ' + id + ': влияние на пользовательский контракт без критерия и без подтверждения'),
  );
  if (decisionApplied.errors.length) fail('решения без доказательства: ' + decisionApplied.errors.join('; '));
  for (const warning of decisionApplied.warnings) console.warn('task-accept: WARN ' + warning);
  if (meta.risk === 'high' && decisionSummary.assumed.length) {
    fail('high-risk: решения без доказательства нельзя принять (' + decisionSummary.assumed.join(', ') + ')');
  }

  /*
   * Эффект (I-31, 2.3.0): решение с влиянием на пользователя должно опираться на
   * критерий, который описывает наблюдаемое состояние или порог.
   */
  const effectCheck = evaluateEffects(meta, criteria);
  const effectApplied = applyLevel(gatePolicy.decisions, effectCheck.issues);
  if (effectApplied.errors.length) fail('эффект: ' + effectApplied.errors.join('; '));
  for (const warning of effectApplied.warnings) console.warn('task-accept: WARN ' + warning);

  /*
   * Атака спецификации (2.2.0). attaсk.json — заявление критика, не подпись:
   * запись помечает его как declared и хранит digest. Строгость — policy.attack.
   */
  const attackFile = path.join(taskDir, 'attack.json');
  const attack = exists(attackFile) ? readJson(attackFile) : null;
  const attackCheck = attack ? evaluateAttack(attack, { meta, config }) : null;
  const attackIssues = [];
  if (attackCheck) attackIssues.push(...attackCheck.issues);
  else if (gatePolicy.attack === 'fail' && meta.risk !== 'low') attackIssues.push('нет attack.json: атака спецификации не проводилась (policy.attack=fail)');
  const attackApplied = applyLevel(gatePolicy.attack, attackIssues);
  const attackFamilyApplied = attackCheck
    ? applyLevel(gatePolicy.roles.modelFamily, attackCheck.familyIssues)
    : { errors: [], warnings: [] };
  if (attackApplied.errors.length || attackFamilyApplied.errors.length) {
    fail('атака спецификации: ' + [...attackApplied.errors, ...attackFamilyApplied.errors].join('; '));
  }
  for (const warning of [...attackApplied.warnings, ...attackFamilyApplied.warnings]) console.warn('task-accept: WARN ' + warning);

  const actorModelLevel = issuedBy && issuedBy.model ? modelLevel(config, issuedBy.model, actor.model) : 'unknown';
  const rolesApplied = applyLevel(
    gatePolicy.roles.modelFamily,
    actorModelLevel === 'same-family' ? ['приёмщик той же модели/семейства, что постановщик (' + actor.model + ')'] : [],
  );
  if (rolesApplied.errors.length) fail('роли: ' + rolesApplied.errors.join('; '));
  for (const warning of rolesApplied.warnings) console.warn('task-accept: WARN ' + warning);
  if (exists(files.acceptance) && !argv.force) fail('acceptance.json уже существует; используйте --force');

  if (argv['dry-run']) {
    if (!exists(files.verify)) fail('dry-run: нет verify.json; сначала выполните task-verify');
    const verify = readJson(files.verify);
    validateVerify(verify, lockCheck, contractCommit, null);
    const digest = computeWorktreeDigest(repo, taskDir, meta);
    if (digest !== verify.worktreeDigest) fail('дерево изменилось после verify (digest не совпадает)');
    console.log(JSON.stringify({
      dryRun: true,
      note: 'проверки не перезапускались',
      actor: { kind: actor.kind, session: actor.session, attestedBy: actor.attestedBy, keyId },
      independence: { level: independence.level, separateSession: independence.level !== 'same-session', reportWithheld: !argv['report-read'], keyCustody: entry.kind === 'human' ? 'human-key' : 'agent-key' },
      acceptance: {
        version: 6, status: 'accepted', task: String(meta.id), candidateCommit: null, tree: null, worktreeDigest: digest,
        decisions: { count: decisionSummary.count, digest: decisionSummary.digest, assumed: decisionSummary.assumed, confirmed: decisionSummary.confirmed },
        attack: attackCheck
          ? { present: true, sha256: sha256File(attackFile), session: attackCheck.critic.session || null, model: attackCheck.critic.model || null, family: attackCheck.family, level: attackCheck.level, findings: attackCheck.summary, attestation: 'declared' }
          : null,
        actor: { model: actor.model, family: familyOf(config, actor.model) },
        independence: { level: independence.level, modelLevel: actorModelLevel },
        releaseReady: decisionSummary.assumed.length === 0 && (!attackCheck || attackCheck.summary.unresolved === 0),
        acceptor, humanSignoff: Boolean(requiresHuman && humanSigner), signedBy: humanSigner,
      },
    }, null, 2));
    process.exit(0);
  }

  let verify;
  let acceptorRun;
  const fresh = !argv['reuse-verify'];

  if (fresh) {
    const nonce = crypto.randomBytes(16).toString('hex');
    const args = [VERIFY_SCRIPT, '--task', taskDir, '--repo', repo, '--json'];
    if (argv['allow-missing-red']) args.push('--allow-missing-red');
    if (argv['allow-manual']) args.push('--allow-manual');
    const command = [process.execPath, ...args].map(quoteArg).join(' ');
    const startedAt = new Date();
    const started = Date.now();
    const run = runSync(command, {
      cwd: repo,
      timeoutMs: Number(process.env.TASK_VERIFY_TIMEOUT_MS) || config.verifyTimeoutMs,
      env: { ...process.env, TASK_ACCEPT_NONCE: nonce, TASK_ACCEPT_RUN: 'accept' },
      unsetEnv: ['TASK_ACCEPT_KEY', 'TASK_SIGN_KEY'],
    });
    const finishedAt = new Date();
    if (run.exitCode !== 0) fail('свежий прогон приёмщика не прошёл (exit=' + run.exitCode + '):\n' + truncate(run.stdout + '\n' + run.stderr, 6000));
    if (!exists(files.verify)) fail('свежий прогон не создал verify.json');
    verify = readJson(files.verify);
    if (verify.acceptanceNonce !== nonce) fail('verify.json не содержит nonce приёмщика: результат не от свежего прогона');
    acceptorRun = {
      fresh: true,
      nonce,
      runKind: 'accept',
      startedAt: startedAt.toISOString(),
      finishedAt: finishedAt.toISOString(),
      durationMs: Date.now() - started,
      host: os.hostname(),
      node: process.version,
      verifySha256: sha256File(files.verify),
      verifyLogSha256: logsCommitted && exists(files.verifyLog) ? sha256File(files.verifyLog) : null,
    };
  } else {
    if (meta.risk !== 'low') fail('--reuse-verify разрешён только для risk=low: для medium/high нужен свежий прогон приёмщика');
    if (!argv.note) fail('--reuse-verify требует --note с причиной');
    if (!exists(files.verify)) fail('нет verify.json — сначала выполните task-verify');
    verify = readJson(files.verify);
    acceptorRun = {
      fresh: false,
      reused: true,
      nonce: verify.acceptanceNonce || null,
      runKind: verify.runKind || 'self',
      startedAt: null,
      finishedAt: null,
      durationMs: null,
      host: null,
      node: null,
      verifySha256: sha256File(files.verify),
      verifyLogSha256: logsCommitted && exists(files.verifyLog) ? sha256File(files.verifyLog) : null,
    };
  }

  validateVerify(verify, lockCheck, contractCommit, fresh ? acceptorRun.nonce : null);
  const digest = computeWorktreeDigest(repo, taskDir, meta);
  if (digest !== verify.worktreeDigest) fail('дерево изменилось после verify (digest не совпадает); перезапустите task-verify');

  if (verify.red && !exists(files.red)) fail('red.json исчез после verify; доказательство красного потеряно');
  const red = exists(files.red) ? readJson(files.red) : null;
  if (red && verify.red) {
    for (const key of ['baseSha', 'contractCommit', 'criteriaJsonSha256', 'failed', 'failedIds', 'redExpectation', 'bypasses']) {
      if (JSON.stringify(red[key]) !== JSON.stringify(verify.red[key])) fail('red.json изменился после verify: ' + key);
    }
  }

  const bypasses = { ...(verify.bypasses || {}), ...(red && red.bypasses ? red.bypasses : {}) };
  if (argv['allow-missing-red'] && verify.bypasses && verify.bypasses.allowMissingRed) bypasses.allowMissingRed = true;
  const activeBypasses = Object.entries(bypasses).filter(([, value]) => value === true).map(([key]) => key);
  if (activeBypasses.length > 0 && meta.risk === 'high') fail('high-risk задача не принимается с обходом: ' + activeBypasses.join(', '));
  if (activeBypasses.length > 0 && !argv.note) fail('обход (' + activeBypasses.join(', ') + ') требует --note с причиной');
  const manualBypass = verify.bypasses && verify.bypasses.allowManual === true;
  if (manualBypass && !humanSigner) fail('manual-критерии требуют --human <кто>: пропуск ручной проверки не подписывается автоматически');

  let review = null;
  let releaseReady = true;
  if (argv.review) {
    const reviewPath = path.resolve(String(argv.review));
    if (!exists(reviewPath)) fail('нет файла review: ' + reviewPath);
    review = readJson(reviewPath);
    const reviewCheck = validateReview(review);
    if (!reviewCheck.ok) {
      for (const error of reviewCheck.errors) console.error('task-accept: review: ' + error);
      process.exit(1);
    }
    releaseReady = reviewCheck.releaseReady;
  }
  if (decisionSummary.assumed.length) releaseReady = false;
  if (attackCheck && attackCheck.summary.unresolved > 0) releaseReady = false;

  const body = {
    version: 6,
    status: 'accepted',
    task: String(meta.id),
    title: meta.title || '',
    risk: meta.risk || '',
    taskFileSha256: lockCheck.expected.taskFileSha256,
    criteriaSha256: lockCheck.expected.criteriaSha256,
    criteriaJsonSha256: lockCheck.expected.criteriaJsonSha256,
    contractCommit,
    baseCommit: contractCommit,
    candidateCommit: null,
    tree: null,
    worktreeDigest: digest,
    issuedBy: issuedBy || { kind: 'agent', session: null },
    actor: { kind: actor.kind, session: actor.session, model: actor.model, family: familyOf(config, actor.model), host: actor.host, keyId, attestedBy: actor.attestedBy },
    independence: {
      level: independence.level,
      separateSession: independence.level === 'separate-session' || independence.level === 'human',
      reportWithheld: !argv['report-read'],
      keyCustody: entry.kind === 'human' ? 'human-key' : 'agent-key',
      modelLevel: actorModelLevel,
    },
    acceptorRun,
    effects: effectCheck.effects,
    effectsRequired: effectCheck.required,
    bypasses,
    red: red
      ? {
          baseSha: red.baseSha,
          contractCommit: red.contractCommit,
          criteriaJsonSha256: red.criteriaJsonSha256,
          failed: red.failed,
          failedIds: red.failedIds,
          redExpectation: red.redExpectation || null,
          ...(logsCommitted && red.log ? { log: red.log } : {}),
        }
      : null,
    checks: (verify.results || []).map((r) => ({ id: r.id, command: r.command, exitCode: r.exitCode, durationMs: r.durationMs, passed: r.passed })),
    acceptor,
    acceptedAt: new Date().toISOString(),
    humanSignoff: Boolean(requiresHuman && humanSigner),
    signedBy: humanSigner,
    securityReview: meta.securityReview === true,
    review,
    decisions: {
      count: decisionSummary.count,
      digest: decisionSummary.digest,
      assumed: decisionSummary.assumed,
      confirmed: decisionSummary.confirmed,
    },
    attack: attackCheck
      ? {
          present: true,
          sha256: sha256File(attackFile),
          session: attackCheck.critic.session || null,
          model: attackCheck.critic.model || null,
          family: attackCheck.family,
          level: attackCheck.level,
          findings: attackCheck.summary,
          attestation: 'declared',
        }
      : null,
    releaseReady,
    notes: argv.note ? String(argv.note) : '',
  };

  const taskRel = relPosix(repo, taskDir);
  const acceptanceRel = taskRel + '/acceptance.json';
  const artifacts = ['red.json', 'red.log', 'verify.json', 'verify.log', 'report.md']
    .map((name) => taskRel + '/' + name)
    .filter((file) => exists(path.join(repo, file)));
  const candidatePaths = [...new Set([
    ...(Array.isArray(verify.changedPaths) ? verify.changedPaths : []),
    ...artifacts,
  ])].filter((file) => file !== acceptanceRel);
  const ignored = ignoredPaths(repo, candidatePaths);
  const candidateFiles = candidatePaths.filter((file) => !ignored.has(file));
  const candidate = createCandidate(
    repo,
    candidateFiles,
    'task ' + meta.id + ': accepted candidate; criteria=' + lockCheck.expected.criteriaJsonSha256 + '; contract=' + contractCommit + '; verify=' + (acceptorRun.nonce || 'reused'),
  );
  body.candidateCommit = candidate.commit;
  body.tree = candidate.tree;

  const record = signRecord(body, { privateKeyPem, keyId });
  writeJson(files.acceptance, record);

  if (argv.json) {
    console.log(JSON.stringify(record, null, 2));
  } else {
    console.log('task-accept: ' + meta.id + ' принят');
    console.log('  acceptor      ' + acceptor + ' (' + entry.kind + ')');
    console.log('  actor         ' + actor.kind + ' / ' + (actor.session || '—') + ' [' + actor.attestedBy + ']');
    console.log('  independence  ' + independence.level + ' (нужно ' + independence.required + ')');
    console.log('  key           ' + keyId);
    console.log('  fresh run     ' + (acceptorRun.fresh ? 'да (' + acceptorRun.nonce + ')' : 'нет (reused)'));
    console.log('  decisions     ' + decisionSummary.count + ' (assumed: ' + (decisionSummary.assumed.join(', ') || 'нет') + ')');
    console.log('  attack        ' + (attackCheck ? attackCheck.summary.total + ' находок, blocking ' + attackCheck.summary.blocking + ', без решения ' + attackCheck.summary.unresolved : 'нет'));
    console.log('  model level   ' + actorModelLevel);
    console.log('  releaseReady  ' + releaseReady + (decisionSummary.assumed.length ? ' — есть решения без подтверждения' : ''));
    console.log('  contract      ' + contractCommit);
    console.log('  candidate     ' + candidate.commit);
    console.log('  tree          ' + candidate.tree);
    console.log('  acceptance    ' + files.acceptance);
    console.log('');
    console.log('Финализация (дерево кода остаётся деревом кандидата):');
    console.log('  git reset --hard ' + candidate.commit + '   # рабочее дерево уже равно кандидату');
    console.log('  git add ' + acceptanceRel);
    console.log('  git commit -m "task ' + meta.id + ': приёмка (metadata)"');
    console.log('Проверка записи: node scripts/task-check-acceptance.mjs --file ' + acceptanceRel + ' --repo .');
  }
} catch (err) {
  if (argv.json) console.log(JSON.stringify({ ok: false, errors: [err.message] }, null, 2));
  else console.error('task-accept: ' + err.message);
  process.exit(err.exitCode || 1);
}
