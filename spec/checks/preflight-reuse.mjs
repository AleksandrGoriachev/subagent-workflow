#!/usr/bin/env node
/*
 * 2.6.106 (0126): mustPass не исполняется дважды.
 *
 * До 2.6.106 красный прогон сначала гонял mustPass в preflight, а потом весь набор
 * в пуле: selftest и check-tests оплачивались дважды, и красный прогон стоил
 * ~170–180 с вместо ~70. Пулу теперь достаются только критерии, которых не было
 * в preflight, а результаты preflight переносятся как есть.
 *
 * c1: mustPass-критерий, пишущий счётчик запусков, исполняется РОВНО один раз.
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

if (!fs.existsSync(path.join(PKG, 'spec'))) {
  console.log('SKIP: проверка пакета вне пакета');
  process.exit(0);
}

function truthy(value, label) {
  if (!value) throw new Error(label);
}

function run(cmd, args, cwd) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-pfreuse-out-'));
  const outFile = path.join(dir, 'stdout');
  const errFile = path.join(dir, 'stderr');
  const ofd = fs.openSync(outFile, 'w');
  const efd = fs.openSync(errFile, 'w');
  let res;
  try {
    res = spawnSync(cmd, args, { cwd, timeout: 600000, windowsHide: true, stdio: ['ignore', ofd, efd] });
  } finally {
    try { fs.closeSync(ofd); } catch { /* ignore */ }
    try { fs.closeSync(efd); } catch { /* ignore */ }
  }
  let out = '';
  try { out = fs.readFileSync(outFile, 'utf8') + fs.readFileSync(errFile, 'utf8'); } catch { /* ignore */ }
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
  return { code: res.status, out };
}
function git(cwd, args) { return run('git', ['-C', cwd, ...args], cwd); }
function write(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
}
function copyTree(from, to) {
  fs.mkdirSync(to, { recursive: true });
  for (const e of fs.readdirSync(from, { withFileTypes: true })) {
    const s = path.join(from, e.name), t = path.join(to, e.name);
    if (e.isDirectory()) copyTree(s, t); else if (e.isFile()) fs.copyFileSync(s, t);
  }
}

const ID = '0001';
const TASK = 'docs/tasks/' + ID;
const COUNTER = 'c1-runs.txt';

function c1() {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-pfreuse-'));
  try {
    git(repo, ['init', '-q']);
    git(repo, ['config', 'user.email', 'p@l']);
    git(repo, ['config', 'user.name', 'p']);
    git(repo, ['config', 'commit.gpgsign', 'false']);
    copyTree(path.join(PKG, 'spec'), path.join(repo, 'docs', 'subagent-workflow'));
    const dir = path.join(repo, 'docs', 'tasks', ID);
    const meta = {
      id: ID, version: 1, title: 'т', risk: 'low', created: '2026-11-04', owner: 'a',
      executor: 'subagent:executor', acceptor: 'subagent:judge',
      issuedBy: { kind: 'agent', session: 'issuer', model: 'm' }, base: 'HEAD', criteria: 'criteria.json',
      allowedPaths: ['lib/**', TASK + '/**'], protectedPaths: [],
      redAllowDirty: [TASK + '/**'], decisions: [], securityReview: false, humanSignoff: false, followUps: [],
    };
    const body = ['# Задание ' + ID, '', '<!-- TASK-META', JSON.stringify(meta, null, 2), '-->', '', '## Цель', '', 'x', '',
      '## Что не входит', '', 'x.', '', '## Инварианты', '', '1. x.', '', '## Границы знания', '', '1. x.', '',
      '## Среда', '', 'node.', '', '<!-- CRITERIA:BEGIN -->', '## Критерии приёмки', '',
      '| ID | Проверка | Ожидание |', '| --- | --- | --- |',
      '| C1 | счётчик | file |', '| C2 | падение | exit 1 |', '<!-- CRITERIA:END -->',
      '', '## Отчёт', '', '1. x.', '', '## Коммит', '', 'x.', ''].join('\n');
    write(path.join(dir, 'task.md'), body);
    const appendCommand = 'node checks/append.mjs';
    const criteria = {
      task: ID, setup: [], teardown: [],
      redExpect: { mustFail: ['C2'], mustPass: ['C1'], reasons: { C2: 'boom' }, reasonWindow: 25 },
      criteria: [
        { id: 'C1', title: 'счётчик', command: appendCommand, cwd: '.', timeoutMs: 60000, tags: ['fast'], expect: { exitCode: 0 } },
        { id: 'C2', title: 'падение', command: 'node -e "console.log(String.fromCharCode(98,111,111,109));process.exit(1)"', cwd: '.', timeoutMs: 60000, tags: ['fast'], expect: { exitCode: 0 } },
      ],
    };
    /* Вывод через String.fromCharCode: экранирование кавычек в сгенерированном файле — источник ошибок. */
    write(path.join(repo, 'checks', 'append.mjs'),
      "import fs from 'node:fs';" + String.fromCharCode(10)
      + "fs.appendFileSync('" + COUNTER + "', 'x' + String.fromCharCode(10));" + String.fromCharCode(10));
    write(path.join(dir, 'criteria.json'), JSON.stringify(criteria, null, 2) + '\n');
    git(repo, ['add', '-A']);
    git(repo, ['commit', '-q', '-m', 'contract']);
    const hash = run(process.execPath, [path.join(repo, 'docs', 'subagent-workflow', 'scripts', 'task-hash.mjs'), '--task', TASK, '--write'], repo);
    truthy(hash.code === 0, 'task-hash --write не прошёл: ' + hash.out.trim().slice(-300));
    const red = run(process.execPath, [path.join(repo, 'docs', 'subagent-workflow', 'scripts', 'task-red.mjs'), '--task', TASK, '--base', 'HEAD'], repo);
    if (red.code !== 0) {
      let detail = '';
      try { detail = fs.readFileSync(path.join(dir, 'red.log'), 'utf8'); } catch { detail = ''; }
      throw new Error('task-red не доказал красный (exit ' + red.code + '): ' + (String(red.out) + String.fromCharCode(10) + detail).trim().slice(-2000));
    }
    const counter = path.join(repo, COUNTER);
    truthy(fs.existsSync(counter), 'счётчик не создан: mustPass-критерий не исполнялся');
    const lines = fs.readFileSync(counter, 'utf8').replaceAll(String.fromCharCode(13), '').split(String.fromCharCode(10)).filter(Boolean);
    truthy(lines.length === 1, 'mustPass исполнен ' + lines.length + ' раз вместо одного (двойная оплата)');
    const redJson = JSON.parse(fs.readFileSync(path.join(dir, 'red.json'), 'utf8'));
    const c1row = (redJson.results || []).find((row) => row.id === 'C1');
    truthy(Boolean(c1row), 'в red.json нет результата C1');
    truthy(c1row.passed === true, 'C1 в red.json не passed');
  } finally { fs.rmSync(repo, { recursive: true, force: true }); }
  console.log('PFREUSE OK c1');
}

const table = { c1 };
const which = process.argv[2];
if (!table[which]) {
  console.log('usage: node spec/checks/preflight-reuse.mjs c1');
  process.exit(2);
}
try {
  table[which]();
} catch (error) {
  console.log('PFREUSE FAIL ' + which + ': ' + (error && error.message ? error.message : error));
  process.exit(1);
}
