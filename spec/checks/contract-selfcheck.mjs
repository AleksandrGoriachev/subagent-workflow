#!/usr/bin/env node
/* Задание 0027: самопроверка контракта (2.6.6).
 * lint сверяет пути, названные в разделе «Что сделать», с allowedPaths,
 * и требует covers для каждого конкретного файла из allowedPaths. */
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

function run(cmd, args, cwd) { const r = spawnSync(cmd, args, { cwd, encoding: 'utf8' }); return { code: r.status, out: String(r.stdout || '') + String(r.stderr || '') }; }
function git(cwd, args) { return run('git', ['-C', cwd, ...args], cwd); }
function write(file, text) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, text); }
function copyTree(from, to) {
  fs.mkdirSync(to, { recursive: true });
  for (const e of fs.readdirSync(from, { withFileTypes: true })) {
    const s = path.join(from, e.name), t = path.join(to, e.name);
    if (e.isDirectory()) copyTree(s, t); else if (e.isFile()) fs.copyFileSync(s, t);
  }
}
function makeRepo({ allowed, covers, step }) {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-self-'));
  git(repo, ['init', '-q']); git(repo, ['config', 'user.email', 'p@l']); git(repo, ['config', 'user.name', 'p']);
  copyTree(path.join(PKG, 'spec'), path.join(repo, 'docs', 'subagent-workflow'));
  const dir = path.join(repo, 'docs', 'tasks', '0001');
  const meta = {
    id: '0001', version: 1, title: 'т', risk: 'low', created: '2026-10-30', owner: 'a',
    executor: 'subagent:executor', acceptor: 'subagent:judge', issuedBy: { kind: 'agent', session: 's', model: 'm' },
    base: 'HEAD', criteria: 'criteria.json', allowedPaths: allowed, protectedPaths: [],
    redAllowDirty: ['docs/tasks/0001/**'], hashExclude: [], decisions: [],
  };
  const head = ['# Задание 0001', '', '<!-- TASK-META', JSON.stringify(meta, null, 2), '-->', '', '## Цель', '', 'x', '', '## Что не входит', '', 'x.', '', '## Инварианты', '', '1. x.', '', '## Границы знания', '', '1. x.', '', '## Среда', '', 'node.', ''];
  const mid = step ? ['## Что сделать', '', step, ''] : [];
  const tail = ['<!-- CRITERIA:BEGIN -->', '## Критерии приёмки', '', '| ID | Проверка | Ожидание |', '| --- | --- | --- |', '| C1 | node -e "console.log(1)" | exit 0 |', '<!-- CRITERIA:END -->', '', '## Отчёт', '', '1. x.', '', '## Коммит', '', 'x.', ''];
  write(path.join(dir, 'task.md'), [...head, ...mid, ...tail].join('\n'));
  const criteria = { task: '0001', redExpect: { mustFail: [], mustPass: ['C1'], reasons: {}, noRed: { reason: 'документация' } },
    criteria: [{ id: 'C1', title: 't', command: 'node -e "console.log(1)"', covers, expect: { exitCode: 0 }, tags: ['fast'] }] };
  write(path.join(dir, 'criteria.json'), JSON.stringify(criteria, null, 2) + '\n');
  git(repo, ['add', '-A']); git(repo, ['commit', '-q', '-m', 'contract']);
  run(process.execPath, [path.join(repo, 'docs', 'subagent-workflow', 'scripts', 'task-hash.mjs'), '--task', 'docs/tasks/0001', '--write'], repo);
  return repo;
}
function lint(repo) {
  return run(process.execPath, [path.join(repo, 'docs', 'subagent-workflow', 'scripts', 'task-lint.mjs'), '--task', 'docs/tasks/0001', '--strict'], repo);
}

/* A: путь назван в «Что сделать», но не разрешён. */
let repo = makeRepo({ allowed: ['src/**'], covers: ['src/**'], step: '1. Правь `tools/helper.mjs` и всё.' });
try {
  const r = lint(repo);
  if (r.code !== 0 && /tools\/helper\.mjs/.test(r.out) && /allowedPaths/.test(r.out)) pass('A: путь из «Что сделать» вне allowedPaths — ошибка');
  else fail('A: путь из «Что сделать» вне allowedPaths — ошибка', 'exit=' + r.code + ' ' + r.out.trim().slice(0, 200));
} finally { fs.rmSync(repo, { recursive: true, force: true }); }

/* B: тот же путь разрешён — ок. */
repo = makeRepo({ allowed: ['src/**', 'tools/**'], covers: ['src/**', 'tools/**'], step: '1. Правь `tools/helper.mjs` и всё.' });
try {
  const r = lint(repo);
  if (r.code === 0) pass('B: разрешённый путь — ок');
  else fail('B: разрешённый путь — ок', r.out.trim().slice(0, 200));
} finally { fs.rmSync(repo, { recursive: true, force: true }); }

/* C: запрет «не трогай» не считается требованием. */
repo = makeRepo({ allowed: ['src/**'], covers: ['src/**'], step: '1. Правь `src/app.js`. Не трогай `tools/helper.mjs`.' });
try {
  const r = lint(repo);
  if (r.code === 0) pass('C: «не трогай» не считается требованием');
  else fail('C: «не трогай» не считается требованием', r.out.trim().slice(0, 200));
} finally { fs.rmSync(repo, { recursive: true, force: true }); }

/* D: конкретный файл в allowedPaths без covers — ошибка. */
repo = makeRepo({ allowed: ['src/**', 'tools/x.mjs'], covers: ['src/**'], step: '1. Правь src.' });
try {
  const r = lint(repo);
  if (r.code !== 0 && /tools\/x\.mjs/.test(r.out) && /covers/.test(r.out)) pass('D: файл из allowedPaths без covers — ошибка');
  else fail('D: файл из allowedPaths без covers — ошибка', 'exit=' + r.code + ' ' + r.out.trim().slice(0, 200));
} finally { fs.rmSync(repo, { recursive: true, force: true }); }

/* E: раздела «Что сделать» нет — правила молчат. */
repo = makeRepo({ allowed: ['src/**'], covers: ['src/**'], step: '' });
try {
  const r = lint(repo);
  if (r.code === 0) pass('E: без раздела «Что сделать» — ок');
  else fail('E: без раздела «Что сделать» — ок', r.out.trim().slice(0, 200));
} finally { fs.rmSync(repo, { recursive: true, force: true }); }

if (failed > 0) { console.log(''); console.log('CONTRACT SELFCHECK FAIL: ' + failed); process.exit(1); }
console.log(''); console.log('CONTRACT SELFCHECK OK');