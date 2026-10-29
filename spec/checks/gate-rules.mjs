#!/usr/bin/env node
/* Задание 0019: правила ворот (2.6.4).
 * F-7: пересечение allowedPaths и protectedPaths — ошибка lint.
 * F-5: low без красного — только явный redExpect.noRed { reason }.
 * F-6: причины красного — дословная подстрока; при несовпадении task-red печатает вывод.
 * F-8: verify.json исполнителя сохраняется как verify.executor.json даже при отказе приёмки. */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PKG = path.resolve(HERE, '..', '..');
let failed = 0;
const pass = (n) => console.log('PASS ' + n);
const fail = (n, d) => { failed += 1; console.log('FAIL ' + n + (d ? ' — ' + d : '')); };

function run(cmd, args, cwd, env) {
  const r = spawnSync(cmd, args, { cwd, encoding: 'utf8', timeout: 600000, env: env || process.env });
  return { code: r.status, out: String(r.stdout || '') + String(r.stderr || '') };
}
function git(cwd, args) { return run('git', ['-C', cwd, ...args], cwd); }
function write(file, text) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, text); }
function copyTree(from, to) {
  fs.mkdirSync(to, { recursive: true });
  for (const e of fs.readdirSync(from, { withFileTypes: true })) {
    const s = path.join(from, e.name), t = path.join(to, e.name);
    if (e.isDirectory()) copyTree(s, t); else if (e.isFile()) fs.copyFileSync(s, t);
  }
}
function repoWithTask({ id = '0001', risk = 'low', allowed, protectedPaths = [], criteria = {}, meta = {} }) {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-gate-'));
  git(repo, ['init', '-q']); git(repo, ['config', 'user.email', 'p@l']); git(repo, ['config', 'user.name', 'p']);
  copyTree(path.join(PKG, 'spec'), path.join(repo, 'docs', 'subagent-workflow'));
  const dir = path.join(repo, 'docs', 'tasks', id);
  const m = {
    id, version: 1, title: 'т', risk, created: '2026-10-29', owner: 'a',
    executor: 'subagent:executor', acceptor: 'subagent:judge',
    issuedBy: { kind: 'agent', session: 'issuer', model: 'm' }, base: 'HEAD', criteria: 'criteria.json',
    allowedPaths: allowed, protectedPaths, redAllowDirty: ['docs/tasks/' + id + '/**'], hashExclude: [], decisions: [],
    ...meta,
  };
  const body = ['# Задание ' + id, '', '<!-- TASK-META', JSON.stringify(m, null, 2), '-->', '', '## Цель', '', 'x', '', '## Что не входит', '', 'x.', '', '## Инварианты', '', '1. x.', '', '## Границы знания', '', '1. x.', '', '## Среда', '', 'node.', '', '## Что сделать', '', '1. x.', '', '<!-- CRITERIA:BEGIN -->', '## Критерии приёмки', '', '| ID | Проверка | Ожидание |', '| --- | --- | --- |', '| C1 | node -e "console.log(1)" | exit 0 |', '<!-- CRITERIA:END -->', '', '## Отчёт', '', '1. x.', '', '## Коммит', '', 'x.', ''].join('\n');
  write(path.join(dir, 'task.md'), body);
  const c = { task: id, criteria: [{ id: 'C1', title: 't', command: 'node -e "console.log(1)"', expect: { exitCode: 0 }, tags: ['fast'] }], ...criteria };
  write(path.join(dir, 'criteria.json'), JSON.stringify(c, null, 2) + '\n');
  git(repo, ['add', '-A']); git(repo, ['commit', '-q', '-m', 'contract']);
  run(process.execPath, [path.join(repo, 'docs', 'subagent-workflow', 'scripts', 'task-hash.mjs'), '--task', 'docs/tasks/' + id, '--write'], repo);
  return { repo, dir };
}
function lint(repo, id = '0001') {
  return run(process.execPath, [path.join(repo, 'docs', 'subagent-workflow', 'scripts', 'task-lint.mjs'), '--task', 'docs/tasks/' + id, '--strict'], repo);
}

/* F-7: пересечение allowedPaths и protectedPaths. */
const f7 = repoWithTask({ allowed: ['src/**'], protectedPaths: ['src/app.js'] });
try {
  const r = lint(f7.repo);
  if (r.code !== 0 && /protectedPaths/.test(r.out) && /src\/app\.js/.test(r.out)) pass('F-7: пересечение allowedPaths/protectedPaths — ошибка');
  else fail('F-7: пересечение allowedPaths/protectedPaths — ошибка', 'exit=' + r.code + ' ' + r.out.trim().slice(0, 200));
} finally { fs.rmSync(f7.repo, { recursive: true, force: true }); }
const f7c = repoWithTask({ allowed: ['src/**'], protectedPaths: ['checks/**'] });
try {
  const r = lint(f7c.repo);
  if (r.code === 0) pass('F-7 контроль: без пересечения — ок');
  else fail('F-7 контроль: без пересечения — ок', r.out.trim().slice(0, 200));
} finally { fs.rmSync(f7c.repo, { recursive: true, force: true }); }

/* F-5: low без красного — только noRed. */
const f5 = repoWithTask({ allowed: ['src/**'], criteria: { redExpect: { mustFail: [], mustPass: ['C1'], reasons: {} } } });
try {
  const r = lint(f5.repo);
  if (r.code !== 0 && /noRed/.test(r.out)) pass('F-5: пустой mustFail без noRed — ошибка');
  else fail('F-5: пустой mustFail без noRed — ошибка', 'exit=' + r.code + ' ' + r.out.trim().slice(0, 200));
} finally { fs.rmSync(f5.repo, { recursive: true, force: true }); }
const f5c = repoWithTask({ allowed: ['src/**'], criteria: { redExpect: { mustFail: [], mustPass: ['C1'], reasons: {}, noRed: { reason: 'только документация' } } } });
try {
  const r = lint(f5c.repo);
  if (r.code === 0) pass('F-5 контроль: noRed с причиной — ок');
  else fail('F-5 контроль: noRed с причиной — ок', r.out.trim().slice(0, 200));
} finally { fs.rmSync(f5c.repo, { recursive: true, force: true }); }

/* F-6: причина — дословная подстрока, task-red печатает вывод при несовпадении. */
const f6 = repoWithTask({ allowed: ['src/**'], criteria: { redExpect: { mustFail: ['C1'], mustPass: [], reasons: { C1: 'ЭТОГО НЕТ В ВЫВОДЕ' } } } });
try {
  const r = run(process.execPath, [path.join(f6.repo, 'docs', 'subagent-workflow', 'scripts', 'task-red.mjs'), '--task', 'docs/tasks/0001', '--base', 'HEAD'], f6.repo);
  if (r.code !== 0 && /вывод|stdout/i.test(r.out) && /ЭТОГО НЕТ/.test(r.out)) pass('F-6: при несовпадении причина и вывод напечатаны');
  else fail('F-6: при несовпадении причина и вывод напечатаны', 'exit=' + r.code + ' ' + r.out.trim().slice(-200));
} finally { fs.rmSync(f6.repo, { recursive: true, force: true }); }

/* F-8: verify.json исполнителя сохраняется при отказе приёмки. */
const f8 = repoWithTask({ allowed: ['src/**'] });
try {
  const verify = path.join(f8.dir, 'verify.json');
  write(verify, JSON.stringify({ task: '0001', marker: 'executor-run' }, null, 2) + '\n');
  git(f8.repo, ['add', '-A']); git(f8.repo, ['commit', '-q', '-m', 'v']);
  run(process.execPath, [path.join(f8.repo, 'docs', 'subagent-workflow', 'scripts', 'task-accept.mjs'), '--task', 'docs/tasks/0001', '--acceptor', 'judge', '--allow-missing-red'], f8.repo);
  const saved = path.join(f8.dir, 'verify.executor.json');
  if (fs.existsSync(saved) && fs.readFileSync(saved, 'utf8').includes('executor-run')) pass('F-8: verify.json сохранён как verify.executor.json');
  else fail('F-8: verify.json сохранён как verify.executor.json');
} finally { fs.rmSync(f8.repo, { recursive: true, force: true }); }

if (failed > 0) { console.log(''); console.log('GATE RULES FAIL: ' + failed); process.exit(1); }
console.log(''); console.log('GATE RULES OK');