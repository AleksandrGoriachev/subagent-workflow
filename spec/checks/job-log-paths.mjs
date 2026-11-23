#!/usr/bin/env node
/*
 * 2.6.104 (0122): путь к логу задания виден сразу, содержимое — командой.
 *
 * Замер structure (docs/analysis/subagents-workflow-causes.md): 38 событий в 27
 * сессиях «cannot read ... .tmp/jobs/<id>.log: not found». Файл при этом есть
 * всегда: job.mjs создаёт его ДО печати JOB, но печатал только id, а каталог
 * заданий привязан к корню, где лежит job.mjs: в пакете <repo>/.tmp/jobs, в
 * развёрнутой копии <repo>/docs/subagent-workflow/.tmp/jobs. Агент искал у корня
 * репозитория и получал not found.
 *
 * c1: start печатает JOB и LOG <абсолютный путь>, файл существует сразу; log <id>
 *     отдаёт содержимое; wait --tail N — вердикт первой строкой и хвост за ним.
 * c2: log несуществующего id — отказ кодом 3 с причиной.
 * c3: без --tail хвоста нет (вердикт не замусорен).
 *
 * Вне пакета — SKIP (конвенция deployed-copy).
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PKG = path.resolve(HERE, '..', '..');
const JOB = path.join(PKG, 'spec', 'scripts', 'job.mjs');

if (!fs.existsSync(path.join(PKG, 'spec'))) {
  console.log('SKIP: проверка пакета вне пакета');
  process.exit(0);
}

function truthy(value, label) {
  if (!value) throw new Error(label);
}

/* Вывод дочерних процессов — в файлы, а не в пайпы: песочница не даёт именованных каналов. */
function run(cmd, args, cwd) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-joblp-out-'));
  const outFile = path.join(dir, 'stdout');
  const errFile = path.join(dir, 'stderr');
  const ofd = fs.openSync(outFile, 'w');
  const efd = fs.openSync(errFile, 'w');
  let res;
  try {
    res = spawnSync(cmd, args, { cwd, timeout: 300000, windowsHide: true, stdio: ['ignore', ofd, efd] });
  } finally {
    try { fs.closeSync(ofd); } catch { /* ignore */ }
    try { fs.closeSync(efd); } catch { /* ignore */ }
  }
  let out = '';
  let err = '';
  try { out = fs.readFileSync(outFile, 'utf8'); } catch { /* ignore */ }
  try { err = fs.readFileSync(errFile, 'utf8'); } catch { /* ignore */ }
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
  return { code: res.status, out, err };
}
function job(args) { return run(process.execPath, [JOB, ...args], PKG); }
function firstLine(text) { return String(text).replaceAll(String.fromCharCode(13), '').split(String.fromCharCode(10))[0] || ''; }

const CHILD = "console.log('MARK-A');console.log('MARK-B')";

function startJob() {
  const started = job(['start', '--', process.execPath, '-e', CHILD]);
  const head = firstLine(started.out);
  const idMatch = /^JOB ([0-9a-f]{12})$/u.exec(head);
  truthy(Boolean(idMatch), 'первая строка start не «JOB <12hex>»: ' + JSON.stringify(head));
  const logMatch = /^LOG (.+)$/u.exec(String(started.out).replaceAll(String.fromCharCode(13), '').split(String.fromCharCode(10))[1] || '');
  truthy(Boolean(logMatch), 'вторая строка start не «LOG <путь>»');
  return { id: idMatch[1], logPath: logMatch[1].trim(), started };
}

function c1() {
  const job1 = startJob();
  truthy(path.isAbsolute(job1.logPath), 'путь лога не абсолютный: ' + job1.logPath);
  truthy(fs.existsSync(job1.logPath), 'файла лога нет сразу после start: ' + job1.logPath);

  const waited = job(['wait', job1.id, '--timeout', '60', '--interval', '1', '--tail', '2']);
  truthy(waited.code === 0, 'wait завершился кодом ' + waited.code);
  const lines = String(waited.out).replaceAll(String.fromCharCode(13), '').split(String.fromCharCode(10));
  truthy(/^DONE [0-9a-f]{12} exit=0\b/u.test(lines[0] || ''), 'первая строка wait не DONE: ' + JSON.stringify(lines[0]));
  truthy(/log tail/u.test(waited.out), 'после DONE нет хвоста лога');
  truthy(/MARK-B/u.test(waited.out), 'хвост лога не содержит MARK-B');

  const logged = job(['log', job1.id]);
  truthy(logged.code === 0, 'log завершился кодом ' + logged.code);
  truthy(/MARK-A/u.test(logged.out) && /MARK-B/u.test(logged.out), 'log не отдал содержимое: ' + JSON.stringify(logged.out));
  console.log('JOBLP OK c1');
}

function c2() {
  const missing = job(['log', '000000000000']);
  truthy(missing.code === 3, 'log несуществующего задания вернул код ' + missing.code + ', ожидался 3');
  truthy(/нет задания/u.test(missing.err), 'отказ не называет причину: ' + JSON.stringify(missing.err));
  console.log('JOBLP OK c2');
}

function c3() {
  const job3 = startJob();
  const waited = job(['wait', job3.id, '--timeout', '60', '--interval', '1']);
  truthy(waited.code === 0, 'wait завершился кодом ' + waited.code);
  truthy(/^DONE /u.test(firstLine(waited.out)), 'нет вердикта DONE');
  truthy(!/log tail/u.test(waited.out), 'без --tail хвост всё равно напечатан');
  const zero = job(['wait', job3.id, '--timeout', '10', '--interval', '1', '--tail', '0']);
  truthy(zero.code === 0, 'wait --tail 0 завершился кодом ' + zero.code);
  truthy(!/log tail/u.test(zero.out), '--tail 0 не отключил хвост');
  console.log('JOBLP OK c3');
}

const table = { c1, c2, c3 };
const which = process.argv[2];
if (!table[which]) {
  console.log('usage: node spec/checks/job-log-paths.mjs c1|c2|c3');
  process.exit(2);
}
try {
  table[which]();
} catch (error) {
  console.log('JOBLP FAIL ' + which + ': ' + (error && error.message ? error.message : error));
  process.exit(1);
}
