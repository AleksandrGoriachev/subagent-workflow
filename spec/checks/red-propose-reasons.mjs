#!/usr/bin/env node
/*
 * 0156 (R1 письма structure--243): причины красного берутся из факта.
 *
 * Стоило трёх отмен заданий (0350, 0355, 0357) у structure: причина в
 * redExpect.reasons писалась «по смыслу», а движок сверяет её как ПОДСТРОКУ
 * фактического вывода в вердиктной зоне. Узнавалось это отказом после
 * заморозки criteria.lock, когда правка возможна только новым ID.
 *
 *   c1 — флаг --propose-reasons печатает блок reasons из фактического вывода:
 *        значение — подстрока вывода упавшего mustFail, а не пересказ;
 *   c2 (негатив) — если mustFail зелёный (красного нет), причин не предлагают:
 *        печатается «предложить нечего», блока нет.
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

const MARKER = 'PROBE-FAIL: файл не найден: probe.txt';
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

/* Фикстура: контракт с одним красным mustFail и одним зелёным mustPass. */
function makeRepo({ red }) {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-reasons-'));
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
    '| C1 | node -e "..." | fail |', '<!-- CRITERIA:END -->', '', '## Отчёт', '', '1. x.', '', '## Коммит', '', 'x.', ''].join('\n');
  write(path.join(dir, 'task.md'), body);
  const failing = 'node -e "console.log(\'' + 'PROBE-FAIL: файл не найден: probe.txt' + '\'); process.exit(1)"';
  const green = 'node -e "process.exit(0)"';
  const criteria = {
    task: '0001',
    setup: [],
    teardown: [],
    redExpect: {
      mustFail: ['C1'],
      mustPass: ['C2'],
      reasonWindow: 25,
      reasons: { C1: 'PROBE-FAIL' },
    },
    criteria: [
      { id: 'C1', title: 'красный', command: red ? failing : green, covers: ['docs/tasks/0001/**'], expect: { exitCode: 0 }, tags: ['fast'] },
      { id: 'C2', title: 'зелёный', command: green, covers: ['docs/tasks/0001/**'], expect: { exitCode: 0 }, tags: ['fast'] },
    ],
  };
  write(path.join(dir, 'criteria.json'), JSON.stringify(criteria, null, 2) + '\n');
  git(repo, ['add', '-A']);
  git(repo, ['commit', '-q', '-m', 'contract']);
  run(process.execPath, [path.join(repo, 'docs', 'subagent-workflow', 'scripts', 'task-hash.mjs'), '--task', 'docs/tasks/0001', '--repo', repo, '--write'], repo);
  return repo;
}

function propose(repo) {
  return run(process.execPath, [
    path.join(repo, 'docs', 'subagent-workflow', 'scripts', 'task-red.mjs'),
    '--task', 'docs/tasks/0001', '--repo', repo, '--propose-reasons',
  ], repo);
}

if (mode === 'c1') {
  const repo = makeRepo({ red: true });
  try {
    const r = propose(repo);
    if (r.code !== 0) fail('c1', 'task-red не доказал красный (exit ' + r.code + '): ' + r.out.slice(-500));
    if (!/"reasons"/u.test(r.out)) fail('c1', 'блок reasons не напечатан: ' + r.out.slice(-500));
    const match = r.out.match(/"reasons": (\{[\s\S]*?\n\})/u);
    if (!match) fail('c1', 'не удалось разобрать блок reasons');
    else {
      let block = null;
      try { block = JSON.parse(match[1]); } catch (error) { fail('c1', 'блок reasons — не JSON: ' + String(error && error.message)); }
      if (block) {
        if (!Object.prototype.hasOwnProperty.call(block, 'C1')) fail('c1', 'в блоке нет причины для C1: ' + JSON.stringify(block));
        else {
          const value = String(block.C1);
          if (!value.includes('PROBE-FAIL')) fail('c1', 'предложенная причина не из фактического вывода: ' + value);
          if (!r.out.includes('подстрока') && !/не пересказывайте/iu.test(r.out)) fail('c1', 'нет напоминания, что строка — подстрока вывода');
        }
      }
    }
  } finally { fs.rmSync(repo, { recursive: true, force: true }); }
  if (bad === 0) console.log('RED-PROPOSE OK c1');
  process.exit(bad === 0 ? 0 : 1);
}

if (mode === 'c2') {
  const repo = makeRepo({ red: false });
  try {
    const r = propose(repo);
    if (r.code === 0) fail('c2', 'task-red счёл красный доказанным, хотя mustFail зелёный');
    if (/"reasons": \{/u.test(r.out)) fail('c2', 'причин без красного не должно быть, а блок напечатан: ' + r.out.slice(-400));
    if (!/предложить причины нечего|нечего/iu.test(r.out)) fail('c2', 'нет объяснения, почему причин нет: ' + r.out.slice(-400));
  } finally { fs.rmSync(repo, { recursive: true, force: true }); }
  if (bad === 0) console.log('RED-PROPOSE OK c2');
  process.exit(bad === 0 ? 0 : 1);
}

console.log('usage: node spec/checks/red-propose-reasons.mjs c1|c2');
process.exit(2);
