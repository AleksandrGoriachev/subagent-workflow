#!/usr/bin/env node
/*
 * Приёмочные проверки П0 из обратной связи ws-school-app (задание 0011).
 *
 * 1. Повторная приёмка: если запись приёмки уже лежит в HEAD (metadata-коммит),
 *    кандидат не должен её наследовать — иначе task-check-acceptance отказывает
 *    «acceptance.json входит в кандидатный коммит».
 * 2. Подсказка после приёмки печатает путь, который существует в развёрнутой
 *    копии (docs/subagent-workflow/scripts/…), а не scripts/….
 * 3. Обход без --note отклоняется ДО прогона критериев: verify.json не должен
 *    появиться (иначе полный прогон тратится зря).
 *
 * Каждый сценарий — одноразовый git-репозиторий с init из этого пакета.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PKG = path.resolve(HERE, '..', '..');
let failed = 0;
const pass = (name) => console.log('PASS ' + name);
const fail = (name, detail) => { failed += 1; console.log('FAIL ' + name + (detail ? ' — ' + detail : '')); };

function run(cmd, args, cwd, env) {
  const result = spawnSync(cmd, args, { cwd, encoding: 'utf8', env: env || process.env, timeout: 300000 });
  return { code: result.status, out: String(result.stdout || '') + String(result.stderr || '') };
}
function git(repo, args) {
  return run('git', ['-C', repo, ...args], repo);
}
function nodeAt(repo, rel, args) {
  const env = { ...process.env, DSH_SESSION_ID: 'judge-session' };
  return run(process.execPath, [path.join(repo, 'docs', 'subagent-workflow', 'scripts', rel), ...args], repo, env);
}
function write(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
}
function cleanup(dir) {
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
}

function makeRepo() {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-p0-'));
  const keys = repo + '-keys';
  git(repo, ['init', '-q']);
  git(repo, ['config', 'user.email', 'p0@local']);
  git(repo, ['config', 'user.name', 'p0']);
  const init = run(process.execPath, [path.join(PKG, 'spec', 'scripts', 'init.mjs'), '--repo', repo, '--force', '--key-out', keys], PKG);
  if (init.code !== 0) throw new Error('init: ' + init.out.trim());
  return { repo, keys };
}

function addLowTask(repo, id) {
  const dir = path.join(repo, 'docs', 'tasks', id);
  const meta = {
    id, version: 1, title: 'низкий риск', risk: 'low', created: '2026-10-28',
    owner: 'архитектор', executor: 'subagent:executor', acceptor: 'subagent:judge',
    issuedBy: { kind: 'agent', session: 'issuer-session', model: 'model-x' },
    base: 'HEAD', criteria: 'criteria.json',
    allowedPaths: ['docs/tasks/' + id + '/**'],
    protectedPaths: ['docs/tasks/' + id + '/task.md', 'docs/tasks/' + id + '/criteria.json'],
    redAllowDirty: ['docs/tasks/' + id + '/**'],
    hashExclude: [], decisions: [],
  };
  const body = ['# Задание ' + id, '', '<!-- TASK-META', JSON.stringify(meta, null, 2), '-->', '', '## Цель', '', 'Заглушка.', '', '<!-- CRITERIA:BEGIN -->', '## Критерии приёмки', '', '| ID | Проверка | Ожидание |', '| --- | --- | --- |', '| C1 | node -e "console.log(1)" | exit 0 |', '<!-- CRITERIA:END -->', ''].join('\n');
  write(path.join(dir, 'task.md'), body);
  write(path.join(dir, 'criteria.json'), JSON.stringify({ task: id, criteria: [
    { id: 'C1', title: 'зелёная проверка', command: 'node -e "console.log(1)"', timeoutMs: 60000, expect: { exitCode: 0 }, tags: ['fast'] },
  ] }, null, 2) + '\n');
}

function commit(repo, message) {
  git(repo, ['add', '-A']);
  const c = git(repo, ['commit', '-q', '-m', message]);
  if (c.code !== 0) throw new Error('commit: ' + c.out);
}

const ACCEPT_ARGS = (keys) => ['--task', 'docs/tasks/0001', '--acceptor', 'judge', '--key', path.join(keys, 'agent-judge.key.pem'), '--key-id', 'agent-judge'];

/* Сценарий A: запись уже в HEAD + повторная приёмка с --force. */
(function scenarioA() {
  const { repo, keys } = makeRepo();
  try {
    addLowTask(repo, '0001');
    commit(repo, 'task 0001: контракт');
    write(path.join(repo, 'docs', 'tasks', '0001', 'acceptance.json'), JSON.stringify({ task: '0001', status: 'accepted' }, null, 2) + '\n');
    commit(repo, 'task 0001: запись (ошибочно закоммичена)');
    const hash = nodeAt(repo, 'task-hash.mjs', ['--task', 'docs/tasks/0001', '--write']);
    if (hash.code !== 0) { fail('A: замок ставится', hash.out.trim().slice(0, 200)); return; }
    const verify = nodeAt(repo, 'task-verify.mjs', ['--task', 'docs/tasks/0001', '--allow-missing-red']);
    if (verify.code !== 0) { fail('A: verify проходит', verify.out.trim().slice(0, 200)); return; }
    const accept = nodeAt(repo, 'task-accept.mjs', [...ACCEPT_ARGS(keys), '--force', '--allow-missing-red', '--note', 'проверка повторной приёмки']);
    if (accept.code !== 0) { fail('A: повторная приёмка подписывается', accept.out.trim().slice(0, 300)); return; }
    pass('A: повторная приёмка подписывается');
    const record = JSON.parse(fs.readFileSync(path.join(repo, 'docs', 'tasks', '0001', 'acceptance.json'), 'utf8'));
    const candidate = record.candidateCommit;
    const inside = git(repo, ['cat-file', '-e', candidate + ':docs/tasks/0001/acceptance.json']);
    if (inside.code === 0) fail('A: кандидат не наследует acceptance.json из HEAD', 'запись есть в ' + candidate);
    else pass('A: кандидат не наследует acceptance.json из HEAD');
    const check = nodeAt(repo, 'task-check-acceptance.mjs', ['--file', 'docs/tasks/0001/acceptance.json', '--repo', '.']);
    if (check.code === 0) pass('A: запись принята проверкой'); else fail('A: запись принята проверкой', check.out.trim().slice(0, 300));
    if (accept.out.includes('docs/subagent-workflow/scripts/task-check-acceptance.mjs')) pass('A: подсказка печатает путь развёрнутой копии');
    else {
      const line = accept.out.split(/\r?\n/).find((l) => l.includes('task-check-acceptance')) || '(нет строки)';
      fail('A: подсказка печатает путь развёрнутой копии', line.trim().slice(0, 160));
    }
  } finally { cleanup(repo); cleanup(repo + '-keys'); }
})();

/* Сценарий B: обход без --note обязан упасть до прогона критериев. */
(function scenarioB() {
  const { repo, keys } = makeRepo();
  try {
    addLowTask(repo, '0001');
    commit(repo, 'task 0001: контракт');
    const hash = nodeAt(repo, 'task-hash.mjs', ['--task', 'docs/tasks/0001', '--write']);
    if (hash.code !== 0) { fail('B: замок ставится', hash.out.trim().slice(0, 200)); return; }
    const verify = nodeAt(repo, 'task-verify.mjs', ['--task', 'docs/tasks/0001', '--allow-missing-red']);
    if (verify.code !== 0) { fail('B: verify проходит', verify.out.trim().slice(0, 200)); return; }
    fs.rmSync(path.join(repo, 'docs', 'tasks', '0001', 'verify.json'), { force: true });
    const accept = nodeAt(repo, 'task-accept.mjs', [...ACCEPT_ARGS(keys), '--allow-missing-red']);
    const recreated = fs.existsSync(path.join(repo, 'docs', 'tasks', '0001', 'verify.json'));
    if (accept.code !== 0) pass('B: обход без --note отклоняется'); else fail('B: обход без --note отклоняется', 'exit=0');
    if (!recreated) pass('B: критерии не запускались (verify.json не создан)');
    else fail('B: критерии не запускались (verify.json не создан)', 'verify.json появился после отказа');
  } finally { cleanup(repo); cleanup(repo + '-keys'); }
})();

if (failed > 0) {
  console.log('');
  console.log('ACCEPTANCE P0 FAIL: ' + failed);
  process.exit(1);
}
console.log('');
console.log('ACCEPTANCE P0 OK');