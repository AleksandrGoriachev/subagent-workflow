#!/usr/bin/env node
/*
 * 0167: лёгкая задача (mode=light) — проверки в TASK-META, без criteria.json и замка.
 *   c1 — критерии синтезируются из meta.checks, verifyLock без замка ok;
 *        обычная задача без criteria.json по-прежнему отказывает;
 *   c2 — линт: light без критериев и замка проходит; light при medium и пустой checks — отказ;
 *   c3 — сквозной task-verify: проходит; падающая проверка даёт exit 1.
 * Вне пакета — SKIP (конвенция deployed-copy).
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSyncPipeFree } from '../scripts/lib/common.mjs';
import { parseCriteria, verifyLock } from '../scripts/lib/common.mjs';
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

function lightMeta(id, { risk = 'low', checks } = {}) {
  return {
    id,
    version: 1,
    title: 'Лёгкая проверка',
    risk,
    created: '2026-11-26',
    owner: 'координатор',
    executor: 'subagent:coordinator',
    acceptor: 'subagent:judge',
    issuedBy: { kind: 'agent', session: 'session-check', model: 'check' },
    base: 'HEAD',
    mode: 'light',
    checks: checks === undefined
      ? [{ id: 'C1', title: 'Проверка', command: 'node -e "process.exit(0)"', expect: { exitCode: 0 } }]
      : checks,
    allowedPaths: ['tools/**'],
    redAllowDirty: ['docs/tasks/' + id + '/**'],
    decisions: [{ id: 'D1', class: 'mechanical', question: 'Как проверяется', chosen: 'Наблюдаемой командой', options: ['Командой'], impact: 'internal', evidence: { kind: 'criterion', ref: 'C1' }, reversible: true }],
    resultShape: { artifact: 'файл', format: 'код', criterion: 'C1' },
    securityReview: false,
    humanSignoff: false,
    followUps: [],
  };
}

function taskText(id, meta) {
  return [
    '# Задание ' + id + '. Лёгкая проверка',
    '',
    '<!-- TASK-META',
    JSON.stringify(meta, null, 2),
    '-->',
    '',
    '## Цель', '', 'Проверить поведение.', '',
    '## Что не входит', '', '1. Ничего.', '',
    '## Инварианты', '', '1. Проверка наблюдаемая.', '',
    '## Границы знания', '', '1. Только allowedPaths.', '',
    '## Среда', '', 'node 25.', '',
    '## Критерии приёмки', '',
    '<!-- CRITERIA:BEGIN -->',
    '| ID | Проверка | Ожидание |',
    '| --- | --- | --- |',
    '| C1 | `node -e "process.exit(0)"` | `exit 0` |', '',
    '<!-- CRITERIA:END -->', '',
    '## Отчёт', '', 'Отчёт — критерии.', '',
    '## Коммит', '', 'По правилам движка.', '',
  ].join('\n');
}

function makeTaskDir(root, id, meta) {
  const dir = path.join(root, 'docs', 'tasks', id);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'task.md'), taskText(id, meta));
  return dir;
}

function run(cmd, args, cwd) {
  const r = spawnSyncPipeFree(cmd, args, { cwd, encoding: 'utf8', timeout: 180000 });
  return { code: r.status, out: String(r.stdout || '') + String(r.stderr || '') };
}

function git(dir, args) { return run('git', ['-c', 'core.hooksPath=.git/empty-hooks', ...args], dir); }

if (mode === 'c1') {
  const root = makeRepo();
  try {
    const meta = lightMeta('0701');
    const dir = makeTaskDir(root, '0701', meta);
    git(root, ['add', 'docs/tasks/0701']);
    const commit = git(root, ['commit', '-q', '-m', 'contract 0701']);
    if (commit.code !== 0) fail('c1', 'не удалось закоммитить контракт: ' + commit.out);
    const criteria = parseCriteria(dir, meta);
    if (criteria.light !== true) fail('c1', 'parseCriteria не пометил лёгкую задачу');
    if (criteria.criteria.length !== 1 || criteria.criteria[0].id !== 'C1') fail('c1', 'проверки из meta.checks не синтезированы');
    if (fs.existsSync(path.join(dir, 'criteria.json'))) fail('c1', 'parseCriteria создал criteria.json — файла быть не должно');
    const lock = verifyLock(root, dir, meta, fs.readFileSync(path.join(dir, 'task.md'), 'utf8'), criteria);
    if (lock.ok !== true) fail('c1', 'verifyLock отказал лёгкой задаче без замка: ' + JSON.stringify(lock.errors || []));

    /* Контроль: обычная задача без criteria.json по-прежнему отказывает. */
    const plainMeta = { ...meta, mode: undefined, checks: undefined };
    const plainDir = makeTaskDir(root, '0702', plainMeta);
    let threw = false;
    try { parseCriteria(plainDir, plainMeta); } catch (error) { threw = /criteria\.json/u.test(String(error.message)); }
    if (!threw) fail('c1', 'обычная задача без criteria.json не отказала');

    /* Негатив: пустой checks — отказ. */
    const emptyMeta = lightMeta('0703', { checks: [] });
    const emptyDir = makeTaskDir(root, '0703', emptyMeta);
    let emptyThrew = false;
    try { parseCriteria(emptyDir, emptyMeta); } catch (error) { emptyThrew = /checks пуст/u.test(String(error.message)); }
    if (!emptyThrew) fail('c1', 'пустой checks не отказал');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
  if (bad === 0) console.log('LIGHT-TASK OK c1');
  process.exit(bad === 0 ? 0 : 1);
}

if (mode === 'c2') {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-light-c2-'));
  try {
    makeTaskDir(root, '0704', lightMeta('0704'));
    const ok = run(process.execPath, [path.join(PKG, 'spec', 'scripts', 'task-lint.mjs'), '--task', path.join(root, 'docs', 'tasks', '0704'), '--repo', root], PKG);
    if (ok.code !== 0) fail('c2', 'линт лёгкой задачи отказал: ' + ok.out.trim().slice(-500));
    if (/criteria\.lock отсутствует/u.test(ok.out)) fail('c2', 'линт требует замок у лёгкой задачи');

    makeTaskDir(root, '0705', lightMeta('0705', { risk: 'medium' }));
    const medium = run(process.execPath, [path.join(PKG, 'spec', 'scripts', 'task-lint.mjs'), '--task', path.join(root, 'docs', 'tasks', '0705'), '--repo', root], PKG);
    if (medium.code === 0) fail('c2', 'light при medium прошёл линт');
    if (!/mode=light/u.test(medium.out) || !/risk=low/u.test(medium.out)) fail('c2', 'отказ при medium не назвал правило: ' + medium.out.trim().slice(-400));

    makeTaskDir(root, '0706', lightMeta('0706', { checks: [] }));
    const empty = run(process.execPath, [path.join(PKG, 'spec', 'scripts', 'task-lint.mjs'), '--task', path.join(root, 'docs', 'tasks', '0706'), '--repo', root], PKG);
    if (empty.code === 0) fail('c2', 'пустой checks прошёл линт');
    if (!/checks/u.test(empty.out)) fail('c2', 'пустой checks не назван: ' + empty.out.trim().slice(-400));
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
  if (bad === 0) console.log('LIGHT-TASK OK c2');
  process.exit(bad === 0 ? 0 : 1);
}

function makeRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-light-c3-'));
  git(dir, ['init', '-q']);
  git(dir, ['config', 'user.email', 'check@example.invalid']);
  git(dir, ['config', 'user.name', 'check']);
  fs.writeFileSync(path.join(dir, 'README.md'), 'base\n');
  git(dir, ['add', 'README.md']);
  git(dir, ['commit', '-q', '-m', 'base']);
  return dir;
}

if (mode === 'c3') {
  const repo = makeRepo();
  try {
    makeTaskDir(repo, '0707', lightMeta('0707'));
    fs.mkdirSync(path.join(repo, 'tools'), { recursive: true });
    fs.writeFileSync(path.join(repo, 'tools', 'a.mjs'), 'export const a = 1;\n');
    git(repo, ['add', 'docs/tasks/0707', 'tools/a.mjs']);
    const commit = git(repo, ['commit', '-q', '-m', 'contract 0707']);
    if (commit.code !== 0) fail('c3', 'не удалось закоммитить контракт: ' + commit.out);
    const ok = run(process.execPath, [path.join(PKG, 'spec', 'scripts', 'task-verify.mjs'), '--task', 'docs/tasks/0707', '--repo', repo, '--allow-missing-red'], repo);
    if (ok.code !== 0) fail('c3', 'verify лёгкой задачи отказал: ' + ok.out.trim().slice(-800));
    const verifyFile = path.join(repo, 'docs', 'tasks', '0707', 'verify.json');
    if (!fs.existsSync(verifyFile)) fail('c3', 'verify.json не создан');
    else {
      const record = JSON.parse(fs.readFileSync(verifyFile, 'utf8'));
      const checks = Array.isArray(record.results) ? record.results : (Array.isArray(record.criteria) ? record.criteria : []);
      if (!checks.some((item) => String(item.id) === 'C1')) fail('c3', 'в verify.json нет проверки C1: ' + JSON.stringify(checks).slice(0, 200));
    }

    /* Негатив: падающая проверка даёт exit 1, а не тихий зелёный. */
    const badChecks = [{ id: 'C1', title: 'Проверка', command: 'node -e "process.exit(1)"', expect: { exitCode: 0 } }];
    makeTaskDir(repo, '0708', lightMeta('0708', { checks: badChecks }));
    git(repo, ['add', 'docs/tasks/0708']);
    git(repo, ['commit', '-q', '-m', 'contract 0708']);
    const failed = run(process.execPath, [path.join(PKG, 'spec', 'scripts', 'task-verify.mjs'), '--task', 'docs/tasks/0708', '--repo', repo, '--allow-missing-red'], repo);
    if (failed.code === 0) fail('c3', 'падающая проверка дала зелёный verify');
    if (!/C1/u.test(failed.out) || !/FAIL/u.test(failed.out)) fail('c3', 'падение не названо: ' + failed.out.trim().slice(-400));
  } finally { fs.rmSync(repo, { recursive: true, force: true }); }
  if (bad === 0) console.log('LIGHT-TASK OK c3');
  process.exit(bad === 0 ? 0 : 1);
}

console.log('usage: node spec/checks/light-task.mjs c1|c2|c3');
process.exit(2);
