#!/usr/bin/env node
/**
 * 0136 (P0): конвертер генезисов — читает существующие артефакты задачи и
 * строит файл фактов (docs/subagent-workflow/facts/<task>.jsonl). Оригиналы
 * не меняются; файл фактов создаётся один раз (append-only, без --force повторно
 * не пишем).
 *
 * Честные границы P0: правил set'a ещё нет (ruleset_hash='unknown'), запечатанного
 * прогона нет (sealed_run отсутствует) — исполнитель пометит такие ограничения
 * как «не применимо к сегодняшнему процессу», а не подделает факт.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { appendFact, factFileOf, sha256Text } from '../lib/facts.mjs';
import { parseTaskMeta } from './lib/common.mjs';
import { verifyRecord } from './sign.mjs';
import { fileURLToPath } from 'node:url';
import { actionsFromJournal, sessionFileOf } from '../lib/actions.mjs';

/**
 * 0139: факт ruleset — правила как данные (C5, C9).
 *
 * Источники: docs/anchors.json (якоря), presets/lock.json (пресеты), policy из
 * workflow.config.json. Подпись берётся из docs/anchors.approval.json: если она
 * есть и подписана человеческим ключом — факт несёт её, иначе signature=null,
 * а C9 честно скажет «правила не подписаны».
 */
/**
 * 0143: подпись правил проверяется криптографически, а не по префиксу ключа.
 * Подпись покрывает canonical({hash, by, at}); берём публичный ключ из acceptors.json
 * и сверяем значение. Возвращаем verified=true только при успехе.
 */
export function readRuleset(repoRoot) {
  const root = path.resolve(String(repoRoot));
  const readJson = (file) => { try { return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/u, '')); } catch { return null; } };
  const anchorsFile = path.join(root, 'docs', 'anchors.json');
  const approvalFile = path.join(root, 'docs', 'anchors.approval.json');
  const presetsLock = path.join(root, 'presets', 'lock.json');
  const configFile = path.join(root, '..', 'docs', 'subagent-workflow', 'workflow.config.json');
  const anchorsText = fs.existsSync(anchorsFile) ? fs.readFileSync(anchorsFile, 'utf8') : '';
  const approval = readJson(approvalFile);
  const lock = readJson(presetsLock) || {};
  const config = readJson(configFile) || {};
  const policy = config.policy && typeof config.policy === 'object' ? config.policy : {};
  const version = anchorsText === '' ? 0 : 1;
  let signature = null;
  if (approval && approval.signature && typeof approval.signature === 'object') {
    let verified = false;
    let reason = 'подпись не проверена';
    try {
      const acceptorsFile = path.join(root, '..', 'docs', 'subagent-workflow', 'acceptors.json');
      const acceptors = readJson(acceptorsFile);
      const list = acceptors && Array.isArray(acceptors.acceptors) ? acceptors.acceptors : [];
      const keyId = String(approval.signature.keyId || approval.keyId || '');
      const key = list.find((item) => item && item.keyId === keyId);
      if (!key) reason = 'ключ ' + keyId + ' не найден в acceptors.json';
      else if (key.kind !== 'human') reason = 'ключ ' + keyId + ' не человеческий';
      else if (verifyRecord(approval, key.publicKeyPem)) { verified = true; reason = null; }
      else reason = 'подпись не сходится с ключом ' + keyId;
    } catch (error) {
      reason = 'ошибка проверки: ' + String(error && error.message ? error.message : error);
    }
    signature = {
      keyId: approval.signature.keyId || approval.keyId || null,
      covers: approval.signature.covers || null,
      hash: approval.hash || null,
      at: approval.at || null,
      verified,
      reason,
    };
  }
  return {
    version,
    anchors_hash: anchorsText === '' ? 'none' : sha256Text(anchorsText),
    presets_hash: sha256Text(JSON.stringify(lock.presets || {})),
    seal: 'none',
    policy,
    signature,
    sources: { anchors: fs.existsSync(anchorsFile), approval: Boolean(approval), presets: fs.existsSync(presetsLock), config: fs.existsSync(configFile) },
  };
}

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/u, '')); } catch { return null; }
}

function readLines(file) {
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, 'utf8').split('\n').filter((line) => line.trim() !== '');
}

/**
 * Построить строки фактов по артефактам задачи. Чистая функция: ничего не пишет.
 * @returns {{rows: object[], problems: string[]}}
 */
export function convertTask(taskDir, options = {}) {
  const dir = path.resolve(String(taskDir));
  const problems = [];
  const taskId = path.basename(dir);
  const acceptance = readJson(path.join(dir, 'acceptance.json'));
  const verify = readJson(path.join(dir, 'verify.json'));
  if (!acceptance) problems.push('нет acceptance.json');
  if (!verify) problems.push('нет verify.json');
  const contractHash = (verify && verify.criteriaSha256) || (acceptance && acceptance.criteriaSha256) || '';
  const criteriaJsonHash = (verify && verify.criteriaJsonSha256) || (acceptance && acceptance.criteriaJsonSha256) || '';
  const commit = (acceptance && (acceptance.candidateCommit || acceptance.baseCommit)) || (verify && verify.headSha) || '';
  const diffHash = (acceptance && acceptance.worktreeDigest) || '';
  const at = (verify && verify.createdAt) || (acceptance && acceptance.issuedAt) || new Date().toISOString();
  const actor = (acceptance && acceptance.actor) || {};
  /* C3: запрещённые пути — protectedPaths из TASK-META (task.md), не из acceptance. */
  const taskMd = path.join(dir, 'task.md');
  let forbidden = [];
  if (fs.existsSync(taskMd)) {
    const meta = parseTaskMeta(fs.readFileSync(taskMd, 'utf8')) || {};
    forbidden = Array.isArray(meta.protectedPaths) ? meta.protectedPaths.map(String) : [];
  }
  const runId = taskId + ':1';
  const rows = [];
  if (contractHash === '' || commit === '') {
    problems.push('не хватает контракта или коммита для генезиса');
    return { rows, problems };
  }
  rows.push({ kind: 'genesis', task: taskId, contract_hash: contractHash, at, writer: 'converter' });
  /* 0139: правила как данные — сразу после генезиса (цепь начинается с генезиса). */
  if (options.repoRoot) {
    const ruleset = readRuleset(options.repoRoot);
    rows.push({ kind: 'ruleset', version: ruleset.version, anchors_hash: ruleset.anchors_hash, presets_hash: ruleset.presets_hash, seal: ruleset.seal, policy: ruleset.policy, signature: ruleset.signature });
  }
  rows.push({ kind: 'task', id: taskId, contract_hash: contractHash, risk: String((acceptance && acceptance.risk) || 'unknown'), writer: 'workflow', at });
  /* 0140: контракт может объявлять запечатанный тест (WC-81) — хеш закрепляется в факте. */
  let seal = null;
  if (fs.existsSync(taskMd)) {
    const meta = parseTaskMeta(fs.readFileSync(taskMd, 'utf8')) || {};
    const sealedTest = meta.sealedTest;
    if (sealedTest && typeof sealedTest === 'object' && typeof sealedTest.path === 'string' && /^[0-9a-f]{64}$/u.test(String(sealedTest.hash || '').toLowerCase())) {
      seal = { path: sealedTest.path, hash: String(sealedTest.hash).toLowerCase() };
    }
  }
  /* 0141: план — allowedPaths контракта; фактические записи — из журнала сессии исполнителя. */
  let planned = null;
  if (fs.existsSync(taskMd)) {
    const meta = parseTaskMeta(fs.readFileSync(taskMd, 'utf8')) || {};
    if (Array.isArray(meta.allowedPaths)) planned = meta.allowedPaths.map(String);
  }
  /* plannedDeclared отличает «плана нет» от «план пуст»: пустой план запрещает любые действия. */
  rows.push({ kind: 'contract', task: taskId, hash: contractHash, criteria: criteriaJsonHash || 'unknown', forbidden, planned, plannedDeclared: planned !== null, seal, writer: 'workflow', at });
  rows.push({ kind: 'run', id: runId, task: taskId, commit, ruleset_hash: 'unknown', command: 'task-accept', writer: 'acceptor' });
  const changedPaths = Array.isArray(verify && verify.changedPaths) ? verify.changedPaths : [];
  rows.push({ kind: 'diff', task: taskId, run: runId, commit, paths: changedPaths, diff_hash: diffHash || 'unknown', writer: 'acceptor' });
  /* Доказательства — из журнала гейтов (gates.jsonl), иначе один факт от verify.json. */
  const gateLines = readLines(path.join(dir, 'gates.jsonl'));
  const evidenceHashes = [];
  if (gateLines.length > 0) {
    for (const line of gateLines) {
      let row;
      try { row = JSON.parse(line); } catch { problems.push('gates.jsonl: строка не JSON'); continue; }
      /*
       * 0139: у гейта red успех — доказанный красный (verdict=red-proven), а не
       * зелёный прогон. Поэтому exit в факте означает «гейт достиг своего
       * назначения», а сырой verdict сохраняется рядом для аудита.
       */
      /*
       * 0143: успех гейта — только явный вердикт или явный зелёный итог.
       * Отсутствие failed=N раньше считалось «зелено» — неполная запись могла стать успехом.
       */
      const verdict = String(row.verdict || '');
      const exitSummary = String(row.exitSummary || '');
      const failed = /failed=([0-9]+)\//u.exec(exitSummary);
      const gate = String(row.kind || 'gate');
      const achieved = verdict === 'red-proven' || verdict === 'passed' || (verdict === '' && failed !== null && Number(failed[1]) === 0);
      const exit = achieved ? 0 : 1;
      const artifactHash = sha256Text(line);
      evidenceHashes.push(artifactHash);
      rows.push({ kind: 'evidence', task: taskId, run: runId, gate, artifact_hash: artifactHash, exit, verdict, writer: 'acceptor' });
    }
  } else {
    const verifyLog = path.join(dir, 'verify.log');
    const artifactHash = sha256Text(fs.existsSync(verifyLog) ? fs.readFileSync(verifyLog, 'utf8') : fs.readFileSync(path.join(dir, 'verify.json'), 'utf8'));
    evidenceHashes.push(artifactHash);
    rows.push({ kind: 'evidence', task: taskId, run: runId, gate: 'verify', artifact_hash: artifactHash, exit: acceptance && acceptance.status === 'accepted' ? 0 : 1, verdict: acceptance && acceptance.status, writer: 'acceptor' });
    /*
     * 0139: у ранних задач журнала гейтов нет, но доказательство красного есть в
     * red.json (redProven/redExpectation). Без этого C5 видел только verify и
     * расходился с процессом на 0004/0030 — источник ищем, а не подставляем.
     */
    const redFile = path.join(dir, 'red.json');
    if (fs.existsSync(redFile)) {
      const red = readJson(redFile) || {};
      const proven = red.redProven === true && (!red.redExpectation || red.redExpectation.ok !== false);
      const redHash = sha256Text(fs.readFileSync(redFile, 'utf8'));
      evidenceHashes.push(redHash);
      rows.push({ kind: 'evidence', task: taskId, run: runId, gate: 'red', artifact_hash: redHash, exit: proven ? 0 : 1, verdict: proven ? 'red-proven' : 'red-unproven', writer: 'acceptor' });
    }
  }
  rows.push({ kind: 'judgment', task: taskId, run: runId, artifact_hash: diffHash || 'unknown', by: String(actor.keyId || 'agent-judge'), role: String(actor.node || 'judge'), model: String(actor.model || 'unknown'), verdict: String((acceptance && acceptance.status) || 'unknown'), writer: 'acceptor' });
  /* 0141: действия исполнителя из журнала сессии — только записи, чтение не считается. */
  const sessionId = actor && actor.session ? String(actor.session) : '';
  if (sessionId !== '' && options.workspace) {
    const actions = actionsFromJournal(sessionFileOf(options.workspace, sessionId));
    if (actions.paths.length > 0) {
      rows.push({ kind: 'action', task: taskId, run: runId, cmd: 'journal', paths: actions.paths, writer: 'executor', at });
    }
  }
  rows.push({ kind: 'accept', task: taskId, run: runId, contract_hash: contractHash, diff_hash: diffHash || 'unknown', ruleset_hash: 'unknown', evidence_manifest_hash: sha256Text(evidenceHashes.sort().join(',')), by: String(actor.keyId || 'agent-judge'), at });
  return { rows, problems };
}

/** Записать факты задачи в воркспейс. Существующий файл без --force не трогаем. */
export function convertToWorkspace(taskDir, workspace, options = {}) {
  const taskId = path.basename(path.resolve(String(taskDir)));
  const file = factFileOf(workspace, taskId);
  if (fs.existsSync(file) && options.force !== true) {
    return { ok: false, file, problems: ['файл фактов уже существует: ' + file + ' — append-only, повторно не конвертируем (нужен --force)'] };
  }
  const converted = convertTask(taskDir, { repoRoot: options.repoRoot, workspace });
  if (converted.rows.length === 0) return { ok: false, file, problems: converted.problems };
  if (options.force === true && fs.existsSync(file)) {
    /*
     * 0143: --force не должен молча стирать дописанные факты (sealed-run, accept).
     * Делаем копию и отказываем, если в файле есть строки не от конвертера.
     */
    const lines = fs.readFileSync(file, 'utf8').split('\n').filter((line) => line.trim() !== '');
    const foreign = lines.filter((line) => { try { const row = JSON.parse(line); return row.writer !== 'converter' && row.kind !== 'genesis'; } catch { return true; } });
    if (foreign.length > 0) {
      return { ok: false, file, problems: ['в файле фактов есть строки не от конвертера (' + foreign.length + '): пересборка стёрла бы доказательства — сделайте backup вручную'] };
    }
    fs.copyFileSync(file, file + '.bak');
    fs.rmSync(file, { force: true });
  }
  for (const row of converted.rows) appendFact(file, row);
  return { ok: true, file, rows: converted.rows.length, problems: converted.problems };
}

if (process.argv[1] && import.meta.url === new URL('file://' + path.resolve(process.argv[1]).split(path.sep).join('/')).href) {
  const argv = process.argv.slice(2);
  const value = (flag) => { const index = argv.indexOf(flag); return index >= 0 ? argv[index + 1] : undefined; };
  const taskDir = value('--task') || process.cwd();
  const workspace = value('--workspace') || path.resolve(taskDir, '..', '..', '..');
  /* 0143: путь через fileURLToPath — new URL().pathname ломался на пробелах и ~1. */
  const repoRoot = value('--repo') || path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
  const result = convertToWorkspace(taskDir, workspace, { force: argv.includes('--force'), repoRoot });
  for (const problem of result.problems) console.log('CONVERT PROBLEM ' + problem);
  if (result.ok) console.log('facts-convert: OK — ' + result.file + ' (' + result.rows + ' фактов)');
  else process.exitCode = 1;
}