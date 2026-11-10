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
export function convertTask(taskDir) {
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
  rows.push({ kind: 'task', id: taskId, contract_hash: contractHash, risk: String((acceptance && acceptance.risk) || 'unknown'), writer: 'workflow', at });
  rows.push({ kind: 'contract', task: taskId, hash: contractHash, criteria: criteriaJsonHash || 'unknown', forbidden, writer: 'workflow', at });
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
      const failed = /failed=([0-9]+)\//u.exec(String(row.exitSummary || ''));
      const exit = failed && Number(failed[1]) > 0 ? 1 : 0;
      const artifactHash = sha256Text(line);
      evidenceHashes.push(artifactHash);
      rows.push({ kind: 'evidence', task: taskId, run: runId, gate: String(row.kind || 'gate'), artifact_hash: artifactHash, exit, writer: 'acceptor' });
    }
  } else {
    const verifyLog = path.join(dir, 'verify.log');
    const artifactHash = sha256Text(fs.existsSync(verifyLog) ? fs.readFileSync(verifyLog, 'utf8') : fs.readFileSync(path.join(dir, 'verify.json'), 'utf8'));
    evidenceHashes.push(artifactHash);
    rows.push({ kind: 'evidence', task: taskId, run: runId, gate: 'verify', artifact_hash: artifactHash, exit: acceptance && acceptance.status === 'accepted' ? 0 : 1, writer: 'acceptor' });
  }
  rows.push({ kind: 'judgment', task: taskId, run: runId, artifact_hash: diffHash || 'unknown', by: String(actor.keyId || 'agent-judge'), role: String(actor.node || 'judge'), model: String(actor.model || 'unknown'), verdict: String((acceptance && acceptance.status) || 'unknown'), writer: 'acceptor' });
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
  const converted = convertTask(taskDir);
  if (converted.rows.length === 0) return { ok: false, file, problems: converted.problems };
  if (options.force === true) fs.rmSync(file, { force: true });
  for (const row of converted.rows) appendFact(file, row);
  return { ok: true, file, rows: converted.rows.length, problems: converted.problems };
}

if (process.argv[1] && import.meta.url === new URL('file://' + path.resolve(process.argv[1]).split(path.sep).join('/')).href) {
  const argv = process.argv.slice(2);
  const value = (flag) => { const index = argv.indexOf(flag); return index >= 0 ? argv[index + 1] : undefined; };
  const taskDir = value('--task') || process.cwd();
  const workspace = value('--workspace') || path.resolve(taskDir, '..', '..', '..');
  const result = convertToWorkspace(taskDir, workspace, { force: argv.includes('--force') });
  for (const problem of result.problems) console.log('CONVERT PROBLEM ' + problem);
  if (result.ok) console.log('facts-convert: OK — ' + result.file + ' (' + result.rows + ' фактов)');
  else process.exitCode = 1;
}