#!/usr/bin/env node
/* Задание 0029: строгость covers (2.6.6).
 * Шаблон/glob в allowedPaths без покрытия — WARN и exit 0;
 * конкретный файл без покрытия — ERROR и exit 1; у принятого задания — WARN. */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PKG = path.resolve(HERE, '..', '..');
/* Задание 0035: вне пакета каталога spec нет — развёрнутая копия печатает SKIP и выходит 0. */
if (!fs.existsSync(path.join(PKG, 'spec'))) {
  console.log('SKIP: проверка пакета вне пакета');
  process.exit(0);
}
let failed = 0;
const pass = (n) => console.log('PASS ' + n);
const fail = (n, d) => { failed += 1; console.log('FAIL ' + n + (d ? ' — ' + d : '')); };
function run(cmd, args, cwd) { const r = spawnSync(cmd, args, { cwd, encoding: 'utf8', timeout: 600000 }); return { code: r.status, out: String(r.stdout || '') + String(r.stderr || '') }; }
function git(cwd, args) { return run('git', ['-C', cwd, ...args], cwd); }
function write(file, text) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, text); }
function copyTree(from, to) {
  fs.mkdirSync(to, { recursive: true });
  for (const e of fs.readdirSync(from, { withFileTypes: true })) {
    const s = path.join(from, e.name), t = path.join(to, e.name);
    if (e.isDirectory()) copyTree(s, t); else if (e.isFile()) fs.copyFileSync(s, t);
  }
}
function makeRepo({ allowed, accepted }) {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-cover-'));
  git(repo, ['init', '-q']); git(repo, ['config', 'user.email', 'p@l']); git(repo, ['config', 'user.name', 'p']);
  copyTree(path.join(PKG, 'spec'), path.join(repo, 'docs', 'subagent-workflow'));
  const dir = path.join(repo, 'docs', 'tasks', '0001');
  const meta = { id: '0001', version: 1, title: 'т', risk: 'low', created: '2026-10-31', owner: 'a', executor: 'subagent:executor', acceptor: 'subagent:judge', issuedBy: { kind: 'agent', session: 's', model: 'm' }, base: 'HEAD', criteria: 'criteria.json', allowedPaths: allowed, protectedPaths: [], redAllowDirty: ['docs/tasks/0001/**'], hashExclude: [], decisions: [] };
  const body = ['# Задание 0001', '', '<!-- TASK-META', JSON.stringify(meta, null, 2), '-->', '', '## Цель', '', 'x', '', '## Что не входит', '', 'x.', '', '## Инварианты', '', '1. x.', '', '## Границы знания', '', '1. x.', '', '## Среда', '', 'node.', '', '<!-- CRITERIA:BEGIN -->', '## Критерии приёмки', '', '| ID | Проверка | Ожидание |', '| --- | --- | --- |', '| C1 | node -e "console.log(1)" | exit 0 |', '<!-- CRITERIA:END -->', '', '## Отчёт', '', '1. x.', '', '## Коммит', '', 'x.', ''].join('\n');
  write(path.join(dir, 'task.md'), body);
  const criteria = { task: '0001', redExpect: { mustFail: [], mustPass: ['C1'], reasons: {}, noRed: { reason: 'документация' } }, criteria: [{ id: 'C1', title: 't', command: 'node -e "console.log(1)"', covers: ['other/**'], expect: { exitCode: 0 }, tags: ['fast'] }] };
  write(path.join(dir, 'criteria.json'), JSON.stringify(criteria, null, 2) + '\n');
  if (accepted) write(path.join(dir, 'acceptance.json'), JSON.stringify({ version: 6, status: 'accepted', task: '0001' }, null, 2) + '\n');
  git(repo, ['add', '-A']); git(repo, ['commit', '-q', '-m', 'contract']);
  run(process.execPath, [path.join(repo, 'docs', 'subagent-workflow', 'scripts', 'task-hash.mjs'), '--task', 'docs/tasks/0001', '--write'], repo);
  return repo;
}
function lint(repo) { return run(process.execPath, [path.join(repo, 'docs', 'subagent-workflow', 'scripts', 'task-lint.mjs'), '--task', 'docs/tasks/0001', '--strict'], repo); }

/* A: glob без покрытия — WARN и exit 0. */
let repo = makeRepo({ allowed: ['src/*.js'], accepted: false });
try {
  const r = lint(repo);
  if (r.code === 0 && /WARN/.test(r.out) && /covers/.test(r.out) && !/ERROR/.test(r.out)) pass('A: glob без covers — WARN и exit 0');
  else fail('A: glob без covers — WARN и exit 0', 'exit=' + r.code + ' ' + r.out.trim().slice(0, 200));
} finally { fs.rmSync(repo, { recursive: true, force: true }); }

/* B: конкретный файл без покрытия — ERROR и exit 1. */
repo = makeRepo({ allowed: ['src/app.js'], accepted: false });
try {
  const r = lint(repo);
  if (r.code !== 0 && /ERROR/.test(r.out) && /src\/app\.js/.test(r.out)) pass('B: файл без covers — ERROR и exit 1');
  else fail('B: файл без covers — ERROR и exit 1', 'exit=' + r.code + ' ' + r.out.trim().slice(0, 200));
} finally { fs.rmSync(repo, { recursive: true, force: true }); }

/* C: у принятого задания glob — WARN/exit 0. */
repo = makeRepo({ allowed: ['src/*.js'], accepted: true });
try {
  const r = lint(repo);
  if (r.code === 0) pass('C: принятое задание — exit 0');
  else fail('C: принятое задание — exit 0', r.out.trim().slice(0, 200));
} finally { fs.rmSync(repo, { recursive: true, force: true }); }

/* D: каталог-шаблон /** без покрытия — молчит (exit 0). */
repo = makeRepo({ allowed: ['src/**'], accepted: false });
try {
  const r = lint(repo);
  if (r.code === 0) pass('D: шаблон каталога — exit 0');
  else fail('D: шаблон каталога — exit 0', r.out.trim().slice(0, 200));
} finally { fs.rmSync(repo, { recursive: true, force: true }); }

if (failed > 0) { console.log(''); console.log('COVERS SEVERITY FAIL: ' + failed); process.exit(1); }
console.log(''); console.log('COVERS SEVERITY OK');