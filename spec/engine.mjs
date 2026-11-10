#!/usr/bin/env node
/**
 * 0136 (P0) / 0143: исполнитель ограничений. Читает факты задачи и оценивает
 * ограничения C1–C10 из спецификации v0.2. Чистая функция: ничего не пишет.
 *
 * 0143 (ревью адвоката 10.11): все доказательства обязаны относиться к ОДНОМУ run,
 * который назван в свидетельстве accept. Смешанные прогоны (свежий дифф, вчерашние
 * доказательства) — не «проходит», а C10 fail: добавление лишнего факта не улучшает
 * вердикт (монотонность).
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { factFileOf, readFactFile, pathForbidden, sha256Text } from './lib/facts.mjs';
import { mandatoryGates, evaluateGates } from './lib/policy.mjs';
import { pathsOutsidePlan } from './lib/actions.mjs';

function rowsOf(read, kind) {
  return read.rows.filter((row) => row.kind === kind);
}

function push(report, id, status, detail) {
  report.push({ id, status, detail });
}

/**
 * 0144 (Grok): движок не должен верить полю verified из факта — он проверяет
 * подпись сам, если ему передали acceptors. Иначе самодекларация проходит C9.
 */
export function verifyRulesSignature(ruleset, acceptors) {
  try {
    const signature = ruleset && ruleset.signature ? ruleset.signature : null;
    if (!signature || typeof signature.value !== 'string') return false;
    const keyId = String(signature.keyId || '');
    const key = (Array.isArray(acceptors) ? acceptors : []).find((item) => item && item.keyId === keyId);
    if (!key || key.kind !== 'human') return false;
    const body = canonicalizeRules({ hash: signature.hash, by: signature.by, at: signature.at });
    return crypto.verify(null, Buffer.from(body, 'utf8'), crypto.createPublicKey(key.publicKeyPem), Buffer.from(signature.value, 'base64'));
  } catch {
    return false;
  }
}

function canonicalizeRules(value) {
  if (Array.isArray(value)) return '[' + value.map(canonicalizeRules).join(',') + ']';
  if (value && typeof value === 'object') {
    const keys = Object.keys(value).sort();
    return '{' + keys.map((key) => JSON.stringify(key) + ':' + canonicalizeRules(value[key])).join(',') + '}';
  }
  return JSON.stringify(value);
}

/** Оценка всех ограничений по фактам задачи. */
export function evaluateTask(read, options = {}) {
  const report = [];
  const tasks = rowsOf(read, 'task');
  const contracts = rowsOf(read, 'contract');
  const runs = rowsOf(read, 'run');
  const accepts = rowsOf(read, 'accept');
  const t = tasks[0] || null;
  const c = contracts[0] || null;
  const a = accepts[0] || null;
  /* Целевой прогон: тот, что назван в свидетельстве; иначе единственный run. */
  const targetRun = a ? String(a.run || '') : (runs.length === 1 ? String(runs[0].id || '') : '');
  const inRun = (row) => String(row.run || '') === targetRun;
  const r = runs.find((row) => String(row.id || '') === targetRun) || null;
  const d = rowsOf(read, 'diff').find(inRun) || null;
  const j = rowsOf(read, 'judgment').filter(inRun)[0] || null;
  const evidence = rowsOf(read, 'evidence').filter(inRun);

  /* C1: задача, контракт и запуск согласованы по хешу контракта. */
  const c1 = Boolean(t && c && r && t.contract_hash === c.hash && String(r.task || '') === String(t.id || ''));
  push(report, 'C1', c1 ? 'pass' : 'fail', c1 ? 'контракт и запуск согласованы' : 'контракт/запуск не согласованы или отсутствуют');

  /* C2: запечатанный прогон. Это обязанность, только если её объявил контракт. */
  const seal = c && c.seal && typeof c.seal === 'object' ? c.seal : null;
  /* 0144 (Grok): «первый успешный» из нескольких sealed — не доказательство; конфликт = отказ. */
  const sealedRows = evidence.filter((row) => row.gate === 'sealed');
  const sealed = sealedRows.find((row) => row.seal_hash && row.seal_hash === (seal && seal.hash) && row.exit === 0) || null;
  const sealedConflict = sealedRows.some((row) => row.exit !== 0);
  let c2;
  if (seal === null) c2 = { status: 'not-applicable', detail: 'контракт не объявляет sealedTest — обязанности нет' };
  else if (sealedConflict) c2 = { status: 'fail', detail: 'противоречивые доказательства sealed: есть и успешный, и неуспешный прогон' };
  else if (sealed) c2 = { status: 'pass', detail: 'запечатанный прогон пройден (' + String(seal.hash).slice(0, 12) + '…)' };
  else c2 = { status: 'fail', detail: 'контракт объявляет seal, а доказательства sealed в этом run нет' };
  push(report, 'C2', c2.status, c2.detail);

  /* C3: дифф не касается запрещённых путей. Пустой forbidden — запретов не объявлено. */
  const forbidden = c && Array.isArray(c.forbidden) ? c.forbidden : [];
  const c3hits = (d && Array.isArray(d.paths) ? d.paths : []).filter((item) => pathForbidden(item, forbidden));
  const c3 = forbidden.length === 0
    ? { status: 'not-applicable', detail: 'запрещённые пути не объявлены в контракте' }
    : { status: c3hits.length === 0 ? 'pass' : 'fail', detail: c3hits.length === 0 ? 'дифф не касается запрещённых путей' : 'запрещённые пути в диффе: ' + c3hits.join(', ') };
  push(report, 'C3', c3.status, c3.detail);

  /* C4: суждение о том же артефакте, в этом же run. */
  const c4 = Boolean(j && d && j.artifact_hash === d.diff_hash && j.verdict === 'accepted');
  push(report, 'C4', c4 ? 'pass' : 'fail', c4 ? 'суждение совпадает с диффом этого run' : 'суждение отсутствует или привязано к другому артефакту/run');

  /* C5: политика гейтов по риску. */
  const ruleset = rowsOf(read, 'ruleset')[0] || null;
  const rulesetPresent = Boolean(ruleset);
  const c5 = evaluateGates(evidence, mandatoryGates(ruleset, t ? t.risk : 'medium'), rulesetPresent);
  push(report, 'C5', c5.status, c5.detail);

  /* C7: цепь фактов цела. */
  push(report, 'C7', read.ok ? 'pass' : 'fail', read.ok ? 'цепь цела' : read.problems.join('; '));

  /* C8: план против фактических действий (действия + пути диффа). */
  const plannedDeclared = Boolean(c && c.plannedDeclared === true);
  const planned = c && Array.isArray(c.planned) ? c.planned : [];
  const actions = rowsOf(read, 'action').filter(inRun).flatMap((row) => (Array.isArray(row.paths) ? row.paths : []));
  const diffPaths = d && Array.isArray(d.paths) ? d.paths : [];
  const actual = [...new Set([...actions, ...diffPaths])];
  let c8;
  if (!plannedDeclared) c8 = { status: 'not-applicable', detail: 'контракт не объявляет allowedPaths — план не задан' };
  else {
    const outside = pathsOutsidePlan(actual, planned);
    c8 = outside && outside.length === 0
      ? { status: 'pass', detail: 'действия не выходят за план (' + actual.length + ' путей' + (actions.length === 0 ? '; журнал исполнителя отсутствует — контроль сужен до диффа' : '') + ')' }
      : { status: 'fail', detail: 'вне плана: ' + (outside || []).slice(0, 6).join(', ') };
  }
  push(report, 'C8', c8.status, c8.detail);

  /* C9: правила подписаны человеческим ключом, подпись проверена криптографически. */
  let c9;
  if (!rulesetPresent) c9 = { status: 'not-applicable', detail: 'ruleset отсутствует' };
  else if (!ruleset.signature) c9 = { status: 'fail', detail: 'правила не подписаны' };
  else if (ruleset.signature.verified !== true) c9 = { status: 'fail', detail: 'подпись правил не подтверждена: ' + String(ruleset.signature.reason || 'причина не указана') };
  else if (ruleset.signature.covers !== 'hash+by+at') c9 = { status: 'fail', detail: 'подпись правил не покрывает hash+by+at' };
  else if (ruleset.signature.hash !== ruleset.anchors_hash) c9 = { status: 'fail', detail: 'подпись правил относится к другому anchors.json' };
  else if (options.acceptors && !verifyRulesSignature(ruleset, options.acceptors)) c9 = { status: 'fail', detail: 'подпись правил не сходится с ключом (проверено движком)' };
  else c9 = { status: 'pass', detail: 'правила подписаны и проверены: ' + ruleset.signature.keyId };
  push(report, 'C9', c9.status, c9.detail);

  /*
   * C10: одно свидетельство, согласованные хеши и НИ ОДНОГО факта другого run.
   * Смешанные прогоны — не «мелочь»: именно так вчерашние доказательства выдают
   * за сегодняшние (находка адвоката 1).
   */
  const crossRun = [...rowsOf(read, 'evidence'), ...rowsOf(read, 'judgment'), ...rowsOf(read, 'diff'), ...rowsOf(read, 'action')]
    .filter((row) => String(row.run || '') !== targetRun);
  const hashesOk = Boolean(a && c && d && a.contract_hash === c.hash && a.diff_hash === d.diff_hash);
  /* 0144 (Grok): манифест доказательств обязан совпадать с фактическим набором этого run. */
  const manifestHash = sha256Text([...evidence].map((row) => String(row.artifact_hash || '')).sort().join(','));
  const manifestOk = Boolean(a && a.evidence_manifest_hash && a.evidence_manifest_hash === manifestHash);
  /* 0144 (Grok): манифест доказательств обязан совпадать с фактическим набором этого run. */
  const c10problems = [];
  if (accepts.length !== 1) c10problems.push('свидетельств accept: ' + accepts.length + ' (нужно ровно одно)');
  if (tasks.length !== 1) c10problems.push('фактов task: ' + tasks.length);
  if (!hashesOk) c10problems.push('хеши свидетельства не совпадают с контрактом/диффом');
  if (!manifestOk) c10problems.push('evidence_manifest_hash не совпадает с фактическим набором доказательств run');
  if (crossRun.length > 0) c10problems.push('факты другого run: ' + crossRun.length);
  push(report, 'C10', c10problems.length === 0 ? 'pass' : 'fail', c10problems.length === 0 ? 'свидетельство единственно и согласовано' : c10problems.join('; '));

  /* C6: выпуски к задаче не относятся — честно «не применимо». */
  push(report, 'C6', 'not-applicable', 'release-факты к задаче не относятся');

  const applicable = report.filter((item) => item.status !== 'not-applicable');
  const passed = applicable.filter((item) => item.status === 'pass');
  const verdict = applicable.length > 0 && passed.length === applicable.length ? 'accepted' : 'rejected';
  return { task: t ? t.id : '?', run: targetRun, report, verdict, passed: passed.length, applicable: applicable.length };
}

/** Оценить задачу воркспейса по id. */
export function evaluateWorkspaceTask(workspace, taskId, options = {}) {
  const file = factFileOf(workspace, taskId);
  const read = readFactFile(file);
  return evaluateTask(read, options);
}

/** Публичные ключи доверенных лиц: движок проверяет подпись правил сам. */
export function loadAcceptors(workspace) {
  const file = path.join(String(workspace), 'docs', 'subagent-workflow', 'acceptors.json');
  try {
    const data = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/u, ''));
    return Array.isArray(data && data.acceptors) ? data.acceptors : [];
  } catch {
    return [];
  }
}

if (process.argv[1] && import.meta.url === new URL('file://' + path.resolve(process.argv[1]).split(path.sep).join('/')).href) {
  const argv = process.argv.slice(2);
  const value = (flag) => { const index = argv.indexOf(flag); return index >= 0 ? argv[index + 1] : undefined; };
  const task = value('--task');
  const workspace = value('--workspace') || process.cwd();
  /* 0143: коды выхода — контракт автоматизации: 0 accepted, 1 rejected, 2 usage. */
  if (!task) { console.log('нужен --task <id>'); process.exitCode = 2; }
  else {
    const acceptors = loadAcceptors(workspace);
    const result = evaluateWorkspaceTask(workspace, task, { acceptors });
    console.log('engine: ' + result.task + ' — вердикт ' + result.verdict + ' (run ' + (result.run || '?') + ', применимо ' + result.applicable + ', pass ' + result.passed + ')');
    for (const item of result.report) console.log('  ' + item.id + ' ' + item.status + ': ' + item.detail);
    if (result.verdict !== 'accepted') process.exitCode = 1;
  }
}