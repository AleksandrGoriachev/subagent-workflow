#!/usr/bin/env node
/*
 * 2.6.23 (0059, WC-37): инструменты пакета не должны зависеть от пайпов.
 *
 * В ограниченной песочнице DSH процесс не может открыть именованный канал: spawn
 * с stdio 'pipe' (в том числе по умолчанию у spawnSync/execFileSync/execSync)
 * падает с EPERM. Из-за этого в такой сессии не шли selftest, e2e, gate-rules,
 * release-hygiene и даже task-check-acceptance — приёмку приходилось проверять
 * руками. Ворота (task-red/verify/accept) всегда работали, потому что runCommand
 * и runSync в lib/common.mjs пишут вывод во временные файлы и отдают их в stdio.
 *
 * 2.6.30 (0071, WC-39): проверено и на самих проверках — spec/checks/*.mjs переведены
 * на тот же помощник, и c1 сканирует их вместе с движком и инструментами.
 *
 * Здесь два обязательства:
 *  - c1: в движке, инструментах и проверках нет спавнов с пайпами (статическая проверка);
 *  - c2: общий помощник spawnSyncPipeFree существует и ведёт себя как spawnSync
 *        (status/stdout/stderr, коды возврата, Buffer-режим);
 *  - c3..c5: то, что раньше не запускалось, работает (selftest, e2e,
 *        task-check-acceptance на реальной записи).
 *
 * Почему нет динамического «запусти под EPERM»: ограничение живёт в песочнице
 * харнесса, а не в Node; подменить его из процесса нельзя (проверено — правка
 * child_process через --import не видна именованным ESM-импортам). Поэтому
 * доказательство — статическое (c1) плюс исполнение тех же путей (c3..c5).
 *
 * Вне пакета — SKIP (конвенция deployed-copy).
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PKG = path.resolve(HERE, '..', '..');

if (!fs.existsSync(path.join(PKG, 'spec'))) {
  console.log('SKIP: проверка пакета вне пакета');
  process.exit(0);
}

function truthy(value, label) {
  if (!value) throw new Error(label);
}

/* Вывод дочерних процессов — в файлы: проверка сама обязана быть примером правила. */
function run(cmd, args, cwd) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-pf-out-'));
  const outFile = path.join(dir, 'stdout');
  const errFile = path.join(dir, 'stderr');
  const ofd = fs.openSync(outFile, 'w');
  const efd = fs.openSync(errFile, 'w');
  let res;
  try {
    res = spawnSync(cmd, args, { cwd, timeout: 900000, windowsHide: true, stdio: ['ignore', ofd, efd] });
  } finally {
    try { fs.closeSync(ofd); } catch { /* ignore */ }
    try { fs.closeSync(efd); } catch { /* ignore */ }
  }
  let out = '';
  try { out = fs.readFileSync(outFile, 'utf8') + fs.readFileSync(errFile, 'utf8'); } catch { /* ignore */ }
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
  return { code: res.status, out };
}

/* ---------- статический поиск спавнов с пайпами ---------- */

/* Комментарии не считаем: пример в комментарии — не вызов. */
function stripComments(text) {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').map((line) => line.replace(/\/\/.*$/, '')).join('\n');
}

/* Тело вызова от открывающей скобки до парной закрывающей. */
function callBody(text, openIndex) {
  let depth = 0;
  for (let i = openIndex; i < text.length; i += 1) {
    const ch = text[i];
    if (ch === '(') depth += 1;
    else if (ch === ')') { depth -= 1; if (depth === 0) return text.slice(openIndex, i + 1); }
  }
  return text.slice(openIndex, Math.min(text.length, openIndex + 800));
}

/* Не считаем методы: RegExp.prototype.exec тоже кончается на «exec(». */
const PIPED_API = /(?<![\w$.])(spawnSync|execFileSync|execSync|spawn|execFile|exec)\s*\(/g;

export function pipeFindings(text) {
  const clean = stripComments(text);
  const findings = [];
  PIPED_API.lastIndex = 0;
  let m;
  while ((m = PIPED_API.exec(clean)) !== null) {
    const body = callBody(clean, m.index + m[0].length - 1);
    const hasStdio = /\bstdio\s*:/.test(body);
    const pipes = hasStdio ? /['"]pipe['"]/.test(body) : true;
    if (pipes) findings.push({ api: m[1], body: body.replace(/\s+/g, ' ').slice(0, 160) });
  }
  return findings;
}

const SCAN_DIRS = ['spec', 'tools'];
/* 0071 (WC-39): spec/checks больше не исключается — проверки обязаны быть примером правила. */
const SCAN_EXCLUDE = ['spec/templates', 'docs/subagent-workflow', 'node_modules', '.tmp', 'dist', 'vendor', 'docs/tasks'];

function scanFiles() {
  const files = [];
  const walk = (rel) => {
    const abs = path.join(PKG, rel);
    if (!fs.existsSync(abs)) return;
    for (const entry of fs.readdirSync(abs, { withFileTypes: true })) {
      const childRel = rel + '/' + entry.name;
      if (SCAN_EXCLUDE.some((prefix) => childRel === prefix || childRel.startsWith(prefix + '/'))) continue;
      if (entry.isDirectory()) walk(childRel);
      else if (entry.name.endsWith('.mjs') || entry.name.endsWith('.js')) files.push(childRel);
    }
  };
  for (const dir of SCAN_DIRS) walk(dir);
  return files;
}

function c1() {
  const hits = [];
  for (const rel of scanFiles()) {
    const text = fs.readFileSync(path.join(PKG, rel), 'utf8');
    for (const finding of pipeFindings(text)) hits.push(rel + ': ' + finding.api + ' -> ' + finding.body);
  }
  truthy(hits.length === 0, 'спавны с пайпами (' + hits.length + '): ' + hits.slice(0, 6).join(' | '));
  console.log('PIPEFREE OK c1');
}

/* ---------- помощник ---------- */

function c2() {
  const file = path.join(PKG, 'spec', 'scripts', 'lib', 'common.mjs');
  truthy(fs.existsSync(file), 'нет spec/scripts/lib/common.mjs');
  const text = fs.readFileSync(file, 'utf8');
  truthy(/export function spawnSyncPipeFree\b/.test(text), 'в common.mjs нет export function spawnSyncPipeFree');
  return import(pathToFileURL(file).href).then((common) => {
    const spawnSyncPipeFree = common.spawnSyncPipeFree;
    truthy(typeof spawnSyncPipeFree === 'function', 'spawnSyncPipeFree не функция');
    const ok = spawnSyncPipeFree(process.execPath, ['-e', 'console.log("hello")']);
    truthy(ok && ok.status === 0, 'успешный вызов дал status=' + (ok && ok.status));
    truthy(String(ok.stdout).trim() === 'hello', 'stdout не пойман: ' + JSON.stringify(ok.stdout));
    const bad = spawnSyncPipeFree(process.execPath, ['-e', 'console.error("boom");process.exit(3)']);
    truthy(bad && bad.status === 3, 'код возврата потерян: status=' + (bad && bad.status));
    truthy(/boom/.test(String(bad.stderr)), 'stderr не пойман: ' + JSON.stringify(bad.stderr));
    const buf = spawnSyncPipeFree(process.execPath, ['-e', 'process.stdout.write("x")'], { encoding: 'buffer' });
    truthy(buf && Buffer.isBuffer(buf.stdout), 'Buffer-режим не поддержан (git show в task-check-acceptance)');
    const missing = spawnSyncPipeFree(path.join(os.tmpdir(), 'wf-no-such-binary-' + Date.now()), [], {});
    truthy(missing && missing.error, 'отсутствующий бинарник не вернул error');
    console.log('PIPEFREE OK c2');
  });
}

function c3() {
  const r = run(process.execPath, [path.join(PKG, 'spec', 'selftest.mjs')], PKG);
  truthy(r.code === 0, 'selftest exit ' + r.code + ': ' + r.out.trim().slice(-400));
  truthy(/SELFTEST OK/.test(r.out), 'selftest не сказал SELFTEST OK: ' + r.out.trim().slice(-400));
  console.log('PIPEFREE OK c3');
}

function c4() {
  const taskDir = path.join(PKG, 'docs', 'tasks', '0058');
  truthy(fs.existsSync(path.join(taskDir, 'acceptance.json')), 'нет записи 0058 для проверки');
  const r = run(process.execPath, [
    path.join(PKG, 'spec', 'scripts', 'task-check-acceptance.mjs'),
    '--file', 'docs/tasks/0058/acceptance.json',
    '--repo', '.',
    '--keys', 'docs/subagent-workflow/acceptors.json',
    '--task', 'docs/tasks/0058',
    '--metadata', 'febc239',
  ], PKG);
  truthy(r.code === 0, 'task-check-acceptance exit ' + r.code + ': ' + r.out.trim().slice(-400));
  console.log('PIPEFREE OK c4');
}

function c5() {
  const r = run(process.execPath, [path.join(PKG, 'spec', 'e2e.mjs')], PKG);
  truthy(r.code === 0, 'e2e exit ' + r.code + ': ' + r.out.trim().slice(-400));
  console.log('PIPEFREE OK c5');
}

const table = { c1, c2, c3, c4, c5 };
const which = process.argv[2];
if (!table[which]) {
  console.log('usage: node spec/checks/pipe-free.mjs c1|c2|c3|c4|c5');
  process.exit(2);
}
try {
  await table[which]();
} catch (error) {
  console.log('PIPEFREE FAIL ' + which + ': ' + (error && error.message ? error.message : error));
  process.exit(1);
}
