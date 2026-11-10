#!/usr/bin/env node
/**
 * 0140 (WC-81): запечатанный прогон — held-out проверка, которую исполнитель не
 * видит в своём дереве.
 *
 * Честная граница (L1): тесты НЕ изолированы от чтения на уровне ОС — одна учётная
 * запись, значит любой путь читаем. Что реально закрывается уже сейчас:
 *  1) содержимое теста не лежит в рабочем дереве и не попадает в дифф;
 *  2) хеш теста закреплён в контракте (TASK-META.sealedTest) — подмена ловится;
 *  3) прогон делает приёмщик, исполнитель не может «пропустить» его молча:
 *     в фактах нет evidence(gate=sealed) — C2 краснеет.
 *
 * Полная изоляция — отдельный уровень (L2: отдельный пользователь ОС/контейнер).
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { spawnSyncPipeFree } from './lib/common.mjs';
import { appendFact, factFileOf, sha256Text, signFact } from '../lib/facts.mjs';
import { parseTaskMeta } from './lib/common.mjs';

function sha256File(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

/**
 * Прочитать запечатанный тест из контракта задачи.
 * @returns {{ok: boolean, seal?: object, problems: string[]}}
 */
export function readSeal(taskDir) {
  const dir = path.resolve(String(taskDir));
  const taskMd = path.join(dir, 'task.md');
  if (!fs.existsSync(taskMd)) return { ok: false, problems: ['нет task.md: контракт не прочитать'] };
  const meta = parseTaskMeta(fs.readFileSync(taskMd, 'utf8')) || {};
  const seal = meta.sealedTest;
  if (!seal || typeof seal !== 'object') return { ok: false, problems: ['контракт не объявляет sealedTest — запечатанного прогона нет'] };
  const file = typeof seal.path === 'string' ? seal.path.trim() : '';
  const hash = typeof seal.hash === 'string' ? seal.hash.trim().toLowerCase() : '';
  if (file === '' || hash === '') return { ok: false, problems: ['sealedTest требует path и hash'] };
  if (!/^[0-9a-f]{64}$/u.test(hash)) return { ok: false, problems: ['sealedTest.hash — не sha256: нужно 64 шестнадцатеричных знака'] };
  return { ok: true, seal: { path: file, hash }, problems: [] };
}

/**
 * Прогнать запечатанный тест: проверить хеш, выполнить, записать факт.
 * @returns {{ok: boolean, exit?: number, problems: string[]}}
 */
export function runSealed(taskDir, workspace, options = {}) {
  const dir = path.resolve(String(taskDir));
  const taskId = path.basename(dir);
  const sealRead = readSeal(dir);
  if (!sealRead.ok) return { ok: false, problems: sealRead.problems };
  const sealFile = path.isAbsolute(sealRead.seal.path) ? sealRead.seal.path : path.resolve(dir, sealRead.seal.path);
  if (!fs.existsSync(sealFile)) return { ok: false, problems: ['запечатанного теста нет по пути ' + sealFile] };
  /* Запрет: тест внутри рабочего дерева — это уже не held-out. */
  const workspacePath = path.resolve(String(workspace || path.resolve(dir, '..', '..', '..')));
  const relInside = path.relative(workspacePath, sealFile);
  if (!relInside.startsWith('..') && !path.isAbsolute(relInside)) {
    return { ok: false, problems: ['запечатанный тест лежит внутри воркспейса (' + sealFile + '): это не held-out, вынесите файл за пределы дерева'] };
  }
  /*
   * 0143: seal берётся из task.md, а task.md — изменяемый файл. Связываем его с
   * контрактом: хеш task.md должен совпадать с acceptance.taskFileSha256. Иначе
   * seal «подписывается» тем, кто может править контракт после приёмки.
   */
  const acceptanceFile = path.join(dir, 'acceptance.json');
  if (fs.existsSync(acceptanceFile)) {
    const acceptance = JSON.parse(fs.readFileSync(acceptanceFile, 'utf8').replace(/^\uFEFF/u, ''));
    if (acceptance && typeof acceptance.taskFileSha256 === 'string' && acceptance.taskFileSha256 !== '') {
      const taskMdFile = path.join(dir, 'task.md');
      const actualTaskHash = sha256File(taskMdFile);
      if (actualTaskHash !== acceptance.taskFileSha256) {
        return { ok: false, problems: ['task.md изменён после приёмки контракта: seal не может быть подтверждён (ожидался ' + acceptance.taskFileSha256.slice(0, 12) + '…, сейчас ' + actualTaskHash.slice(0, 12) + '…)'] };
      }
    }
  }
  const actual = sha256File(sealFile);
  if (actual !== sealRead.seal.hash) {
    return { ok: false, problems: ['хеш запечатанного теста не совпадает с контрактом (' + actual.slice(0, 12) + '… != ' + sealRead.seal.hash.slice(0, 12) + '…)'] };
  }
  /*
   * 0143: без пайпов — иначе в ограниченной сессии DSH будет EPERM (WC-37/39),
   * и C2 получит ложный отказ «нет доказательства» вместо честного прогона.
   */
  const spawned = spawnSyncPipeFree(process.execPath, [sealFile], { cwd: workspacePath, timeout: options.timeoutMs || 600000 });
  const exit = typeof spawned.status === 'number' ? spawned.status : 1;
  const output = String(spawned.stdout || '') + String(spawned.stderr || '');
  const logFile = path.join(dir, 'sealed.log');
  fs.writeFileSync(logFile, output || '(без вывода)\n');
  const runId = taskId + ':1';
  const artifactHash = sha256Text(fs.readFileSync(logFile, 'utf8'));
  if (options.record !== false) {
    const file = factFileOf(workspacePath, taskId);
    const existing = fs.existsSync(file) ? fs.readFileSync(file, 'utf8').split('\n').filter((line) => line.trim() !== '') : [];
    if (existing.length === 0) {
      return { ok: false, problems: ['нет файла фактов задачи — сначала facts-convert: ' + file], log: logFile };
    }
    const row = { kind: 'evidence', task: taskId, run: runId, gate: 'sealed', artifact_hash: artifactHash, exit, seal_hash: sealRead.seal.hash, verdict: exit === 0 ? 'passed' : 'failed', writer: 'acceptor' };
    /* 0145: доказательство подписывается в appendFact — когда prev уже известен. */
    const keyFile = options.factsKey || path.join(os.homedir(), '.wf-keys', path.basename(workspacePath), 'agent-facts.key.pem');
    const signed = fs.existsSync(keyFile) ? { ...row, signRequest: { keyId: options.factsKeyId || 'agent-facts', privateKeyPem: fs.readFileSync(keyFile, 'utf8') } } : row;
    appendFact(file, signed);
  }
  return { ok: exit === 0, exit, problems: exit === 0 ? [] : ['запечатанный тест упал с кодом ' + exit], log: logFile, hash: sealRead.seal.hash };
}

if (process.argv[1] && import.meta.url === new URL('file://' + path.resolve(process.argv[1]).split(path.sep).join('/')).href) {
  const argv = process.argv.slice(2);
  const value = (flag) => { const index = argv.indexOf(flag); return index >= 0 ? argv[index + 1] : undefined; };
  const taskDir = value('--task') || process.cwd();
  const workspace = value('--workspace') || path.resolve(taskDir, '..', '..', '..');
  const result = runSealed(taskDir, workspace, { record: !argv.includes('--no-record') });
  for (const problem of result.problems) console.log('SEALED PROBLEM ' + problem);
  if (result.ok) console.log('sealed-run: OK — ' + result.log + ' (' + String(result.hash).slice(0, 12) + '…)');
  else process.exitCode = 1;
}