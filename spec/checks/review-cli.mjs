#!/usr/bin/env node
/*
 * 0158 (R4 письма structure--243): CLI проверяет схему review.json до приёмки.
 *
 * У structure недостающие поля и отсутствие привязки выяснялись на спавне
 * приёмщика — после 15 минут ревью, и лечились новым прогоном.
 *
 *   c1 — валидная запись (decision, привязка к criteria.lock) принимается;
 *   c2 — отказы называют поле: verdict вместо decision, нет привязки, нет файла.
 *
 * Вне пакета — SKIP (конвенция deployed-copy).
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSyncPipeFree } from '../scripts/lib/common.mjs';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PKG = path.resolve(HERE, '..', '..');
if (!fs.existsSync(path.join(PKG, 'spec'))) {
  console.log('SKIP: проверка пакета вне пакета');
  process.exit(0);
}

const mode = String(process.argv[2] || '').toLowerCase();
let bad = 0;
function fail(tag, message) { bad += 1; console.log('FAIL ' + tag + ': ' + message); }

function run(cmd, args, cwd) {
  const r = spawnSyncPipeFree(cmd, args, { cwd, encoding: 'utf8', timeout: 300000 });
  return { code: r.status, out: String(r.stdout || '') + String(r.stderr || '') };
}
function git(cwd, args) { return run('git', ['-C', cwd, ...args], cwd); }
function write(file, text) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, text); }
function copyTree(from, to) {
  fs.mkdirSync(to, { recursive: true });
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    const src = path.join(from, entry.name);
    const dst = path.join(to, entry.name);
    if (entry.isDirectory()) copyTree(src, dst);
    else if (entry.isFile()) fs.copyFileSync(src, dst);
  }
}

/* Фикстура: движок, задание 0001 с замком контракта. */
function makeRepo() {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-review-cli-'));
  git(repo, ['init', '-q']);
  git(repo, ['config', 'user.email', 'p@l']);
  git(repo, ['config', 'user.name', 'p']);
  git(repo, ['config', 'core.autocrlf', 'false']);
  copyTree(path.join(PKG, 'spec'), path.join(repo, 'docs', 'subagent-workflow'));
  const dir = path.join(repo, 'docs', 'tasks', '0001');
  const meta = {
    id: '0001', version: 1, title: 'т', risk: 'low', created: '2026-11-26', owner: 'a',
    executor: 'subagent:executor', acceptor: 'subagent:judge',
    issuedBy: { kind: 'agent', session: 's', model: 'm' }, base: 'HEAD', criteria: 'criteria.json',
    allowedPaths: ['docs/tasks/0001/**'], protectedPaths: [],
    redAllowDirty: ['docs/tasks/0001/**'], hashExclude: [], decisions: [],
  };
  const body = ['# Задание 0001', '', '<!-- TASK-META', JSON.stringify(meta, null, 2), '-->', '',
    '## Цель', '', 'x', '', '## Что не входит', '', 'x.', '', '## Инварианты', '', '1. x.', '',
    '## Границы знания', '', '1. x.', '', '## Среда', '', 'node.', '',
    '<!-- CRITERIA:BEGIN -->', '## Критерии приёмки', '', '| ID | Проверка | Ожидание |', '| --- | --- | --- |',
    '| C1 | node -e "process.exit(0)" | ok |', '<!-- CRITERIA:END -->', '', '## Отчёт', '', '1. x.', '', '## Коммит', '', 'x.', ''].join('\n');
  write(path.join(dir, 'task.md'), body);
  const criteria = {
    task: '0001',
    setup: [],
    teardown: [],
    redExpect: { mustFail: [], mustPass: ['C1'], reasons: {}, noRed: { reason: 'фикстура REVIEW-CLI' } },
    criteria: [{ id: 'C1', title: 't', command: 'node -e "process.exit(0)"', covers: ['docs/tasks/0001/**'], expect: { exitCode: 0 }, tags: ['fast'] }],
  };
  write(path.join(dir, 'criteria.json'), JSON.stringify(criteria, null, 2) + '\n');
  git(repo, ['add', '-A']);
  git(repo, ['commit', '-q', '-m', 'contract']);
  run(process.execPath, [path.join(repo, 'docs', 'subagent-workflow', 'scripts', 'task-hash.mjs'), '--task', 'docs/tasks/0001', '--repo', repo, '--write'], repo);
  return { repo, dir };
}

function cli(repo, args) {
  return run(process.execPath, [path.join(repo, 'docs', 'subagent-workflow', 'scripts', 'check-review.mjs'), ...args], repo);
}

function lockOf(dir) {
  return JSON.parse(fs.readFileSync(path.join(dir, 'criteria.lock'), 'utf8'));
}

if (mode === 'c1') {
  const f = makeRepo();
  try {
    const lock = lockOf(f.dir);
    const review = {
      decision: 'accepted',
      contractCommit: String(lock.contractCommit),
      taskFileSha256: String(lock.taskFileSha256),
      remarks: [],
    };
    const reviewFile = path.join(f.dir, 'review.json');
    fs.writeFileSync(reviewFile, JSON.stringify(review, null, 2) + '\n');
    const r = cli(f.repo, ['--file', reviewFile, '--task', 'docs/tasks/0001']);
    if (r.code !== 0) fail('c1', 'валидная запись отклонена (exit ' + r.code + '): ' + r.out.trim().slice(-400));
    if (!/check-review: ок/u.test(r.out)) fail('c1', 'нет подтверждения: ' + r.out.trim().slice(-300));
    if (!/releaseReady=true/u.test(r.out)) fail('c1', 'не назван releaseReady: ' + r.out.trim().slice(-300));
    /* JSON-режим: та же запись, машинный ответ. */
    const j = cli(f.repo, ['--file', reviewFile, '--task', 'docs/tasks/0001', '--json']);
    if (j.code !== 0) fail('c1', 'JSON-режим отказал: ' + j.out.trim().slice(-300));
    else {
      let parsed = null;
      try { parsed = JSON.parse(j.out); } catch { parsed = null; }
      if (!parsed) fail('c1', 'JSON-ответ не разобрался');
      else if (parsed.ok !== true || parsed.releaseReady !== true) fail('c1', 'JSON: ok=' + parsed.ok + ' releaseReady=' + parsed.releaseReady);
    }
  } finally { fs.rmSync(f.repo, { recursive: true, force: true }); }
  if (bad === 0) console.log('REVIEW-CLI OK c1');
  process.exit(bad === 0 ? 0 : 1);
}

if (mode === 'c2') {
  const f = makeRepo();
  try {
    /* 1. verdict вместо decision — отказ называет поле и подсказывает замену. */
    const verdictFile = path.join(f.dir, 'review-verdict.json');
    fs.writeFileSync(verdictFile, JSON.stringify({ verdict: 'accepted', remarks: [] }, null, 2) + '\n');
    const verdictRun = cli(f.repo, ['--file', verdictFile, '--task', 'docs/tasks/0001']);
    if (verdictRun.code !== 1) fail('c2', 'verdict-запись: код ' + verdictRun.code + ' вместо 1');
    if (!/decision/u.test(verdictRun.out)) fail('c2', 'отказ не называет decision: ' + verdictRun.out.trim().slice(-300));
    if (!/verdict/u.test(verdictRun.out)) fail('c2', 'нет подсказки про verdict: ' + verdictRun.out.trim().slice(-300));

    /* 2. Нет привязки к контракту. */
    const unboundFile = path.join(f.dir, 'review-unbound.json');
    fs.writeFileSync(unboundFile, JSON.stringify({ decision: 'accepted', remarks: [] }, null, 2) + '\n');
    const unboundRun = cli(f.repo, ['--file', unboundFile, '--task', 'docs/tasks/0001']);
    if (unboundRun.code !== 1) fail('c2', 'запись без привязки: код ' + unboundRun.code + ' вместо 1');
    if (!/привязк/u.test(unboundRun.out)) fail('c2', 'отказ не говорит о привязке: ' + unboundRun.out.trim().slice(-300));

    /* 3. Привязка на другую редакцию. */
    const lock = lockOf(f.dir);
    const wrongFile = path.join(f.dir, 'review-wrong.json');
    fs.writeFileSync(wrongFile, JSON.stringify({
      decision: 'accepted',
      contractCommit: 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeef',
      taskFileSha256: String(lock.taskFileSha256),
      remarks: [],
    }, null, 2) + '\n');
    const wrongRun = cli(f.repo, ['--file', wrongFile, '--task', 'docs/tasks/0001']);
    if (wrongRun.code !== 1) fail('c2', 'review на чужую редакцию: код ' + wrongRun.code + ' вместо 1');
    if (!/contractCommit/u.test(wrongRun.out)) fail('c2', 'отказ не называет contractCommit: ' + wrongRun.out.trim().slice(-300));

    /* 4. Нет файла — код 2, а не «отказ по схеме». */
    const missingRun = cli(f.repo, ['--file', path.join(f.dir, 'нет-такого.json'), '--task', 'docs/tasks/0001']);
    if (missingRun.code !== 2) fail('c2', 'нет файла: код ' + missingRun.code + ' вместо 2');

    /* 5. Без --file — тоже код 2. */
    const noArgRun = cli(f.repo, []);
    if (noArgRun.code !== 2) fail('c2', 'без --file: код ' + noArgRun.code + ' вместо 2');
  } finally { fs.rmSync(f.repo, { recursive: true, force: true }); }
  if (bad === 0) console.log('REVIEW-CLI OK c2');
  process.exit(bad === 0 ? 0 : 1);
}

console.log('usage: node spec/checks/review-cli.mjs c1|c2');
process.exit(2);
