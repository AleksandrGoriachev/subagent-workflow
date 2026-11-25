#!/usr/bin/env node
/*
 * 0148 (2.6.112): WARN про mustPass, который ссылается на файл, которого ещё нет.
 *
 * Повод: дважды подряд (0142, 0146) контракт объявлял mustPass на новый файл
 * проверки, которого до работы не существует; preflight падал «mustPass не
 * зелёный на базе», и контракт приходилось переписывать. Правильный путь —
 * такой критерий в mustFail. Проверка WARN: команда может создавать файл намеренно.
 *
 * c1: команда mustPass упоминает отсутствующий файл — WARN с его путём;
 * c2 (негатив): файл существует — предупреждения нет.
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

function run(cmd, args, cwd) {
  const r = spawnSyncPipeFree(cmd, args, { cwd, encoding: 'utf8', timeout: 300000 });
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

/* Репозиторий с одним заданием; command, наличие файла, границы и место в redExpect — снаружи. */
function makeRepo({ command, fileExists, allowedPaths, placement = 'mustPass' }) {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-linthints-'));
  git(repo, ['init', '-q']);
  git(repo, ['config', 'user.email', 'p@l']);
  git(repo, ['config', 'user.name', 'p']);
  copyTree(path.join(PKG, 'spec'), path.join(repo, 'docs', 'subagent-workflow'));
  const dir = path.join(repo, 'docs', 'tasks', '0001');
  const meta = {
    id: '0001', version: 1, title: 'т', risk: 'low', created: '2026-11-25', owner: 'a',
    executor: 'subagent:executor', acceptor: 'subagent:judge',
    issuedBy: { kind: 'agent', session: 's', model: 'm' }, base: 'HEAD', criteria: 'criteria.json',
    allowedPaths: Array.isArray(allowedPaths) ? allowedPaths : ['docs/tasks/0001/**', 'spec/checks/**'], protectedPaths: [],
    redAllowDirty: ['docs/tasks/0001/**'], hashExclude: [], decisions: [],
  };
  const body = ['# Задание 0001', '', '<!-- TASK-META', JSON.stringify(meta, null, 2), '-->', '',
    '## Цель', '', 'x', '', '## Что не входит', '', 'x.', '', '## Инварианты', '', '1. x.', '',
    '## Границы знания', '', '1. x.', '', '## Среда', '', 'node.', '',
    '<!-- CRITERIA:BEGIN -->', '## Критерии приёмки', '', '| ID | Проверка | Ожидание |', '| --- | --- | --- |',
    '| C1 | ' + command + ' | ok |', '<!-- CRITERIA:END -->', '', '## Отчёт', '', '1. x.', '', '## Коммит', '', 'x.', ''].join('\n');
  write(path.join(dir, 'task.md'), body);
  const criteria = {
    task: '0001', setup: [], teardown: [],
    redExpect: placement === 'mustFail'
      ? { mustFail: ['C1'], mustPass: [], reasons: { C1: 'проба' } }
      : { mustFail: [], mustPass: ['C1'], reasons: {}, noRed: { reason: 'фикстура подсказки' } },
    criteria: [{ id: 'C1', title: 't', command, covers: ['docs/tasks/0001/**'], expect: { exitCode: 0 }, tags: ['fast'] }],
  };
  write(path.join(dir, 'criteria.json'), JSON.stringify(criteria, null, 2) + '\n');
  if (fileExists) write(path.join(repo, 'spec', 'checks', 'probe-lint-hint.mjs'), 'console.log(1);\n');
  git(repo, ['add', '-A']);
  git(repo, ['commit', '-q', '-m', 'contract']);
  run(process.execPath, [path.join(repo, 'docs', 'subagent-workflow', 'scripts', 'task-hash.mjs'), '--task', 'docs/tasks/0001', '--write'], repo);
  return repo;
}

function lint(repo) {
  return run(process.execPath, [path.join(repo, 'docs', 'subagent-workflow', 'scripts', 'task-lint.mjs'), '--task', 'docs/tasks/0001'], repo);
}

const table = {
  /* c1: файла нет — WARN с путём и советом про mustFail. */
  c1() {
    const command = 'node spec/checks/probe-lint-hint.mjs';
    const repo = makeRepo({ command, fileExists: false });
    try {
      const r = lint(repo);
      if (r.code !== 0) throw new Error('lint отказал на фикстуре (exit ' + r.code + '): ' + r.out.trim().slice(-400));
      if (!/WARN/u.test(r.out)) throw new Error('WARN не напечатан: ' + r.out.trim().slice(-300));
      if (!r.out.includes('spec/checks/probe-lint-hint.mjs')) throw new Error('WARN не называет путь: ' + r.out.trim().slice(-300));
      if (!/mustFail/u.test(r.out)) throw new Error('WARN не советует mustFail: ' + r.out.trim().slice(-300));
      console.log('LINTHINTS OK c1');
    } finally { fs.rmSync(repo, { recursive: true, force: true }); }
  },
  /* c2: файл существует — предупреждения про mustPass нет. */
  c2() {
    const command = 'node spec/checks/probe-lint-hint.mjs';
    const repo = makeRepo({ command, fileExists: true });
    try {
      const r = lint(repo);
      if (r.code !== 0) throw new Error('lint отказал (exit ' + r.code + '): ' + r.out.trim().slice(-400));
      if (/которого ещё нет/u.test(r.out)) throw new Error('WARN напечатан при существующем файле: ' + r.out.trim().slice(-300));
      console.log('LINTHINTS OK c2');
    } finally { fs.rmSync(repo, { recursive: true, force: true }); }
  },
  /*
   * c3 (0155, R2 письма structure--243): критерий, чей файл отсутствует и НЕ
   * объявлен в allowedPaths, проверяет «Module not found», а не дефект — красный
   * формально доказан, чувствительности нет. Контроль: тот же путь, объявленный
   * в allowedPaths, предупреждения не даёт (работа его создаст).
   */
  c3() {
    const command = 'node spec/checks/probe-lint-hint.mjs';
    const missing = makeRepo({ command, fileExists: false, allowedPaths: ['docs/tasks/0001/**'], placement: 'mustFail' });
    try {
      const r = lint(missing);
      if (r.code !== 0) throw new Error('lint отказал на фикстуре (exit ' + r.code + '): ' + r.out.trim().slice(-400));
      if (!/дегенеративн/u.test(r.out)) throw new Error('WARN о дегенеративном критерии не напечатан: ' + r.out.trim().slice(-400));
      if (!r.out.includes('spec/checks/probe-lint-hint.mjs')) throw new Error('WARN не называет путь файла: ' + r.out.trim().slice(-400));
      if (!/C1/u.test(r.out)) throw new Error('WARN не называет критерий: ' + r.out.trim().slice(-400));
    } finally { fs.rmSync(missing, { recursive: true, force: true }); }

    const declared = makeRepo({ command, fileExists: false, allowedPaths: ['docs/tasks/0001/**', 'spec/checks/**'], placement: 'mustFail' });
    try {
      const r = lint(declared);
      if (r.code !== 0) throw new Error('lint отказал на контрольной фикстуре (exit ' + r.code + '): ' + r.out.trim().slice(-400));
      if (/дегенеративн/u.test(r.out)) throw new Error('WARN напечатан, хотя путь объявлен в allowedPaths: ' + r.out.trim().slice(-400));
    } finally { fs.rmSync(declared, { recursive: true, force: true }); }
    console.log('LINTHINTS OK c3');
  },
};

const which = process.argv[2];
if (!table[which]) {
  console.log('usage: node spec/checks/lint-hints.mjs c1|c2|c3');
  process.exit(2);
}
try {
  table[which]();
} catch (error) {
  console.log('LINTHINTS FAIL ' + which + ': ' + (error && error.message ? error.message : error));
  process.exit(1);
}
