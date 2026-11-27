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
  attributionGap, nodeConsistency, formatGateRow, formatGateSummary,
  summarizeDecisions, evaluateEffects, gateRecord, gateCriteriaOf, gateJournalFile, appendGateRecord,
  headCommit, acceptanceRepeatGuard, acceptanceNotes,
  worktreeSnapshot, finalizationLines,
} from './lib/common.mjs';
import { policyOf, applyLevel, modelLevel, familyOf } from './lib/policy.mjs';
import { sessionModelFact } from './lib/session-model.mjs';
import {
  findAcceptorLaunch,
  findLaunchByRun,
  modelVerdict,
  policyEnforced,
  acceptorModelDeclaration,
} from './lib/launch-evidence.mjs';
import { reportReadGuard, reportReadRecord, actorModel } from './lib/acceptance-policy.mjs';
import { evaluateAttack } from './lib/attack.mjs';
import { detectActor, assessIndependence } from './actor.mjs';
import { convertToWorkspace } from './facts-convert.mjs';
import { evaluateWorkspaceTask, loadAcceptors as loadEngineAcceptors } from '../engine.mjs';
import { signRecord, loadAcceptors, publicKeyFingerprint } from './sign.mjs';
import { pickAcceptorEntry } from './lib/accept-key.mjs';
import { validateReview } from './lib/review.mjs';
import { validateReviewReceipt } from './lib/review-receipt.mjs';
import { setProgressContext, writeProgress, fail } from './lib/accept/progress.mjs';
import { gateHasAccept, createCandidate } from './lib/accept/candidate.mjs';
import { validateVerify, backupExecutorVerify } from './lib/accept/validate.mjs';
import { engineShadow } from './lib/accept/shadow.mjs';
import { printAcceptance } from './lib/accept/summary.mjs';

const argv = parseArgv(process.argv.slice(2));
if (argv.help) {
  console.log('Usage: node task-accept.mjs --task <dir> --key <private.pem> --key-id <keyId> [--repo <dir>]');
  console.log('       [--acceptor <name>] [--human <who>] [--expect-contract <sha>] [--note <text>]');
  console.log('       [--node <узел>] [--deviation "<причина>"]');
  console.log('       [--allow-missing-red] [--allow-manual] [--allow-declared-actor]');
  console.log('       [--review <review.json>] [--reuse-verify] [--report-read] [--report-read-reason <text>]');
  console.log('       [--dry-run] [--force] [--allow-extras] [--rework "<почему повторная приёмка>"] [--json]');
  console.log('Запись подписывается Ed25519; для high-risk нужен ключ human-* и --human <кто>.');
  process.exit(0);
}

const taskDir = path.resolve(argv.task || argv._[0] || '.');
const repo = path.resolve(argv.repo || repoRoot(taskDir));
setProgressContext(repo, taskDir);
const config = loadConfig(repo);
/*
 * 2.6.82: закрытое без приёмки задание принять нельзя. closure.json — это
 * окончательный отказ от приёмки; переоткрытие идёт новым id, а не приёмкой
 * старого каталога.
 */
if (exists(path.join(taskDir, 'closure.json'))) {
  fail('задание закрыто без приёмки (closure.json): приёмка не применяется — закрытие окончательное, переоткрытие новым id');
}
writeProgress('start');

backupExecutorVerify(taskDir);

const logsCommitted = config.logs === 'commit';
const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const VERIFY_SCRIPT = path.join(SCRIPT_DIR, 'task-verify.mjs');
/*
 * 0045 (WC-12): критерии гоняются пулом — runCriteria в lib/common.mjs, степень
 * параллелизма WF_CRITERIA_PARALLEL (по умолчанию 4, 1 — последовательно).
 * Приёмщик своего цикла по критериям не держит: свежий прогон — это task-verify,
 * где критерии запускает runCriteria, и переменная окружения наследуется вместе
 * с process.env. Второй цикл здесь означал бы второй формат вывода и второй
 * вердикт — приёмка проверяет ровно тот прогон, который прошли ворота.
 */


/*
 * 0154: кандидат не должен терять ОТСЛЕЖИВАЕМЫЙ путь, попавший под правило
 * .gitignore. Дефект из письма structure--241 (задача 0352): удаление
 * `structure/graph.json` было объявлено контрактом и лежало в
 * verify.changedPaths, но путь под правилом `/structure/` отбрасывался —
 * `git check-ignore` отвечает и на отслеживаемый файл. Кандидат собирался без
 * него, и read-tree HEAD возвращал старую версию файла.
 *
 * Отбрасываем только НЕотслеживаемые игнорируемые пути: они и есть мусор
 * рабочего дерева. Принцип «кандидат несёт только пути контракта» не меняется —
 * фильтр список не расширяет, он лишь перестаёт выкидывать объявленное.
 */
export function ignoredPaths(repoRoot, paths) {
  if (paths.length === 0) return new Set();
  const r = runSync('git ls-files --others --ignored --exclude-standard -- ' + paths.map(quoteArg).join(' '), { cwd: repoRoot });
  if (r.exitCode !== 0) fail('git ls-files --others --ignored: ' + r.stderr.trim());
  return new Set(r.stdout.split(/\r?\n/).filter(Boolean));
}


try {
  /* 0135 (2.6.109): HEAD на входе приёмки — часть снимка worktree в записи. */
  const headBefore = headCommit(repo);
  const { files, taskMd, meta, criteria } = readTask(taskDir);
  /*
   * 0119 (WC-79): доказательство приёмки теперь лежит в кандидатном коммите
   * (строка accept в gates.jsonl). Если acceptance.json утерян — reset --hard,
   * clean, смена ветки — повторная приёмка не должна упираться в замок: строка
   * в журнале сама доказывает, что задание принимали. Запись восстанавливается.
   */
  const restoredAcceptance = !exists(files.acceptance) && gateHasAccept(taskDir, meta.id);
  const lockCheck = verifyLock(repo, taskDir, meta, taskMd, criteria, restoredAcceptance ? { acceptedTolerant: true } : {});
  if (!lockCheck.ok) {
    for (const e of lockCheck.errors) console.error('task-accept: lock: ' + e);
    process.exit(1);
  }
  const contractCommit = lockCheck.expected.contractCommit;
  /* 0170: локальная задача (vcs=none) — без коммита-кандидата; запись честно говорит, чего нет. */
  const localVcs = String(meta.vcs || '') === 'none';
  if (localVcs && (contractCommit === null || contractCommit === undefined) === false) fail('vcs=none: контракт ссылается на коммит ' + contractCommit + ' — локальный режим без VCS');
  if (localVcs && !argv.note) fail('vcs=none: приёмка без git требует --note с причиной (запись не притворяется коммитом)');
  if (argv['expect-contract'] && String(argv['expect-contract']) !== contractCommit) {
    fail('контрактный коммит ' + contractCommit + ' не совпадает с ожидаемым ' + argv['expect-contract'] + ': задание выдавалось на другом контракте');
  }

  const acceptor = String(argv.acceptor || meta.acceptor || '');
  if (!acceptor) fail('не указан acceptor (--acceptor или TASK-META.acceptor)');
  if (acceptor === meta.executor) fail('acceptor не может совпадать с executor');

  /*
   * 0070 (WC-45): узел в записи — доказательство, а не намерение контракта.
   * Источники только два: --node и WF_ACTOR_NODE. acceptorNode из TASK-META —
   * объявление, и подставлять его в запись нельзя: после отказа узла judge
   * запись 0069 утверждала приёмку узлом, которого не было. Объявление
   * сверяется с записью отдельно — nodeConsistency(meta, record).
   * Пустая строка узлом не считается.
   */
  const suppliedNode = typeof argv.node === 'string' ? argv.node.trim() : '';
  const envNode = typeof process.env.WF_ACTOR_NODE === 'string' ? process.env.WF_ACTOR_NODE.trim() : '';
  const actorNode = suppliedNode || envNode;
  if (actorNode !== '' && !/^[a-z][a-z0-9-]*$/.test(actorNode)) {
    fail('узел "' + actorNode + '" не соответствует шаблону ^[a-z][a-z0-9-]*$: используйте имя узла структуры, например judge');
  }
  const deviation = typeof argv.deviation === 'string' ? argv.deviation.trim() : '';
  if (deviation !== '' && deviation.length < 10) {
    fail('--deviation: причина короче 10 символов — объяснение отсутствия узла должно быть содержательным');
  }
  /*
   * Отказ без узла и без объяснения — до прогона критериев и до подписи:
   * medium/high не должны оставлять запись, которую потом примут за
   * доказательство; warn (low или deviation) печатается в stdout.
   */
  const attribution = attributionGap({ risk: meta.risk, actor: { node: actorNode }, deviation });
  if (attribution && attribution.level === 'error') fail('attribution: ' + attribution.message);
  if (attribution && attribution.level === 'warn') console.log('task-accept: WARN ' + attribution.message);

  const keyId = String(argv['key-id'] || '');
  const keyFile = argv.key ? path.resolve(String(argv.key)) : '';
  if (!keyId || !keyFile) fail('нужны --key <private.pem> и --key-id <keyId>: запись подписывается Ed25519');
  if (!exists(keyFile)) fail('нет файла ключа: ' + keyFile);
  const keysFile = path.resolve(String(argv.keys || config.keysFile));
  if (!exists(keysFile)) fail('нет acceptors.json: ' + keysFile);
  /*
   * 0081: запись выбирается по окну activeFrom/retiredAt (sign.mjs), а не «первая
   * по keyId». Иначе после ротации подпись действующим ключом падала на retired-
   * записи с утерянным приватным ключом, и приходилось чистить acceptors.json.
   */
  const picked = pickAcceptorEntry(loadAcceptors(keysFile), keyId);
  const entry = picked.entry;
  if (!entry) fail('ключ ' + keyId + ' не закреплён в ' + keysFile);
  if (picked.legacy) console.log('task-accept: WARN ключ ' + keyId + ' — ' + (picked.reason || 'retired-эпоха') + '; действует retired-запись');
  if (entry.revokedAt) fail('ключ ' + keyId + ' отозван ' + entry.revokedAt);
  const privateKeyPem = fs.readFileSync(keyFile, 'utf8');
  const derivedPublic = crypto.createPublicKey(privateKeyPem).export({ type: 'spki', format: 'pem' }).toString();
  if (publicKeyFingerprint(derivedPublic) !== publicKeyFingerprint(entry.publicKeyPem)) {
    fail('приватный ключ не соответствует закреплённому публичному ключу ' + keyId);
  }

  /*
   * Актор — по цепочке источников из конфига (2.6.0): DSH не обязателен, но и
   * ci/manual не дают separate-session — вид источника решает, чем подтверждена
   * сессия. Битый actor.sources закрывает ворота: приёмка не должна угадывать.
   */
  const actorSourceErrors = Array.isArray(config.actor.errors) ? config.actor.errors : [];
  if (actorSourceErrors.length > 0) fail('actor.sources: ' + actorSourceErrors.join('; '));
  const actor = detectActor(process.env, { ...config.actor, kind: entry.kind, host: os.hostname() });
  /*
   * 0084 (2.6.38): приёмка в объявленной структуре требует свидетельства запуска.
   * childId записи сравнивается с DSH_SESSION_ID приёмщика — argv и --node его
   * подделать не могут. Нет записи — отказ, а не «unknown».
   */
  const acceptorNode = typeof meta.acceptorNode === 'string' ? meta.acceptorNode.trim() : '';
  const runArg = typeof argv.run === 'string' ? argv.run.trim() : '';
  let launchRecord = null;
  let acceptorInfo = null;
  /*
   * 0087 (2.6.41): свидетельство включается и явным --run, даже если узел в
   * TASK-META не объявлен: приёмщик мог получить runId в задании. Сверка та же —
   * childId записи обязан совпасть с сессией приёмщика.
   */
  const evidenceWanted = acceptorNode !== '' || runArg !== '';
  if (evidenceWanted) {
    const evidence = acceptorNode !== ''
      ? findAcceptorLaunch({ root: repo, sessionId: actor.session, node: acceptorNode, runId: runArg })
      : findLaunchByRun({ root: repo, runId: runArg, sessionId: actor.session });
    if (!evidence.ok) fail(evidence.code + ': ' + evidence.message);
    launchRecord = evidence.record;
    if (acceptorNode !== '' && actorNode !== '' && actorNode !== launchRecord.node) {
      fail('node-declared-only: --node ' + actorNode + ' не совпадает с записью запуска (узел ' + launchRecord.node + ')');
    }
    const declared = acceptorModelDeclaration(repo, launchRecord.node);
    const verdict = modelVerdict(launchRecord, declared);
    acceptorInfo = {
      node: launchRecord.node,
      sessionId: launchRecord.childId,
      runId: launchRecord.runId,
      model: launchRecord.model || null,
      declaredModel: declared.model || null,
      verdict,
      source: 'launch-record',
    };
    if (verdict === 'mismatch') {
      fail('acceptor-model-mismatch: узел ' + launchRecord.node + ' объявлен как ' + declared.model
        + ', а запущен с ' + (launchRecord.model || '(нет модели)'));
    }
  }
  const enforcement = policyEnforced(config, repo);
  if (!enforcement.ok) fail(enforcement.code + ': ' + enforcement.message);
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
   * 0049: независимость приёмки проверяется до прогона критериев и до подписи.
   * При risk=medium/high чтение отчёта исполнителя — исключение, и оно должно
   * быть названо: причина пустая — отказ с рецептом, а не молчаливое «прочитал».
   */
  const reportReadReason = typeof argv['report-read-reason'] === 'string' ? argv['report-read-reason'].trim() : '';
  const reportReadDenied = reportReadGuard({
    risk: meta.risk,
    reportRead: Boolean(argv['report-read']),
    reason: reportReadReason,
  });
  if (reportReadDenied) {
    console.error('task-accept: ' + reportReadDenied.error);
    console.error('  fix: ' + reportReadDenied.fix);
    process.exit(1);
  }

  /*
   * 0053: reportWithheld (0049) — не доказательство чтения, а отсутствие флага.
   * Доказать чтение по сессии приёмщика task-accept не может, поэтому в запись
   * идёт честная пара: reportRead = declared|not-declared и
   * reportReadVerified = false (доказательства нет), причина — рядом.
   * reportWithheld остаётся для совместимости потребителей (plugin/lib/state.js).
   */
  const reportReadProof = reportReadRecord({
    reportRead: Boolean(argv['report-read']),
    reason: reportReadReason,
  });

  /*
   * 0049: в записи — фактическая модель актора, а не «unknown» по умолчанию.
   * Цепочка actorModel: DSH_MODEL → config.actor.model → unknown; последним
   * шагом берётся модель, которую уже определил detectActor по actor.modelSources
   * (обёртка проекта/legacy modelEnv) — известную модель запись не обедняет.
   */
  const factualActorModel = actorModel(config.actor || {}, process.env);
  /*
   * 0084: модель приёмщика — из записи запуска (свидетельство раннера), а не из
   * env ребёнка; env остаётся резервом для легаси-проектов без structure.
   */
  /*
   * 0100 (WC-25): модель приёмщика — по факту харнесса, а не по env. Порядок:
   * запись запуска (план того, кто запустил) → проекция сессии (lastUsed, пишет
   * харнесс) → env → actor.model → unknown. Источник пишется в запись, чтобы
   * «unknown» больше не означал «никто не знает» без объяснения.
   */
  const launchModel = launchRecord && typeof launchRecord.model === 'string' ? launchRecord.model.trim() : '';
  const sessionModel = launchModel === '' ? sessionModelFact(actor.session) : null;
  const recordActorModel = launchModel !== ''
    ? launchModel
    : (sessionModel && sessionModel.model
      ? sessionModel.model
      : (factualActorModel !== 'unknown' ? factualActorModel : actor.model));
  const recordModelSource = launchModel !== ''
    ? 'launch-record'
    : (sessionModel && sessionModel.model ? 'session-projcache'
      : (factualActorModel !== 'unknown' ? 'env' : (actor.model !== 'unknown' ? 'actor' : 'unknown')));

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

  const actorModelLevel = issuedBy && issuedBy.model ? modelLevel(config, issuedBy.model, recordActorModel) : 'unknown';
  const rolesApplied = applyLevel(
    gatePolicy.roles.modelFamily,
    actorModelLevel === 'same-family' ? ['приёмщик той же модели/семейства, что постановщик (' + recordActorModel + ')'] : [],
  );
  if (rolesApplied.errors.length) fail('роли: ' + rolesApplied.errors.join('; '));
  for (const warning of rolesApplied.warnings) console.warn('task-accept: WARN ' + warning);
  /*
   * 0124 (2.6.105): повторная приёмка того же контракта — только с причиной.
   * Замер structure: 16 лишних прогонов review/accept. Теперь повтор без причины
   * отказывает и называет --rework, а причина переделки попадает в notes записи;
   * --force остаётся аварийным обходом.
   */
  let reworkReason = '';
  if (exists(files.acceptance)) {
    const previousAcceptance = readJson(files.acceptance);
    const repeat = acceptanceRepeatGuard(previousAcceptance, contractCommit, { rework: argv.rework, force: argv.force === true });
    if (repeat.action === 'refuse') {
      fail('задание уже принято по контракту ' + String(contractCommit).slice(0, 12)
        + '; повторная приёмка — только с --rework "<почему переделка>" (попадёт в notes записи) или с новым контрактом');
    }
    if (repeat.action === 'rework') reworkReason = repeat.rework;
  }

  if (argv['dry-run']) {
    if (!exists(files.verify)) fail('dry-run: нет verify.json; сначала выполните task-verify');
    const verify = readJson(files.verify);
    validateVerify(verify, lockCheck, contractCommit, null);
    const digest = computeWorktreeDigest(repo, taskDir, meta);
    if (digest !== verify.worktreeDigest) fail('дерево изменилось после verify (digest не совпадает)');
    console.log(JSON.stringify({
      dryRun: true,
      note: 'проверки не перезапускались',
      actor: { kind: actor.kind, session: actor.session, attestedBy: actor.attestedBy, source: actor.source, sourceKind: actor.sourceKind, keyId, node: actorNode || null },
      independence: {
        level: independence.level,
        basis: independence.basis,
        separateSession: independence.level !== 'same-session',
        reportWithheld: !argv['report-read'],
        ...reportReadProof,
        keyCustody: entry.kind === 'human' ? 'human-key' : 'agent-key',
      },
      acceptance: {
        version: 6, status: 'accepted', task: String(meta.id), candidateCommit: null, tree: null, worktreeDigest: digest,
        decisions: { count: decisionSummary.count, digest: decisionSummary.digest, assumed: decisionSummary.assumed, confirmed: decisionSummary.confirmed },
        attack: attackCheck
          ? { present: true, sha256: sha256File(attackFile), session: attackCheck.critic.session || null, model: attackCheck.critic.model || null, family: attackCheck.family, level: attackCheck.level, findings: attackCheck.summary, attestation: 'declared' }
          : null,
        actor: { model: recordActorModel, family: familyOf(config, recordActorModel) },
        independence: { level: independence.level, modelLevel: actorModelLevel },
        acceptor: acceptorInfo,
        releaseReady: decisionSummary.assumed.length === 0 && (!attackCheck || attackCheck.summary.unresolved === 0),
        acceptor, deviation: deviation || null, humanSignoff: Boolean(requiresHuman && humanSigner), signedBy: humanSigner,
      },
    }, null, 2));
    process.exit(0);
  }

  /*
   * Preflight обходов (0011, F-3): то, что видно из аргументов, проверяется
   * ДО прогона критериев. Иначе забытый --note или несуществующий --review
   * стоят полного прогона (у Playwright — минуты), а отказ приходит уже после
   * него. Проверки после прогона ниже остаются в силе: preflight только
   * отказывает раньше и не заменяет защиту по фактически активным обходам.
   */
  const requestedBypasses = [
    ['allow-missing-red', '--allow-missing-red'],
    ['allow-manual', '--allow-manual'],
    ['allow-declared-actor', '--allow-declared-actor'],
    ['reuse-verify', '--reuse-verify'],
  ].filter(([key]) => argv[key]).map(([, flag]) => flag);
  if (requestedBypasses.length > 0 && !argv.note) {
    fail('обход (' + requestedBypasses.join(', ') + ') требует --note с причиной; проверка идёт до прогона критериев');
  }
  if (argv.review && !exists(path.resolve(String(argv.review)))) {
    fail('нет файла review: ' + path.resolve(String(argv.review)) + '; проверка идёт до прогона критериев');
  }

  let verify;
  let acceptorRun;
  const fresh = !argv['reuse-verify'];
  writeProgress('preflight-ok');

  if (fresh) {
    writeProgress('verify');
    /*
     * 0130 (2.6.107): прогон приёмки идёт минутами, а stdout до конца пуст — при
     * зависании (0127: 13 минут) снаружи не видно, что вообще происходит. Печатаем
     * старт с таймаутом: число строк в журнале сторожа даёт понять, где встали.
     */
    console.log('task-accept: свежий прогон verify (таймаут '
      + Math.round((Number(process.env.TASK_VERIFY_TIMEOUT_MS) || config.verifyTimeoutMs) / 1000) + ' с)');
    const nonce = crypto.randomBytes(16).toString('hex');
    const args = [VERIFY_SCRIPT, '--task', taskDir, '--repo', repo, '--json'];
    /* 0170: локальная задача не доказывает красный — флаг передаётся сам, но обход виден в записи. */
    if (argv['allow-missing-red'] || localVcs) args.push('--allow-missing-red');
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
    writeProgress('verify-ok', { nonce });
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
  /* 0110 (2.6.98): после verify разрешены только чужие коммиты; их видно в headDrift. */
  /* 0170: в локальном режиме HEAD нет — дрейф не проверяется (VCS-гейт). */
  if (!localVcs && verify.headAtVerify && headCommit(repo) !== verify.headAtVerify) {
    fail('HEAD изменился после verify (' + String(verify.headAtVerify).slice(0, 12) + ' -> ' + String(headCommit(repo)).slice(0, 12) + '); перезапустите task-verify');
  }

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
  let reviewReceipt = null;
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
  /*
   * 0092 (2.6.90): квитанция ревью. Объявлен reviewer/reviewerNode — без
   * review.receipt.json (artifactSha256 = sha256(review.json), тот же ревьюер,
   * decision=accept) приёмки нет. Не объявлен — not-applicable.
   */
  const receiptCheck = validateReviewReceipt({
    taskDir,
    meta,
    review,
    reviewPath: argv.review ? path.resolve(String(argv.review)) : null,
  });
  if (receiptCheck.applicable && !receiptCheck.ok) {
    for (const problem of receiptCheck.problems) console.error('task-accept: квитанция: ' + problem);
    process.exit(1);
  }
  reviewReceipt = receiptCheck.receipt;

  /*
   * 0102 (2.6.94): review обязан быть привязан к контракту. Иначе «добро» дано
   * на другую редакцию task.md, и приёмка это не видит (случай structure 0331).
   * Отсутствие обоих полей — отказ; обход только осознанным флагом и виден в
   * acceptance.reviewBinding.
   */
  const reviewBinding = {
    contractCommit,
    taskFileSha256: lockCheck.expected.taskFileSha256,
    bound: false,
    allowedBy: null,
    note: null,
  };
  if (review) {
    const reviewContract = review.contractCommit === undefined || review.contractCommit === null ? null : String(review.contractCommit);
    const reviewTaskSha = review.taskFileSha256 === undefined || review.taskFileSha256 === null ? null : String(review.taskFileSha256);
    if (reviewContract === null && reviewTaskSha === null) {
      if (!argv['allow-unbound-review']) {
        fail('review без привязки к контракту: нет review.contractCommit и review.taskFileSha256; перевыпустите review или укажите --allow-unbound-review --note <причина>');
      }
      if (!argv.note) fail('--allow-unbound-review требует --note с причиной');
      reviewBinding.allowedBy = 'flag';
      reviewBinding.note = String(argv.note);
    } else {
      if (reviewContract !== null && reviewContract !== contractCommit) {
        fail('review.contractCommit ' + reviewContract + ' не совпадает с контрактом ' + contractCommit + ': review выпущен на другую редакцию');
      }
      if (reviewTaskSha !== null && reviewTaskSha !== lockCheck.expected.taskFileSha256) {
        fail('review.taskFileSha256 не совпадает с task.md контракта: review выпущен на другую редакцию task.md');
      }
      reviewBinding.bound = true;
    }
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
    baseCommit: localVcs ? null : contractCommit,
    candidateCommit: null,
    tree: null,
    worktreeDigest: digest,
    issuedBy: issuedBy || { kind: 'agent', session: null },
    actor: {
      kind: actor.kind,
      session: actor.session,
      model: recordActorModel,
      /* 0100: откуда модель — launch-record | session-projcache | env | actor | unknown. */
      modelSource: recordModelSource,
      family: familyOf(config, recordActorModel),
      host: actor.host,
      keyId,
      attestedBy: actor.attestedBy,
      source: actor.source,
      sourceKind: actor.sourceKind,
      ...(actorNode !== '' ? { node: actorNode } : {}),
    },
    independence: {
      level: independence.level,
      basis: independence.basis,
      separateSession: independence.level === 'separate-session' || independence.level === 'human',
      /* Совместимость: смысл поля — «флага не было», а не «чтение опровергнуто». */
      reportWithheld: !argv['report-read'],
      ...reportReadProof,
      keyCustody: entry.kind === 'human' ? 'human-key' : 'agent-key',
      /*
       * modelLevel — независимость по семействам моделей (config.models), а не
       * сверка с записью запуска: узкий смысл, чтобы «unknown» не читался как
       * отказ контракта. Сверка приёмщика — в acceptor.
       */
      modelLevel: actorModelLevel,
    },
    /* 0087: свидетельство запуска отдельным блоком — видно, откуда модель. */
    acceptor: acceptorInfo,
    acceptorRun,
    effects: effectCheck.effects,
    effectsRequired: effectCheck.required,
    effectConsistency: {
      checked: effectCheck.checked,
      ok: effectCheck.consistencyIssues.length === 0,
      mode: gatePolicy.decisions,
      links: effectCheck.links,
    },
    bypasses,
    red: red
      ? {
          kind: red.redKind || 'proven',
          noRed: red.noRed || null,
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
    reviewReceipt,
    reviewBinding,
    headDrift: verify.headDrift || null,
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
    notes: acceptanceNotes(argv.note, reworkReason),
    ...(deviation !== '' ? { deviation } : {}),
  };

  /*
   * 0070 (WC-45): сверка объявленного узла с записью — между сборкой актора и
   * подписью. warn печатается строкой в stdout и exit не меняет: расхождение
   * должно быть видно приёмщику, но объяснимое отсутствие узла (deviation)
   * вердиктом не является. Отказ за отсутствие узла при risk medium/high
   * по-прежнему даёт attributionGap выше.
   */
  const nodeVerdict = nodeConsistency(meta, body);
  if (nodeVerdict && nodeVerdict.level === 'warn') console.log('task-accept: WARN ' + nodeVerdict.message);

  const taskRel = relPosix(repo, taskDir);
  const acceptanceRel = taskRel + '/acceptance.json';
  const artifacts = ['red.json', 'red.log', 'verify.json', 'verify.log', 'report.md']
    .map((name) => taskRel + '/' + name)
    .filter((file) => exists(path.join(repo, file)));
  const gatesRel = taskRel + '/gates.jsonl';
  const candidatePaths = [...new Set([
    ...(Array.isArray(verify.changedPaths) ? verify.changedPaths : []),
    ...artifacts,
    gatesRel,
  ])].filter((file) => file !== acceptanceRel);
  /* 0170: без git игнорируемых путей не бывает — кандидата-коммита тоже нет. */
  const ignored = localVcs ? new Set() : ignoredPaths(repo, candidatePaths);
  const candidateFiles = candidatePaths.filter((file) => !ignored.has(file));
  /*
   * 0135 (2.6.109): до подписи записи — снимок дерева. reset --hard уничтожит
   * только незакоммиченные правки ОТСЛЕЖИВАЕМЫХ файлов вне кандидата; untracked и
   * удалённые он не теряет. Правки чужой задачи в кандидата не входят — это отказ
   * accept-foreign-worktree с названными путями (случай INCIDENT-GIT-REBASE-ANSWER).
   * Обход --allow-extras пишется в bypasses и notes, чтобы CI/аудит его видел.
   */
  let extrasNote = '';
  /* 0170: без VCS снимок git не нужен: кандидат — digest дерева, а не набор путей. */
  const worktree = localVcs ? { extras: [], stashes: [], local: true } : worktreeSnapshot(repo, { keep: candidateFiles, ignored, headBefore });
  if (worktree.extras.length > 0) {
    const extrasList = worktree.extras.join(', ');
    if (!argv['allow-extras']) {
      fail('accept-foreign-worktree: ' + worktree.extras.length
        + ' незакоммиченных отслеживаемых правок вне кандидата (reset --hard их уничтожит): ' + extrasList
        + '; аварийный обход — --allow-extras --note "<причина>" (попадёт в bypasses и notes записи)');
    }
    bypasses.allowExtras = true;
    extrasNote = 'allow-extras: ' + extrasList;
  }
  /*
   * 0135 (2.6.109): стэш движок не создаёт и не видит, кто его создал. Врать
   * «дерево чистое» нельзя — печатаем предупреждение и пишем снимок в запись.
   */
  if (worktree.stashes.length > 0) {
    console.log('task-accept: WARN в репозитории есть стэш (' + worktree.stashes.length + '): '
      + worktree.stashes.join('; ') + ' — движок не видит, кто его создал; проверьте, что стэш не чужой');
  }
  body.worktree = worktree;
  if (extrasNote !== '') {
    body.notes = acceptanceNotes(argv.note ? String(argv.note) + '; ' + extrasNote : extrasNote, reworkReason);
  }
  /*
   * 0011: запись текущего задания передаётся в кандидат явно — createCandidate
   * удаляет её из индекса после read-tree HEAD, чтобы metadata-коммит не
   * наследовался кандидатом. Записи других заданий не затрагиваются.
   */
  /*
   * 0119 (WC-79): строка accept пишется ДО кандидата и входит в него. Раньше она
   * оставалась вне коммита и исчезала после reset --hard (случай 0133 в
   * ws-school-app). Ложное «принято» без кандидата закрывается отзывом: при сбое
   * создания кандидата в журнал дописывается строка void.
   */
  writeProgress('candidate');
  const journalPending = appendGateRecord(gateJournalFile(taskDir), gateRecord({
    kind: 'accept',
    task: String(meta.id),
    head: verify.headSha || contractCommit,
    criteria: gateCriteriaOf(verify.results || []),
    verdict: 'accepted',
    bypasses,
    exitSummary: 'exit=0; accepted; checks=' + ((verify.results || []).length) + '; releaseReady=' + releaseReady,
  }));
  if (!journalPending.ok) console.log('WARN журнал ворот: ' + journalPending.error);
  let candidate;
  if (localVcs) {
    /* 0170: кандидат-коммит не создаётся; запись ссылается на digest дерева, а не на SHA. */
    candidate = { commit: null, tree: null };
  } else try {
    candidate = createCandidate(
      repo,
      candidateFiles,
    'task ' + meta.id + ': accepted candidate; criteria=' + lockCheck.expected.criteriaJsonSha256 + '; contract=' + contractCommit + '; verify=' + (acceptorRun.nonce || 'reused'),
      [acceptanceRel],
    );
  } catch (error) {
    /* Кандидата нет — строка accept не должна оставаться доказательством: отзываем её. */
    appendGateRecord(gateJournalFile(taskDir), gateRecord({
      kind: 'accept',
      task: String(meta.id),
      head: verify.headSha || contractCommit,
      criteria: [],
      verdict: 'void',
      bypasses,
      exitSummary: 'void: кандидат не создан — ' + (error && error.message ? String(error.message).slice(0, 200) : 'сбой'),
    }));
    throw error;
  }
  body.candidateCommit = candidate.commit;
  body.tree = candidate.tree;
  if (localVcs) {
    body.vcs = 'none';
    body.worktreeDigest = digest;
  }

  const record = signRecord(body, { privateKeyPem, keyId });
  writeJson(files.acceptance, record);
  writeProgress('accepted', { candidate: candidate.commit, keyId });
  engineShadow(repo, taskDir, meta, record);

  /*
   * 0052 (WC-30, замечание приёмщика 0051): строка accept в gates.jsonl пишется
   * ПОСЛЕ сборки кандидата и после подписи записи. Пока она писалась раньше,
   * сбой createCandidate оставлял в журнале «принято» без кандидата — ложный
   * accepted. Размен: после reset --hard кандидата последняя строка журнала не
   * восстанавливается (файл попадает в индекс до записи); это принято — журнал
   * не должен утверждать то, чего нет. Критерии — из свежего прогона приёмщика.
   * Сбой журнала не валит приёмку: WARN, exit прежний.
   */
  if (!journalPending.ok) {
    /* Строка не записалась до кандидата — доказательства в коммите нет; сообщаем явно. */
    console.log('WARN журнал ворот: строка accept не записана до кандидата (' + journalPending.error + ')');
  }

  printAcceptance({
    json: argv.json,
    record, meta, acceptor, entry, actorNode, deviation, actor, independence, keyId, acceptorRun,
    decisionSummary, attackCheck, recordActorModel, recordModelSource, actorModelLevel, acceptorInfo,
    releaseReady, contractCommit, candidate, localVcs, files, verify, repo, taskDir, SCRIPT_DIR,
    acceptanceRel, taskRel,
  });
} catch (err) {
  if (argv.json) console.log(JSON.stringify({ ok: false, errors: [err.message] }, null, 2));
  else console.error('task-accept: ' + err.message);
  process.exit(err.exitCode || 1);
}
