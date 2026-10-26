#!/usr/bin/env node
/*
 * Проверка записи о приёмке (acceptance.json версии 4).
 *
 * Запускается в CI и при аудите. Приватных ключей не требует: подпись
 * проверяется публичным ключом, закреплённым в acceptors.json.
 *
 * Проверяет: подпись, актора и сессии, уровень независимости против риска,
 * свежесть прогона, красный по ожиданию, кандидатный коммит и хеши файлов,
 * отсутствие записи в кандидате, чистоту metadata-коммита.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { loadAcceptors, verifyRecord, publicKeyFingerprint, readJsonFile } from './sign.mjs';
import { canonicalize, sha256 as sha256Text, loadConfig, summarizeDecisions } from './lib/common.mjs';
import { policyOf, modelLevel, familyOf } from './lib/policy.mjs';
import { assessIndependence, LEVEL_RANK, requiredLevel } from './actor.mjs';
import { validateReview } from './lib/review.mjs';

function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith('--')) { out[a.slice(2)] = next; i += 1; }
      else out[a.slice(2)] = true;
    } else out._.push(a);
  }
  return out;
}

function sha256Buffer(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function git(repo, args, { buffer = false } = {}) {
  try {
    return execFileSync('git', ['-C', repo, ...args], {
      encoding: buffer ? 'buffer' : 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      maxBuffer: 64 * 1024 * 1024,
    });
  } catch (err) {
    throw new Error('git ' + args.join(' ') + ': ' + String(err.stderr || err.message).trim());
  }
}

function gitTry(repo, args) {
  try { return git(repo, args); } catch { return null; }
}

function fileAt(repo, rev, rel) {
  try {
    return git(repo, ['show', rev + ':' + rel], { buffer: true });
  } catch {
    return null;
  }
}

const argv = parseArgs(process.argv.slice(2));
if (argv.help) {
  console.log('Usage: task-check-acceptance.mjs --file <acceptance.json> --repo <dir> --keys <acceptors.json>');
  console.log('       [--task <путь к каталогу задания>] [--metadata <sha metadata-коммита>] [--json]');
  process.exit(0);
}

const errors = [];
const warnings = [];
const note = (message) => errors.push(message);

function run() {
  const file = path.resolve(String(argv.file || argv._[0] || ''));
  if (!fs.existsSync(file)) throw new Error('нет файла ' + file);
  const repo = path.resolve(String(argv.repo || '.'));
  const config = loadConfig(repo);
  const keysFile = path.resolve(String(argv.keys || config.keysFile));
  if (!fs.existsSync(keysFile)) throw new Error('нет acceptors.json: ' + keysFile);

  const record = readJsonFile(file);
  const acceptors = loadAcceptors(keysFile);

  if (![4, 5, 6].includes(record.version)) note('версия записи ' + record.version + ', нужна 4, 5 или 6');
  if (record.version >= 5 && !record.decisions) note('запись версии ' + record.version + ' без блока decisions');
  if (record.status !== 'accepted') note('статус записи: ' + record.status);

  const entry = acceptors.find((item) => item.keyId === record.keyId);
  if (!entry) {
    note('ключ ' + record.keyId + ' не закреплён в acceptors.json');
  } else {
    if (entry.revokedAt && record.acceptedAt && new Date(record.acceptedAt) > new Date(entry.revokedAt)) {
      note('ключ ' + entry.keyId + ' отозван до приёмки');
    }
    if (entry.kind === 'human' && record.actor && record.actor.kind !== 'human') {
      note('ключ ' + entry.keyId + ' человеческий, а actor.kind=' + record.actor.kind);
    }
    if (entry.kind === 'agent' && record.actor && record.actor.kind === 'human') {
      note('для human-актора нужен ключ human-*, а записан ' + entry.keyId);
    }
    if (record.actor && record.actor.keyId !== record.keyId) {
      note('actor.keyId не совпадает с keyId записи');
    }
    if (!verifyRecord(record, entry.publicKeyPem)) note('подпись Ed25519 не совпадает');
    if (publicKeyFingerprint(entry.publicKeyPem) !== record.publicKeyFingerprint) {
      note('publicKeyFingerprint не совпадает с закреплённым ключом');
    }
  }

  const issuedBy = record.issuedBy || {};
  const actor = record.actor || {};
  const risk = record.risk;

  if (!actor.session && actor.kind !== 'human' && risk !== 'low') note('actor.session пуст: актор не аттестован');
  if (actor.attestedBy === 'declared' && risk !== 'low') note('attestedBy=declared допустим только для low');
  if (issuedBy.session && actor.session && issuedBy.session === actor.session) {
    note('actor.session совпадает с issuedBy.session: самоприёмка');
  }
  if (!issuedBy.session && (risk === 'medium' || risk === 'high')) {
    note('в записи нет issuedBy.session: постановщик не зафиксирован');
  }

  const independence = record.independence || {};
  if (independence.level === 'same-session') note('уровень независимости same-session недействителен');
  const required = requiredLevel(risk);
  if (LEVEL_RANK[independence.level] < LEVEL_RANK[required]) {
    note('independence.level=' + independence.level + ' ниже ' + required + ' для risk=' + risk);
  }
  if ((risk === 'medium' || risk === 'high') && independence.separateSession !== true) {
    note('independence.separateSession должен быть true для medium/high');
  }

  if (risk === 'high') {
    if (record.humanSignoff !== true) note('high-risk без humanSignoff=true');
    if (record.securityReview !== true) note('high-risk без securityReview=true');
    if (actor.kind !== 'human') note('high-risk принимает только человек');
    if (!/^human-/.test(String(record.keyId))) note('high-risk требует ключ human-*');
    const active = Object.entries(record.bypasses || {}).filter(([, value]) => value === true);
    if (active.length) note('high-risk с активным обходом: ' + active.map(([key]) => key).join(', '));
  }

  const runInfo = record.acceptorRun || {};
  if (risk !== 'low') {
    if (runInfo.fresh !== true) note('для medium/high нужен свежий прогон приёмщика (acceptorRun.fresh=true)');
    if (!runInfo.nonce) note('нет nonce свежего прогона');
  }
  if (runInfo.verifySha256 && !/^[0-9a-f]{64}$/.test(runInfo.verifySha256)) note('verifySha256 некорректен');

  if (record.red) {
    if (record.red.contractCommit !== record.contractCommit) note('red.contractCommit не совпадает с contractCommit');
    if (record.red.criteriaJsonSha256 !== record.criteriaJsonSha256) note('red.criteriaJsonSha256 не совпадает с записью');
    if (!record.red.redExpectation || record.red.redExpectation.ok !== true) note('красный не совпал с redExpect');
  } else if (risk !== 'low') {
    note('для medium/high запись должна содержать блок red');
  }

  if (record.review) {
    const reviewCheck = validateReview(record.review);
    for (const error of reviewCheck.errors) note('review: ' + error);
    if (record.releaseReady !== reviewCheck.releaseReady) note('releaseReady не совпадает с разбором замечаний');
  } else if (record.releaseReady === false && !(record.decisions && Array.isArray(record.decisions.assumed) && record.decisions.assumed.length > 0)) {
    note('releaseReady=false без review и без assumed-решений');
  }

  const candidate = record.candidateCommit;
  if (!candidate) {
    note('нет candidateCommit');
    return record;
  }
  const type = gitTry(repo, ['cat-file', '-t', candidate]);
  if (!type || type.trim() !== 'commit') {
    note('кандидатный коммит не найден: ' + candidate);
    return record;
  }
  const tree = git(repo, ['rev-parse', candidate + '^{tree}']).trim();
  if (tree !== record.tree) note('tree в записи не совпадает с коммитом');

  const taskRel = argv.task
    ? String(argv.task).split('\\').join('/').replace(/\/+$/, '')
    : path.relative(repo, path.dirname(file)).split(path.sep).join('/');
  const acceptanceRel = taskRel + '/acceptance.json';

  const commitFiles = git(repo, ['ls-tree', '-r', '--name-only', candidate]).split('\n').filter(Boolean);
  if (commitFiles.includes(acceptanceRel)) note('acceptance.json входит в кандидатный коммит');

  const taskFile = fileAt(repo, candidate, taskRel + '/task.md');
  if (!taskFile) note('в кандидате нет ' + taskRel + '/task.md');
  else if (sha256Text(canonicalize(taskFile.toString('utf8'))) !== record.taskFileSha256) note('taskFileSha256 не совпадает с кандидатом');

  const criteriaFile = fileAt(repo, candidate, taskRel + '/criteria.json');
  if (!criteriaFile) note('в кандидате нет ' + taskRel + '/criteria.json');
  else if (sha256Text(canonicalize(criteriaFile.toString('utf8'))) !== record.criteriaJsonSha256) note('criteriaJsonSha256 не совпадает с кандидатом');

  /*
   * Решения (2.1.0): запись обязана совпадать с контрактом. Digest и список
   * assumed пересчитываются из task.md/criteria.json кандидата, а не берутся
   * на веру: иначе assumed можно «потерять» и выпустить непроверенную семантику.
   */
  if (record.decisions) {
    const metaMatch = taskFile ? taskFile.toString('utf8').match(/<!--\s*TASK-META\s*([\s\S]*?)-->/) : null;
    let meta = null;
    if (metaMatch) {
      try { meta = JSON.parse(metaMatch[1].trim()); } catch { meta = null; }
    }
    if (!meta) {
      note('не удалось прочитать TASK-META из кандидата: decisions не сверить');
    } else {
      let criteriaList = [];
      if (criteriaFile) {
        try {
          const parsed = JSON.parse(criteriaFile.toString('utf8'));
          criteriaList = Array.isArray(parsed) ? parsed : (Array.isArray(parsed.criteria) ? parsed.criteria : []);
        } catch { criteriaList = []; }
      }
      const expected = summarizeDecisions(meta.decisions, criteriaList);
      if (record.decisions.count !== expected.count) note('decisions.count=' + record.decisions.count + ', в контракте ' + expected.count);
      if (record.decisions.digest !== expected.digest) note('decisions.digest не совпадает с контрактом');
      const recorded = Array.isArray(record.decisions.assumed) ? [...record.decisions.assumed].map(String).sort() : [];
      const derived = [...expected.assumed].map(String).sort();
      if (JSON.stringify(recorded) !== JSON.stringify(derived)) {
        note('decisions.assumed не совпадает с контрактом: запись [' + recorded.join(', ') + '], контракт [' + derived.join(', ') + ']');
      }
      if (expected.unproven.length) note('решение о пользовательском контракте без доказательства: ' + expected.unproven.join(', '));
      if (expected.assumed.length > 0 && record.releaseReady !== false) note('есть assumed-решения, а releaseReady не false');
      if (record.risk === 'high' && expected.assumed.length > 0) note('high-risk с assumed-решениями');
    }
  }

  /*
   * Атака спецификации (2.2.0): digest по файлу кандидата, неразрешённых blocking
   * быть не должно, критик — не постановщик. Строгость семейства — по политике.
   */
  if (record.attack) {
    if (record.attack.attestation !== 'declared') note('attack.attestation: ожидается declared');
    const attackInCandidate = fileAt(repo, candidate, taskRel + '/attack.json');
    if (!attackInCandidate) note('запись ссылается на attack.json, но его нет в кандидате');
    else if (sha256Buffer(attackInCandidate) !== record.attack.sha256) note('attack.sha256 не совпадает с файлом в кандидате');
    const findings = record.attack.findings || {};
    if (findings.unresolved !== 0) note('attack: есть blocking-находки без решения (' + findings.unresolved + ')');
    if (record.attack.session && issuedBy.session && record.attack.session === issuedBy.session) note('критик из сессии постановщика');
    if (record.attack.level === 'same-family' && policyOf(config).roles.modelFamily === 'fail') {
      note('критик того же семейства, что постановщик (policy.roles.modelFamily=fail)');
    }
  } else if (record.version >= 6 && policyOf(config).attack === 'fail' && risk !== 'low') {
    note('policy.attack=fail, а запись без блока attack');
  }

  const expectedModelLevel = issuedBy.model && actor.model ? modelLevel(config, issuedBy.model, actor.model) : 'unknown';
  if (record.independence && record.independence.modelLevel !== undefined && record.independence.modelLevel !== expectedModelLevel) {
    note('independence.modelLevel=' + record.independence.modelLevel + ', по моделям ' + expectedModelLevel);
  }
  if (record.actor && record.actor.family !== undefined && record.actor.family !== familyOf(config, record.actor.model)) {
    note('actor.family не совпадает с реестром моделей');
  }
  if (expectedModelLevel === 'same-family' && policyOf(config).roles.modelFamily === 'fail') {
    note('приёмщик того же семейства, что постановщик (policy.roles.modelFamily=fail)');
  }

  if (runInfo.verifySha256) {
    const verifyFile = fileAt(repo, candidate, taskRel + '/verify.json');
    if (!verifyFile) note('запись ссылается на verify.json, но его нет в кандидате');
    else if (sha256Buffer(verifyFile) !== runInfo.verifySha256) note('verifySha256 не совпадает с файлом в кандидате');
  }
  if (runInfo.verifyLogSha256) {
    const logFile = fileAt(repo, candidate, taskRel + '/verify.log');
    if (!logFile) note('запись ссылается на verify.log, но его нет в кандидате');
    else if (sha256Buffer(logFile) !== runInfo.verifyLogSha256) note('verifyLogSha256 не совпадает с файлом');
  }

  if (argv.metadata) {
    const metadata = String(argv.metadata);
    const parent = gitTry(repo, ['rev-parse', metadata + '^']);
    if (!parent || parent.trim() !== candidate) note('metadata-коммит не является потомком кандидата');
    else {
      const changed = git(repo, ['diff', '--name-only', candidate, metadata]).split('\n').filter(Boolean);
      if (changed.length !== 1 || changed[0] !== acceptanceRel) {
        note('metadata-коммит меняет не только acceptance.json: ' + changed.join(', '));
      }
    }
  } else {
    warnings.push('metadata-коммит не проверялся (--metadata не передан)');
  }

  return record;
}

try {
  const record = run();
  const result = {
    ok: errors.length === 0,
    task: record.task,
    risk: record.risk,
    keyId: record.keyId,
    actorSession: record.actor ? record.actor.session : null,
    level: record.independence ? record.independence.level : null,
    errors,
    warnings,
  };
  if (argv.json) console.log(JSON.stringify(result, null, 2));
  else if (errors.length === 0) {
    console.log('check-acceptance: запись корректна');
    console.log('  task    ' + record.task + ' (risk=' + record.risk + ')');
    console.log('  actor   ' + (record.actor ? record.actor.kind + ' / ' + record.actor.session : 'нет'));
    console.log('  level   ' + (record.independence ? record.independence.level : 'нет'));
    console.log('  key     ' + record.keyId);
    for (const warning of warnings) console.log('  WARN ' + warning);
  } else {
    for (const error of errors) console.error('check-acceptance: ERROR ' + error);
    for (const warning of warnings) console.error('  WARN ' + warning);
  }
  process.exit(errors.length === 0 ? 0 : 1);
} catch (err) {
  console.error('check-acceptance: ' + err.message);
  process.exit(1);
}
