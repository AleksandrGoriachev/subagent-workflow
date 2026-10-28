#!/usr/bin/env node
/*
 * Приёмочные проверки задания 0012 (2.6.2):
 * 1) проверки пакета, запущенные вне пакета (в развёрнутой копии), печатают SKIP и выходят 0;
 * 2) task-lint --strict по ПРИНЯТОМУ заданию не валит прогон из-за обновления пакета и
 *    исторических правил: расхождения замка по защищённым файлам и нарушения решений/эффекта — WARN;
 * 3) контроль: то же задание без записи приёмки остаётся ERROR и exit 1.
 */
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

function run(cmd, args, cwd) {
  const r = spawnSync(cmd, args, { cwd, encoding: 'utf8', timeout: 300000 });
  return { code: r.status, out: String(r.stdout || '') + String(r.stderr || '') };
}
function git(repo, args) { return run('git', ['-C', repo, ...args], repo); }
function write(file, text) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, text); }
function copyTree(from, to) {
  fs.mkdirSync(to, { recursive: true });
  for (const e of fs.readdirSync(from, { withFileTypes: true })) {
    const s = path.join(from, e.name), t = path.join(to, e.name);
    if (e.isDirectory()) copyTree(s, t); else if (e.isFile()) fs.copyFileSync(s, t);
  }
}

/* 1. Проверка пакета вне пакета: SKIP, не падение. */
const fake = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-skip-'));
try {
  copyTree(path.join(PKG, 'spec', 'scripts'), path.join(fake, 'docs', 'subagent-workflow', 'scripts'));
  const checks = ['acceptance-schema.mjs', 'actor-sources.mjs'];
  for (const name of checks) {
    const dst = path.join(fake, 'docs', 'subagent-workflow', 'checks', name);
    write(dst, fs.readFileSync(path.join(PKG, 'spec', 'checks', name), 'utf8'));
    const r = run(process.execPath, [dst], fake);
    if (r.code === 0 && /SKIP/.test(r.out)) pass('вне пакета: ' + name + ' печатает SKIP');
    else fail('вне пакета: ' + name + ' печатает SKIP', 'exit=' + r.code + ' ' + r.out.trim().slice(0, 160));
  }
} finally { try { fs.rmSync(fake, { recursive: true, force: true }); } catch {} }

/* 2-3. Принятое задание: замок и правила решений не валят lint. */
function makeRepo(withAcceptance) {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-lint-'));
  git(repo, ['init', '-q']);
  git(repo, ['config', 'user.email', 'p@l']);
  git(repo, ['config', 'user.name', 'p']);
  copyTree(path.join(PKG, 'spec'), path.join(repo, 'docs', 'subagent-workflow'));
  const dir = path.join(repo, 'docs', 'tasks', '0001');
  const meta = {
    id: '0001', version: 1, title: 'историческое', risk: 'low', created: '2026-10-28',
    owner: 'a', executor: 'subagent:executor', acceptor: 'subagent:judge',
    issuedBy: { kind: 'agent', session: 'issuer', model: 'm' },
    base: 'HEAD', criteria: 'criteria.json',
    allowedPaths: ['docs/tasks/0001/**', 'checks/**'],
    protectedPaths: ['checks/probe.txt'],
    redAllowDirty: ['docs/tasks/0001/**'], hashExclude: [],
    decisions: [{ id: 'D1', class: 'mechanical', question: 'влияет?', chosen: 'да', options: ['да', 'нет'], impact: 'user-visible', reversible: true }],
  };
  const body = ['# Задание 0001', '', '<!-- TASK-META', JSON.stringify(meta, null, 2), '-->', '', '## Цель', '', 'x', '', '## Что не входит', '', 'ничего.', '', '## Инварианты', '', '1. x.', '', '## Границы знания', '', '1. x.', '', '## Среда', '', 'node.', '', '## Что сделать', '', '1. x.', '', '<!-- CRITERIA:BEGIN -->', '## Критерии приёмки', '', '| ID | Проверка | Ожидание |', '| --- | --- | --- |', '| C1 | node -e "console.log(1)" | exit 0 |', '<!-- CRITERIA:END -->', '', '## Отчёт', '', '1. x.', '', '## Коммит', '', 'x.', ''].join('\n');
  write(path.join(dir, 'task.md'), body);
  write(path.join(dir, 'criteria.json'), JSON.stringify({ task: '0001', criteria: [{ id: 'C1', title: 't', command: 'node -e "console.log(1)"', expect: { exitCode: 0 }, tags: ['fast'] }] }, null, 2) + '\n');
  write(path.join(repo, 'checks', 'probe.txt'), 'v1\n');
  git(repo, ['add', '-A']); git(repo, ['commit', '-q', '-m', 'contract']);
  const hash = run(process.execPath, [path.join(repo, 'docs', 'subagent-workflow', 'scripts', 'task-hash.mjs'), '--task', 'docs/tasks/0001', '--write'], repo);
  if (hash.status !== 0 && hash.code !== 0) throw new Error('hash: ' + String(hash.out).slice(0, 200));
  if (withAcceptance) write(path.join(dir, 'acceptance.json'), JSON.stringify({ version: 6, status: 'accepted', task: '0001' }, null, 2) + '\n');
  write(path.join(repo, 'checks', 'probe.txt'), 'v2\n');
  return repo;
}

for (const [label, withAcceptance, wantCode] of [['принятое', true, 0], ['контроль: открытое', false, 1]]) {
  const repo = makeRepo(withAcceptance);
  try {
    const lint = run(process.execPath, [path.join(repo, 'docs', 'subagent-workflow', 'scripts', 'task-lint.mjs'), '--task', 'docs/tasks/0001', '--strict'], repo);
    const hasError = /ERROR/.test(lint.out);
    const hasWarn = /WARN/.test(lint.out);
    if (wantCode === 0) {
      if (lint.code !== 0 || hasError) fail(label + ': lint не валит прогон', 'exit=' + lint.code + ' ' + lint.out.trim().slice(0, 240));
      else if (!hasWarn) fail(label + ': lint печатает WARN', lint.out.trim().slice(0, 200));
      else pass(label + ': lint даёт WARN и exit 0');
    } else {
      if (lint.code === 0 || !hasError) fail(label + ': lint остаётся ERROR и exit 1', 'exit=' + lint.code + ' ' + lint.out.trim().slice(0, 240));
      else pass(label + ': lint остаётся ERROR и exit 1');
    }
  } finally { try { fs.rmSync(repo, { recursive: true, force: true }); } catch {} }
}

if (failed > 0) { console.log(''); console.log('DEPLOYED COPY FAIL: ' + failed); process.exit(1); }
console.log(''); console.log('DEPLOYED COPY OK');