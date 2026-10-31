#!/usr/bin/env node
/* Задание 0030: запись приёмки принадлежит заданию (2.6.7).
 * hasAcceptedRecord(file, expectedTask) обязан сверять record.task:
 * принятая запись другого задания не снимает проверки и не смягчает lint. */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PKG = path.resolve(HERE, '..', '..');
let failed = 0;
const pass = (n) => console.log('PASS ' + n);
const fail = (n, d) => { failed += 1; console.log('FAIL ' + n + (d ? ' — ' + d : '')); };
function run(cmd, args, cwd) { const r = spawnSync(cmd, args, { cwd, encoding: 'utf8', timeout: 900000 }); return { code: r.status, out: String(r.stdout || '') + String(r.stderr || '') }; }
function git(cwd, args) { return run('git', ['-C', cwd, ...args], cwd); }
function write(file, text) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, text); }
function copyTree(from, to) {
  fs.mkdirSync(to, { recursive: true });
  for (const e of fs.readdirSync(from, { withFileTypes: true })) {
    const s = path.join(from, e.name), t = path.join(to, e.name);
    if (e.isDirectory()) copyTree(s, t); else if (e.isFile()) fs.copyFileSync(s, t);
  }
}

const { hasAcceptedRecord } = await import(pathToFileURL(path.join(PKG, 'spec', 'scripts', 'lib', 'common.mjs')).href);
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-rec-'));
const rec = (obj) => { const f = path.join(tmp, Math.random().toString(36).slice(2) + '.json'); fs.writeFileSync(f, JSON.stringify(obj)); return f; };

/* A. Своё задание — принято. */
if (hasAcceptedRecord(rec({ status: 'accepted', task: '0001' }), '0001') === true) pass('A: своя запись — принято');
else fail('A: своя запись — принято');

/* B. Чужое задание — не принято. */
try { if (hasAcceptedRecord(rec({ status: 'accepted', task: '9999' }), '0001') === false) pass('B: чужое задание — не принято'); else fail('B: чужое задание — не принято'); }
catch (e) { fail('B: чужое задание — не принято', e.message); }

/* C. Запись без task — не основание. */
try { if (hasAcceptedRecord(rec({ status: 'accepted' }), '0001') === false) pass('C: без task — не принято'); else fail('C: без task — не принято'); }
catch (e) { fail('C: без task — не принято', e.message); }

/* D. Чужой статус и битый файл — не принято. */
if (hasAcceptedRecord(rec({ status: 'pending', task: '0001' }), '0001') === false) pass('D1: pending — не принято'); else fail('D1: pending — не принято');
const broken = path.join(tmp, 'broken.json'); fs.writeFileSync(broken, '{');
if (hasAcceptedRecord(broken, '0001') === false) pass('D2: битый JSON — не принято'); else fail('D2: битый JSON — не принято');

/* E. Lint не смягчает диагностику по чужой записи. */
const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-rec-repo-'));
try {
  git(repo, ['init', '-q']); git(repo, ['config', 'user.email', 'p@l']); git(repo, ['config', 'user.name', 'p']);
  copyTree(path.join(PKG, 'spec'), path.join(repo, 'docs', 'subagent-workflow'));
  const dir = path.join(repo, 'docs', 'tasks', '0001');
  const meta = { id: '0001', version: 1, title: 'т', risk: 'low', created: '2026-11-01', owner: 'a', executor: 'subagent:executor', acceptor: 'subagent:judge', issuedBy: { kind: 'agent', session: 's', model: 'm' }, base: 'HEAD', criteria: 'criteria.json', allowedPaths: ['src/**'], protectedPaths: [], redAllowDirty: ['docs/tasks/0001/**'], hashExclude: [], decisions: [] };
  write(path.join(dir, 'task.md'), ['# Задание 0001', '', '<!-- TASK-META', JSON.stringify(meta, null, 2), '-->', '', '## Цель', '', 'x', '', '## Что не входит', '', 'x.', '', '## Инварианты', '', '1. x.', '', '## Границы знания', '', '1. x.', '', '## Среда', '', 'node.', '', '<!-- CRITERIA:BEGIN -->', '## Критерии приёмки', '', '| ID | Проверка | Ожидание |', '| --- | --- | --- |', '| C1 | node -e "console.log(1)" | exit 0 |', '<!-- CRITERIA:END -->', '', '## Отчёт', '', '1. x.', '', '## Коммит', '', 'x.', ''].join('\n'));
  write(path.join(dir, 'criteria.json'), JSON.stringify({ task: '0001', redExpect: { mustFail: [], mustPass: ['C1'], reasons: {}, noRed: { reason: 'документация' } }, criteria: [{ id: 'C1', title: 't', command: 'node -e "console.log(1)"', covers: ['src/**'], expect: { exitCode: 0 }, tags: ['fast'] }] }, null, 2));
  git(repo, ['add', '-A']); git(repo, ['commit', '-q', '-m', 'contract']);
  run(process.execPath, [path.join(repo, 'docs', 'subagent-workflow', 'scripts', 'task-hash.mjs'), '--task', 'docs/tasks/0001', '--write'], repo);
  write(path.join(dir, 'acceptance.json'), JSON.stringify({ version: 6, status: 'accepted', task: '9999' }, null, 2));
  write(path.join(repo, 'src', 'a.txt'), 'x'); git(repo, ['add', '-A']); git(repo, ['commit', '-q', '-m', 'shift']);
  const r = run(process.execPath, [path.join(repo, 'docs', 'subagent-workflow', 'scripts', 'task-lint.mjs'), '--task', 'docs/tasks/0001', '--strict'], repo);
  if (r.code !== 0 && /contractCommit|HEAD/i.test(r.out)) pass('E: lint не смягчён чужой записью');
  else fail('E: lint не смягчён чужой записью', 'exit=' + r.code + ' ' + r.out.trim().slice(-260));
} finally { fs.rmSync(repo, { recursive: true, force: true }); fs.rmSync(tmp, { recursive: true, force: true }); }

if (failed > 0) { console.log(''); console.log('ACCEPTANCE RECORD FAIL: ' + failed); process.exit(1); }
console.log(''); console.log('ACCEPTANCE RECORD OK');