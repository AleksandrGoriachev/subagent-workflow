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
import { validateReview } from './lib/review.mjs';

const argv = parseArgv(process.argv.slice(2));
if (argv.help) {
  console.log('Usage: node task-accept.mjs --task <dir> --key <private.pem> --key-id <keyId> [--repo <dir>]');
  console.log('       [--acceptor <name>] [--human <who>] [--expect-contract <sha>] [--note <text>]');
  console.log('       [--node <узел>] [--deviation "<причина>"]');
  console.log('       [--allow-missing-red] [--allow-manual] [--allow-declared-actor]');
  console.log('       [--review <review.json>] [--reuse-verify] [--report-read] [--report-read-reason <text>]');
  console.log('       [--dry-run] [--force] [--json]');
  console.log('Запись подписывается Ed25519; для high-risk нужен ключ human-* и --human <кто>.');
  process.exit(0);
}

const taskDir = path.resolve(argv.task || argv._[0] || '.');
const repo = path.resolve(argv.repo || repoRoot(taskDir));
const config = loadConfig(repo);

/*
 * F-8 (2.6.4): verify.json исполнителя не теряется. Свежий прогон приёмщика
 * перезаписывает verify.json, поэтому прежний результат сохраняется рядом как
 * verify.executor.json — ДО preflight и до нового прогона. Отказ приёмки (нет
 * --note у обхода, нет ключа, чужой замок) не должен стирать доказательство
 * работы исполнителя: он единственный, кто видел зелёный прогон под своим
 * деревом. Нет verify.json — копию не создаём (пустой копии не существует).
 * Повторная приёмка копию обновляет: рядом всегда лежит то, что было до
 * текущего прогона.
 */
{
  const executorVerify = path.join(taskDir, 'verify.json');
  const savedExecutorVerify = path.join(taskDir, 'verify.executor.json');
  if (exists(executorVerify)) {
    try {
      fs.copyFileSync(executorVerify, savedExecutorVerify);
    } catch (err) {
      fail('не удалось сохранить verify.executor.json: ' + err.message);
    }
  }
}

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

/**
 * 0152 (P2a): теневой прогон движка ограничений. Ничего не блокирует и не меняет
 * вердикт: конвертирует задачу в факты, оценивает C1–C10 и записывает сравнение
 * с фактической приёмкой. Цель — статистика расхождений до переключения.
 * По умолчанию выключена (чужой воркспейс не трогаем).
 */
function engineShadow(repo, taskDir, meta, record) {
  /*
   * 0153: тень по умолчанию ВЫКЛЮЧЕНА. Приёмка живёт в чужих воркспейсах, и
   * молча создавать там docs/facts/ и engine-shadow.json нельзя. Включается
   * явно: WF_ENGINE_SHADOW=1 или "engineShadow": true в workflow.config.json.
   */
  const config = readJson(path.join(repo, 'docs', 'subagent-workflow', 'workflow.config.json')) || {};
  const enabled = String(process.env.WF_ENGINE_SHADOW || '') === '1' || config.engineShadow === true;
  if (!enabled) return;
  try {
    /*
     * 0158: если факты уже есть и цепь цела — не пересобираем. Пересборка с --force
     * стёрла бы подписанный sealed-факт (его не восстановить из источников), а для
     * теневого прогона достаточно прочитать существующую цепь.
     */
    const factsFile = path.join(repo, 'docs', 'facts', String(meta.id) + '.jsonl');
    const existing = fs.existsSync(factsFile) ? readFactFile(factsFile) : null;
    const converted = existing && existing.ok
      ? { ok: true, rows: existing.rows.length, signed: existing.rows.filter((row) => row.signature).length }
      : convertToWorkspace(taskDir, repo, { repoRoot: repo, force: true });
    if (!converted.ok) {
      writeJson(path.join(taskDir, 'engine-shadow.json'), { at: new Date().toISOString(), task: meta.id, status: 'not-checked', problems: converted.problems });
      console.log('engine (тень): не проверено — ' + (converted.problems || []).join('; '));
      return;
    }
    const result = evaluateWorkspaceTask(repo, meta.id, { acceptors: loadEngineAcceptors(repo) });
    const agree = String(record.status || 'accepted') === (result.verdict === 'accepted' ? 'accepted' : 'rejected');
    writeJson(path.join(taskDir, 'engine-shadow.json'), {
      at: new Date().toISOString(),
      task: meta.id,
      run: result.run,
      engineVerdict: result.verdict,
      acceptanceStatus: record.status || 'accepted',
      agree,
      report: result.report.map((item) => ({ id: item.id, status: item.status, detail: item.detail })),
    });
    console.log('engine (тень): ' + result.verdict + ' — ' + (agree ? 'совпадает с приёмкой' : 'РАСХОЖДЕНИЕ с приёмкой') + ' (' + result.passed + '/' + result.applicable + ')');
  } catch (error) {
    try { writeJson(path.join(taskDir, 'engine-shadow.json'), { at: new Date().toISOString(), task: meta.id, status: 'error', problem: String(error && error.message ? error.message : error) }); } catch { /* тень не ломает приёмку */ }
    console.log('engine (тень): ошибка — ' + String(error && error.message ? error.message : error));
  }
}
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

/*
 * Право исполнения — свойство поставки, а не настройка рабочей машины (2.5.2).
 *
 * `git add` берёт режим файла из рабочего дерева, а Windows его не хранит:
 * файл, помеченный 100755 в индексе, после `git add` снова становится 100644,
 * и принятое дерево расходится с проверенным. Поэтому режим читается из
 * РЕАЛЬНОГО индекса (`git ls-files -s` без GIT_INDEX_FILE) и переносится в
 * индекс кандидата тем же `--chmod=+x`. Содержимое кандидата не меняется —
 * только режим; путь, не помеченный в индексе исполняемым, остаётся 100644.
 */
function restoreExecutableModes(repoRoot, candidateEnv) {
  const real = runSync('git ls-files -s -z', { cwd: repoRoot, unsetEnv: ['GIT_INDEX_FILE'] });
  if (real.exitCode !== 0) fail('git ls-files -s (индекс репозитория): ' + real.stderr.trim());
  const executable = [];
  for (const entry of real.stdout.split('\0')) {
    const parsed = entry.match(/^(\d{6}) [0-9a-f]+ \d+\t(.+)$/s);
    if (parsed && parsed[1] === '100755') executable.push(parsed[2]);
  }
  if (executable.length === 0) return;
  const candidate = runSync('git ls-files -s -z', { cwd: repoRoot, env: candidateEnv });
  if (candidate.exitCode !== 0) fail('git ls-files -s (кандидат): ' + candidate.stderr.trim());
  const inCandidate = new Set();
  for (const entry of candidate.stdout.split('\0')) {
    const parsed = entry.match(/^\d{6} [0-9a-f]+ \d+\t(.+)$/s);
    if (parsed) inCandidate.add(parsed[1]);
  }
  const targets = executable.filter((file) => inCandidate.has(file));
  if (targets.length === 0) return;
  /* Порциями: список аргументов не должен упираться в предел командной строки. */
  for (let i = 0; i < targets.length; i += 50) {
    const batch = targets.slice(i, i + 50);
    const chmod = runSync('git update-index --chmod=+x -- ' + batch.map(quoteArg).join(' '), { cwd: repoRoot, env: candidateEnv });
    if (chmod.exitCode !== 0) fail('git update-index --chmod=+x: ' + chmod.stderr.trim());
  }
}

/** Есть ли в журнале строка accept по заданию (доказательство внутри кандидата). */
function gateHasAccept(taskDir, taskId) {
  try {
    const file = gateJournalFile(taskDir);
    if (!exists(file)) return false;
    return fs.readFileSync(file, 'utf8').split('\n').some((line) => {
      if (!line.trim()) return false;
      try {
        const row = JSON.parse(line);
        return row && row.kind === 'accept' && String(row.task) === String(taskId) && String(row.verdict) !== 'void';
      } catch {
        return false;
      }
    });
  } catch {
    return false;
  }
}

function createCandidate(repoRoot, filesToAdd, message, pathsToRemove = []) {
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
    /*
     * 0011 (F-1): кандидат не наследует ранее закоммиченную запись приёмки.
     * read-tree берёт дерево HEAD целиком, поэтому metadata-коммит с
     * acceptance.json попадал в кандидата и task-check-acceptance отказывал
     * «acceptance.json входит в кандидатный коммит». Путь приходит снаружи:
     * удаляется только запись текущего задания, записи других остаются частью
     * дерева. Если записи в индексе нет, --ignore-unmatch делает команду
     * успешной.
     */
    if (pathsToRemove.length > 0) {
      const remove = runSync('git rm --cached --ignore-unmatch -q -- ' + pathsToRemove.map(quoteArg).join(' '), { cwd: repoRoot, env });
      if (remove.exitCode !== 0) fail('git rm --cached: ' + remove.stderr.trim());
    }
    if (filesToAdd.length > 0) {
      const add = runSync('git add -A -- ' + filesToAdd.map(quoteArg).join(' '), { cwd: repoRoot, env });
      if (add.exitCode !== 0) fail('git add: ' + add.stderr.trim());
    }
    restoreExecutableModes(repoRoot, env);
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
  const entry = loadAcceptors(keysFile).find((item) => item.keyId === keyId);
  if (!entry) fail('ключ ' + keyId + ' не закреплён в ' + keysFile);
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
  const ignored = ignoredPaths(repo, candidatePaths);
  const candidateFiles = candidatePaths.filter((file) => !ignored.has(file));
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
  try {
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

  const record = signRecord(body, { privateKeyPem, keyId });
  writeJson(files.acceptance, record);
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

  if (argv.json) {
    console.log(JSON.stringify(record, null, 2));
  } else {
    console.log('task-accept: ' + meta.id + ' принят');
    console.log('  acceptor      ' + acceptor + ' (' + entry.kind + ')');
    console.log('  node          ' + (actorNode || (deviation ? '— (deviation)' : '—')));
    console.log('  actor         ' + actor.kind + ' / ' + (actor.session || '—') + ' [' + actor.attestedBy + ']'
      + (actor.source ? ' ' + actor.source + ' (' + actor.sourceKind + ')' : ''));
    console.log('  independence  ' + independence.level + ' (нужно ' + independence.required + ')');
    console.log('  key           ' + keyId);
    console.log('  fresh run     ' + (acceptorRun.fresh ? 'да (' + acceptorRun.nonce + ')' : 'нет (reused)'));
    console.log('  decisions     ' + decisionSummary.count + ' (assumed: ' + (decisionSummary.assumed.join(', ') || 'нет') + ')');
    console.log('  attack        ' + (attackCheck ? attackCheck.summary.total + ' находок, blocking ' + attackCheck.summary.blocking + ', без решения ' + attackCheck.summary.unresolved : 'нет'));
    console.log('  actor model   ' + recordActorModel + ' (' + recordModelSource + ')');
    console.log('  model level   ' + actorModelLevel
      + (actorModelLevel === 'unknown'
        ? ' (независимость: семейства моделей не объявлены в config.models; сверка приёмщика — строка acceptor)'
        : ''));
    console.log('  acceptor      ' + (acceptorInfo
      ? 'узел ' + acceptorInfo.node + ', run ' + acceptorInfo.runId + ', модель ' + (acceptorInfo.model || '—')
        + ' против ' + (acceptorInfo.declaredModel || '—') + ' → ' + acceptorInfo.verdict
      : 'свидетельства запуска нет (TASK-META.acceptorNode не объявлен и --run не передан)'));
    console.log('  releaseReady  ' + releaseReady + (decisionSummary.assumed.length ? ' — есть решения без подтверждения' : ''));
    console.log('  contract      ' + contractCommit);
    console.log('  candidate     ' + candidate.commit);
    console.log('  tree          ' + candidate.tree);
    console.log('  acceptance    ' + files.acceptance);
    console.log('');
    /* 0055: те же строки, что печатают ворота, — приёмщику не нужен повторный прогон. */
    for (const row of verify.results || []) console.log(formatGateRow(row));
    console.log(formatGateSummary(verify.results || []));
    console.log('');
    console.log('Финализация (дерево кода остаётся деревом кандидата):');
    console.log('  git reset --hard ' + candidate.commit + '   # рабочее дерево уже равно кандидату');
    /*
     * 0097 (WC-32): строка accept пишется в gates.jsonl уже после сборки
     * кандидата, поэтому reset --hard её выбрасывает, если не добавить файл в
     * индекс. Печатаем оба пути — иначе журнал молча теряет приёмку.
     */
    const gateRel = relPosix(repo, path.join(taskDir, 'gates.jsonl'));
    console.log('  git add ' + acceptanceRel + ' ' + gateRel);
    console.log('  git commit -m "task ' + meta.id + ': приёмка (metadata)"');
    console.log('  # gates.jsonl несёт строку accept: без git add её выбросит reset --hard');
    /*
     * 0011 (F-2): путь к проверке записи вычисляется от самого скрипта
     * относительно корня репозитория. В пакете это spec/scripts/…, в
     * развёрнутой копии — docs/subagent-workflow/scripts/…; прежнее
     * «scripts/…» в развёрнутой копии не существовало.
     */
    const checkScriptRel = relPosix(repo, path.join(SCRIPT_DIR, 'task-check-acceptance.mjs'));
    console.log('Проверка записи: node ' + checkScriptRel + ' --file ' + acceptanceRel + ' --repo .');
  }
} catch (err) {
  if (argv.json) console.log(JSON.stringify({ ok: false, errors: [err.message] }, null, 2));
  else console.error('task-accept: ' + err.message);
  process.exit(err.exitCode || 1);
}
