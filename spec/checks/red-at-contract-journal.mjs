#!/usr/bin/env node
/*
 * 0148 (2.6.112): доказательство красного не теряется при --at-contract.
 *
 * Повод: красный, доказанный на контрактном дереве, оставлял строку журнала во
 * временном worktree, и в задании оставался только red.json. Приходилось
 * доставать доказательство из red.json (0146) — то есть жить с обходом. Теперь
 * строки переносятся в журнал задания через appendGateRecord: prev пересчитан,
 * цепочка цела, повтор не дублирует.
 *
 * c1: фикстура — контракт, чужой коммит после него, task-red --at-contract;
 *     в gates.jsonl задания появляется строка kind=red с head=contractCommit,
 *     цепочка prev сходится, повторный прогон не добавляет дубль.
 *
 * Вне пакета — SKIP (конвенция deployed-copy).
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSyncPipeFree } from '../scripts/lib/common.mjs';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PKG = path.resolve(HERE, '..', '..');
if (!fs.existsSync(path.join(PKG, 'spec'))) {
  console.log('SKIP: проверка пакета вне пакета');
  process.exit(0);
}

function run(cmd, args, cwd) {
  const r = spawnSyncPipeFree(cmd, args, { cwd, encoding: 'utf8', timeout: 900000 });
  return { code: r.status, out: String(r.stdout || '') + String(r.stderr || '') };
}
function git(cwd, args) { return run('git', ['-C', cwd, ...args], cwd); }
function write(file, text) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, text); }
function copyTree(from, to) {
  fs.mkdirSync(to, { recursive: true });
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    const src = path.join(from, entry.name), dst = path.join(to, entry.name);
    if (entry.isDirectory()) copyTree(src, dst); else if (entry.isFile()) fs.copyFileSync(src, dst);
  }
}

/* Цепочка журнала: prev = sha256 предыдущей строки как она записана в файл. */
function sha256Text(text) {
  return crypto.createHash('sha256').update(String(text), 'utf8').digest('hex');
}

function journalLines(file) {
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, 'utf8').split('\n').filter((line) => line.trim() !== '');
}

function journalRows(file) {
  return journalLines(file).map((line) => JSON.parse(line));
}

function c1() {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-redjournal-'));
  try {
    git(repo, ['init', '-q']);
    git(repo, ['config', 'user.email', 'p@l']);
    git(repo, ['config', 'user.name', 'p']);
    /* Строки не должны меняться при checkout: иначе защищённые файлы «изменены». */
    git(repo, ['config', 'core.autocrlf', 'false']);
    copyTree(path.join(PKG, 'spec'), path.join(repo, 'docs', 'subagent-workflow'));
    const dir = path.join(repo, 'docs', 'tasks', '0001');
    const meta = {
      id: '0001', version: 1, title: 'т', risk: 'low', created: '2026-11-25', owner: 'a',
      executor: 'subagent:executor', acceptor: 'subagent:judge',
      issuedBy: { kind: 'agent', session: 's', model: 'm' }, base: 'HEAD', criteria: 'criteria.json',
      allowedPaths: ['docs/tasks/0001/**', 'checks/**'], protectedPaths: [],
      redAllowDirty: ['docs/tasks/0001/**'], hashExclude: [], decisions: [],
    };
    const body = ['# Задание 0001', '', '<!-- TASK-META', JSON.stringify(meta, null, 2), '-->', '',
      '## Цель', '', 'x', '', '## Что не входит', '', 'x.', '', '## Инварианты', '', '1. x.', '',
      '## Границы знания', '', '1. x.', '', '## Среда', '', 'node.', '',
      '<!-- CRITERIA:BEGIN -->', '## Критерии приёмки', '', '| ID | Проверка | Ожидание |', '| --- | --- | --- |',
      '| C1 | node checks/c1.mjs | ok |', '<!-- CRITERIA:END -->', '', '## Отчёт', '', '1. x.', '', '## Коммит', '', 'x.', ''].join('\n');
    write(path.join(dir, 'task.md'), body);
    write(path.join(dir, 'criteria.json'), JSON.stringify({
      task: '0001', setup: [], teardown: [],
      redExpect: { mustFail: ['C1'], mustPass: [], reasons: { C1: 'ASSERT FAIL' }, reasonWindow: 25 },
      criteria: [{ id: 'C1', title: 't', command: 'node checks/c1.mjs', covers: ['checks/**'], expect: { exitCode: 0, stdoutContains: 'ok' }, tags: ['fast'] }],
    }, null, 2) + '\n');
    write(path.join(repo, 'checks', 'c1.mjs'), "if (process.env.WANT !== '1') { console.log('ASSERT FAIL'); process.exit(1); }\nconsole.log('ok');\n");
    git(repo, ['add', '-A']);
    git(repo, ['commit', '-q', '-m', 'task 0001: контракт']);
    const contractCommit = git(repo, ['rev-parse', 'HEAD']).out.trim();
    const hash = run(process.execPath, [path.join(repo, 'docs', 'subagent-workflow', 'scripts', 'task-hash.mjs'), '--task', 'docs/tasks/0001', '--write'], repo);
    if (hash.code !== 0) throw new Error('task-hash не прошёл: ' + hash.out.trim().slice(-300));

    /* Чужой коммит после контракта: обычный task-red отказал бы, --at-contract обязан пройти. */
    write(path.join(repo, 'notes.txt'), 'чужой коммит\n');
    git(repo, ['add', 'notes.txt']);
    git(repo, ['commit', '-q', '-m', 'чужая работа']);

    const red = run(process.execPath, [path.join(repo, 'docs', 'subagent-workflow', 'scripts', 'task-red.mjs'), '--task', 'docs/tasks/0001', '--at-contract'], repo);
    if (red.code !== 0) throw new Error('task-red --at-contract не прошёл: ' + red.out.trim().slice(-500));

    const journal = path.join(dir, 'gates.jsonl');
    const rows = journalRows(journal);
    const redRows = rows.filter((row) => row.kind === 'red');
    if (redRows.length !== 1) throw new Error('в журнале задания ' + redRows.length + ' строк red, ожидалась одна');
    if (String(redRows[0].head) !== contractCommit) throw new Error('строка red относится к ' + String(redRows[0].head).slice(0, 12) + ', ожидался контракт ' + contractCommit.slice(0, 12));
    if (redRows[0].verdict !== 'red-proven') throw new Error('вердикт строки red: ' + redRows[0].verdict);

    /* Цепочка журнала должна сходиться: prev пересчитан при переносе. */
    const raw = journalLines(journal);
    for (let index = 1; index < raw.length; index += 1) {
      const expected = sha256Text(raw[index - 1]);
      const actual = JSON.parse(raw[index]).prev;
      if (actual !== expected) {
        throw new Error('цепочка журнала нарушена на строке ' + (index + 1) + ': prev ' + String(actual).slice(0, 12) + ' != ' + expected.slice(0, 12));
      }
    }

    /* Повторный прогон не дублирует строку того же гейта. */
    const again = run(process.execPath, [path.join(repo, 'docs', 'subagent-workflow', 'scripts', 'task-red.mjs'), '--task', 'docs/tasks/0001', '--at-contract'], repo);
    if (again.code !== 0) throw new Error('повторный task-red --at-contract не прошёл: ' + again.out.trim().slice(-400));
    const after = journalRows(journal).filter((row) => row.kind === 'red');
    if (after.length !== 1) throw new Error('повтор добавил дубль: строк red ' + after.length);
    console.log('REDJOURNAL OK c1');
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
}

const table = { c1 };
const which = process.argv[2];
if (!table[which]) {
  console.log('usage: node spec/checks/red-at-contract-journal.mjs c1');
  process.exit(2);
}
try {
  table[which]();
} catch (error) {
  console.log('REDJOURNAL FAIL ' + which + ': ' + (error && error.message ? error.message : error));
  process.exit(1);
}
