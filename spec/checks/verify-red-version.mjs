#!/usr/bin/env node
/*
 * 2.6.22 (0058, WC-35, продолжение 0057): красный пишет формат v5, значит ворота
 * обязаны его принимать.
 *
 * 0057 добавило в red.json версию 5 (results[].checkDefect, redExpectation.checkDefects/
 * reasonChecks/reasonWindow), но task-verify жёстко требовал версию 4 и отвергал свежий
 * красный прогон: «версия 5 устарела, нужна 4». Дефект нашёл исполнитель 0057 и
 * остановился на границе (файл был вне allowedPaths) — это правильное поведение.
 *
 * Правило: свежий формат (5) и исторический (4) принимаются; любой другой номер —
 * отказ с внятным сообщением, а не молчаливая проверка чужого формата.
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

/*
 * Вывод дочерних процессов — в файлы, а не в пайпы: в ограниченной песочнице
 * spawn с stdio 'pipe' не может открыть именованный канал (EPERM).
 */
function run(cmd, args, cwd) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-vv-out-'));
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
/* Репозиторий с валидным контрактом и красным прогоном нужной версии. */
function makeRepo(redVersion) {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-verifyver-'));
  git(repo, ['init', '-q']);
  git(repo, ['config', 'user.email', 'p@l']);
  git(repo, ['config', 'user.name', 'p']);
  copyTree(path.join(PKG, 'spec'), path.join(repo, 'docs', 'subagent-workflow'));
  const dir = path.join(repo, 'docs', 'tasks', ID);
  const meta = {
    id: ID, version: 1, title: 'т', risk: 'low', created: '2026-11-04', owner: 'a',
    executor: 'subagent:executor', acceptor: 'subagent:judge',
    issuedBy: { kind: 'agent', session: 'issuer', model: 'm' }, base: 'HEAD', criteria: 'criteria.json',
    allowedPaths: ['checks/**', 'docs/tasks/' + ID + '/**'], protectedPaths: [],
    redAllowDirty: ['docs/tasks/' + ID + '/**'], decisions: [], securityReview: false, humanSignoff: false, followUps: [],
  };
  const body = ['# Задание ' + ID, '', '<!-- TASK-META', JSON.stringify(meta, null, 2), '-->', '', '## Цель', '', 'x', '',
    '## Что не входит', '', 'x.', '', '## Инварианты', '', '1. x.', '', '## Границы знания', '', '1. x.', '',
    '## Среда', '', 'node.', '', '<!-- CRITERIA:BEGIN -->', '## Критерии приёмки', '',
    '| ID | Проверка | Ожидание |', '| --- | --- | --- |', '| C1 | node -e "console.log(1)" | exit 0 |', '<!-- CRITERIA:END -->',
    '', '## Отчёт', '', '1. x.', '', '## Коммит', '', 'x.', ''].join('\n');
  write(path.join(dir, 'task.md'), body);
  const criteria = {
    task: ID, setup: [], teardown: [],
    redExpect: { mustFail: [], mustPass: ['C1'], reasons: {}, noRed: { reason: 'документация' } },
    criteria: [{ id: 'C1', title: 't', command: 'node -e "console.log(1)"', cwd: '.', timeoutMs: 60000, tags: ['fast'], expect: { exitCode: 0 } }],
  };
  write(path.join(dir, 'criteria.json'), JSON.stringify(criteria, null, 2) + '\n');
  git(repo, ['add', '-A']);
  git(repo, ['commit', '-q', '-m', 'contract']);
  const hash = run(process.execPath, [path.join(repo, 'docs', 'subagent-workflow', 'scripts', 'task-hash.mjs'), '--task', 'docs/tasks/' + ID, '--write'], repo);
  truthy(hash.code === 0, 'task-hash --write в фикстуре не прошёл: ' + hash.out.trim().slice(-300));
  const lock = JSON.parse(fs.readFileSync(path.join(dir, 'criteria.lock'), 'utf8'));
  const red = {
    version: redVersion,
    kind: 'red',
    task: ID,
    createdAt: '2026-11-04T00:00:00.000Z',
    base: 'HEAD',
    baseSha: lock.contractCommit,
    headSha: lock.contractCommit,
    contractCommit: lock.contractCommit,
    criteriaSha256: lock.criteriaSha256,
    criteriaJsonSha256: lock.criteriaJsonSha256,
    executed: 1,
    finished: 1,
    failed: 0,
    failedIds: [],
    allGreen: true,
    redProven: true,
    redExpectation: { configured: true, ok: true, errors: [], mustFail: [], mustPass: ['C1'] },
    bypasses: {},
    log: 'red.log',
    results: [],
  };
  write(path.join(dir, 'red.json'), JSON.stringify(red, null, 2) + '\n');
  write(path.join(dir, 'red.log'), '# red\n');
  return { repo, dir };
}
function verify(repo) {
  return run(process.execPath, [path.join(repo, 'docs', 'subagent-workflow', 'scripts', 'task-verify.mjs'), '--task', 'docs/tasks/' + ID], repo);
}

function c1() {
  /* Свежий формат: красный прогон 0057 пишет v5 — ворота обязаны его принять. */
  const fresh = makeRepo(5);
  try {
    const r = verify(fresh.repo);
    truthy(r.code === 0, 'task-verify отверг свежий red.json v5 (exit ' + r.code + '): ' + r.out.trim().slice(-300));
    truthy(/Все проверки зелёные/u.test(r.out), 'task-verify не довёл проверку до конца: ' + r.out.trim().slice(-300));
  } finally { fs.rmSync(fresh.repo, { recursive: true, force: true }); }

  /* Исторический формат: записи и артефакты 2.6.21 и раньше остаются читаемыми. */
  const legacy = makeRepo(4);
  try {
    const r = verify(legacy.repo);
    truthy(r.code === 0, 'task-verify отверг исторический red.json v4 (exit ' + r.code + '): ' + r.out.trim().slice(-300));
  } finally { fs.rmSync(legacy.repo, { recursive: true, force: true }); }

  /* Незнакомый формат: отказ с внятным сообщением, а не проверка чужого поля. */
  const alien = makeRepo(6);
  try {
    const r = verify(alien.repo);
    truthy(r.code !== 0, 'task-verify принял неизвестный red.json v6');
    truthy(/верси/u.test(r.out), 'при отказе не сказано про версию: ' + r.out.trim().slice(-300));
  } finally { fs.rmSync(alien.repo, { recursive: true, force: true }); }

  console.log('VERVER OK c1');
}

const table = { c1 };
const which = process.argv[2];
if (!table[which]) {
  console.log('usage: node spec/checks/verify-red-version.mjs c1');
  process.exit(2);
}
try {
  table[which]();
} catch (error) {
  console.log('VERVER FAIL ' + which + ': ' + (error && error.message ? error.message : error));
  process.exit(1);
}
