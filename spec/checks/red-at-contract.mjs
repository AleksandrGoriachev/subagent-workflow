#!/usr/bin/env node
/*
 * 2.6.102 (0118): красный на контрактном дереве, когда HEAD ушёл вперёд.
 *
 * Повод — kanban, задание 0014. Контракт заперт на 66395a8, потом чужие коммиты
 * (релиз v0.4.2) увели HEAD на ca0cb13. task-verify (2.6.100) такой сдвиг терпит,
 * а task-red продолжает требовать HEAD == contractCommit. Перепрогнать красный
 * негде: verify требует redProven, redProven пишет только task-red, task-red
 * отказывает. Выход — гонять красный на дереве контракта, но не «где-то», а в
 * отдельном worktree на самом contractCommit.
 *
 * c1: без --at-contract отказ с подсказкой; с --at-contract красный идёт в worktree
 *     на contractCommit, red.json получает redTree и baseSha = contractCommit,
 *     проверка доказывает, что исполнялось ИМЕННО контрактное дерево (в HEAD есть
 *     файл, которого на контракте нет), worktree после прогона убран.
 * c2: task-hash --write не перевешивает замок после красного, даже если в red.json
 *     нет redProven (исторический артефакт) — раньше это был тихий обход.
 * c3: сообщение red-not-proven называет причину: артефакт старше 2.6.97, нет поля
 *     redProven, что делать.
 *
 * Вне пакета — SKIP (конвенция deployed-copy).
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PKG = path.resolve(HERE, '..', '..');

if (!fs.existsSync(path.join(PKG, 'spec'))) {
  console.log('SKIP: проверка пакета вне пакета');
  process.exit(0);
}

function truthy(value, label) {
  if (!value) throw new Error(label);
}

/*
 * Вывод дочерних процессов — в файлы, а не в пайпы: в ограниченной песочнице
 * spawn с stdio 'pipe' не может открыть именованный канал (EPERM).
 */
function run(cmd, args, cwd) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-redat-out-'));
  const outFile = path.join(dir, 'stdout');
  const errFile = path.join(dir, 'stderr');
  const ofd = fs.openSync(outFile, 'w');
  const efd = fs.openSync(errFile, 'w');
  let res;
  try {
    res = spawnSync(cmd, args, { cwd, timeout: 900000, windowsHide: true, stdio: ['ignore', ofd, efd] });
  } finally {
    try { fs.closeSync(ofd); } catch { /* ignore */ }
    try { fs.closeSync(efd); } catch { /* ignore */ }
  }
  let out = '';
  try { out = fs.readFileSync(outFile, 'utf8') + fs.readFileSync(errFile, 'utf8'); } catch { /* ignore */ }
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
  return { code: res.status, out };
}
function git(cwd, args) { return run('git', ['-C', cwd, ...args], cwd); }
function write(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
}
function copyTree(from, to) {
  fs.mkdirSync(to, { recursive: true });
  for (const e of fs.readdirSync(from, { withFileTypes: true })) {
    const s = path.join(from, e.name), t = path.join(to, e.name);
    if (e.isDirectory()) copyTree(s, t); else if (e.isFile()) fs.copyFileSync(s, t);
  }
}

const ID = '0001';
const TASK = 'docs/tasks/' + ID;
/*
 * Критерий доказывает, что исполнялось контрактное дерево: в HEAD лежит файл,
 * которого на контракте нет. На HEAD он падает, в worktree контракта — зелёный.
 * Логика — в файле задания, чтобы командная строка не зависела от кавычек Windows.
 */
const CHECK_TREE = [
  "import fs from 'node:fs';",
  "if (fs.existsSync('lib/only-in-head.txt')) { console.log('head tree'); process.exit(1); }",
  "console.log('contract tree');",
  "process.exit(0);",
  '',
].join('\n');
const CRITERION = 'node lib/check-tree.mjs';

function script(repo, name) {
  return path.join(repo, 'docs', 'subagent-workflow', 'scripts', name);
}

function makeRepo() {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-redat-'));
  git(repo, ['init', '-q']);
  git(repo, ['config', 'user.email', 'p@l']);
  git(repo, ['config', 'user.name', 'p']);
  git(repo, ['config', 'commit.gpgsign', 'false']);
  copyTree(path.join(PKG, 'spec'), path.join(repo, 'docs', 'subagent-workflow'));
  const dir = path.join(repo, 'docs', 'tasks', ID);
  const meta = {
    id: ID, version: 1, title: 'т', risk: 'low', created: '2026-11-04', owner: 'a',
    executor: 'subagent:executor', acceptor: 'subagent:judge',
    issuedBy: { kind: 'agent', session: 'issuer', model: 'm' }, base: 'HEAD', criteria: 'criteria.json',
    allowedPaths: ['lib/**', TASK + '/**'], protectedPaths: [],
    redAllowDirty: [TASK + '/**'], decisions: [], securityReview: false, humanSignoff: false, followUps: [],
  };
  const body = ['# Задание ' + ID, '', '<!-- TASK-META', JSON.stringify(meta, null, 2), '-->', '', '## Цель', '', 'x', '',
    '## Что не входит', '', 'x.', '', '## Инварианты', '', '1. x.', '', '## Границы знания', '', '1. x.', '',
    '## Среда', '', 'node.', '', '<!-- CRITERIA:BEGIN -->', '## Критерии приёмки', '',
    '| ID | Проверка | Ожидание |', '| --- | --- | --- |',
    '| C1 | ' + CRITERION + ' | exit 0 |', '<!-- CRITERIA:END -->',
    '', '## Отчёт', '', '1. x.', '', '## Коммит', '', 'x.', ''].join('\n');
  write(path.join(dir, 'task.md'), body);
  const criteria = {
    task: ID, setup: [], teardown: [],
    redExpect: { mustFail: [], mustPass: ['C1'], reasons: {}, noRed: { reason: 'смоук существующего сценария: на контракте зелёный' } },
    criteria: [{
      id: 'C1', title: 't', command: CRITERION, cwd: '.', timeoutMs: 120000,
      covers: ['lib/**'], tags: ['fast'], expect: { exitCode: 0, stdoutContains: 'contract tree' },
    }],
  };
  write(path.join(dir, 'criteria.json'), JSON.stringify(criteria, null, 2) + '\n');
  write(path.join(repo, 'lib', 'x.txt'), 'v1\n');
  write(path.join(repo, 'lib', 'check-tree.mjs'), CHECK_TREE);
  git(repo, ['add', '-A']);
  git(repo, ['commit', '-q', '-m', 'contract']);
  const contractCommit = git(repo, ['rev-parse', 'HEAD']).out.trim();
  const hash = run(process.execPath, [script(repo, 'task-hash.mjs'), '--task', TASK, '--write'], repo);
  truthy(hash.code === 0, 'task-hash --write в фикстуре не прошёл: ' + hash.out.trim().slice(-400));
  return { repo, dir, contractCommit };
}

/* Чужой коммит: меняет allowedPaths задания, но не его каталог. */
function foreignCommit(repo, marker) {
  write(path.join(repo, 'lib', 'x.txt'), 'v2-' + marker + '\n');
  write(path.join(repo, 'lib', 'only-in-head.txt'), marker + '\n');
  /* Только код: git add -A утащил бы criteria.lock в чужой коммит и сам сломал
   * фикстуру — артефакт задания в чужом коммите drift не терпит. */
  git(repo, ['add', 'lib']);
  git(repo, ['commit', '-q', '-m', 'foreign ' + marker]);
  return git(repo, ['rev-parse', 'HEAD']).out.trim();
}

function legacyRed(dir, baseSha, lock) {
  write(path.join(dir, 'red.json'), JSON.stringify({
    version: 5, kind: 'red', task: ID,
    createdAt: '2026-11-22T11:48:19.056Z', base: 'HEAD',
    baseSha, headSha: baseSha, contractCommit: baseSha,
    criteriaSha256: lock.criteriaSha256, criteriaJsonSha256: lock.criteriaJsonSha256,
    results: [], log: 'red.log',
  }, null, 2) + '\n');
  write(path.join(dir, 'red.log'), '# red\n');
}

function c1() {
  const fx = makeRepo();
  try {
    const head = foreignCommit(fx.repo, 'a');
    truthy(head !== fx.contractCommit, 'фикстура: HEAD не сдвинулся');

    /* Без флага — прежний отказ, но с подсказкой, а не «перезапустите task-hash». */
    const plain = run(process.execPath, [script(fx.repo, 'task-red.mjs'), '--task', TASK], fx.repo);
    truthy(plain.code !== 0, 'task-red без --at-contract прошёл при сдвиге HEAD');
    truthy(/--at-contract/u.test(plain.out), 'отказ не подсказывает --at-contract: ' + plain.out.trim().slice(-400));

    /* С флагом — красный на контрактном дереве. */
    const at = run(process.execPath, [script(fx.repo, 'task-red.mjs'), '--task', TASK, '--at-contract'], fx.repo);
    truthy(at.code === 0, 'task-red --at-contract не доказал красный (exit ' + at.code + '): ' + at.out.trim().slice(-600));

    const red = JSON.parse(fs.readFileSync(path.join(fx.dir, 'red.json'), 'utf8'));
    truthy(red.redProven === true, 'red.json: redProven не true');
    truthy(red.redKind === 'noRed', 'red.json: redKind не noRed (было ' + JSON.stringify(red.redKind) + ')');
    truthy(red.baseSha === fx.contractCommit,
      'red.json: baseSha ' + String(red.baseSha).slice(0, 12) + ' не равен контракту ' + fx.contractCommit.slice(0, 12));
    truthy(red.redTree && red.redTree.mode === 'contract-worktree', 'red.json: нет redTree.mode=contract-worktree');
    truthy(red.redTree && red.redTree.commit === fx.contractCommit, 'red.json: redTree.commit не равен контракту');

    /* Доказательство, что исполнялось контрактное дерево, а не HEAD. */
    const log = fs.readFileSync(path.join(fx.dir, 'red.log'), 'utf8');
    truthy(/contract tree/u.test(log), 'лог красного не показывает контрактное дерево: ' + log.slice(-500));
    truthy(!/head tree/u.test(log), 'критерий видел файл из HEAD — красный шёл не на контракте');

    /* Worktree убран: git не должен знать про временную копию. */
    const list = git(fx.repo, ['worktree', 'list', '--porcelain']).out;
    const count = list.split(/\r?\n/u).filter((line) => line.startsWith('worktree ')).length;
    truthy(count === 1, 'после прогона остался worktree (записей: ' + count + ')');
  } finally { fs.rmSync(fx.repo, { recursive: true, force: true }); }
  console.log('REDAT OK c1');
}

function c2() {
  const fx = makeRepo();
  try {
    /* Контроль: без red.json перезамок после сдвига HEAD разрешён. */
    foreignCommit(fx.repo, 'a');
    const before = run(process.execPath, [script(fx.repo, 'task-hash.mjs'), '--task', TASK, '--write'], fx.repo);
    truthy(before.code === 0, 'task-hash --write без red.json отказал: ' + before.out.trim().slice(-400));
    const lock = JSON.parse(fs.readFileSync(path.join(fx.dir, 'criteria.lock'), 'utf8'));

    /* Исторический red.json (до 2.6.97): нет redProven. Раньше guard --write
     * смотрел на redProven, поле отсутствовало — и замок молча перевешивался. */
    legacyRed(fx.dir, lock.contractCommit, lock);
    const head2 = foreignCommit(fx.repo, 'b');
    truthy(head2 !== lock.contractCommit, 'фикстура: HEAD не сдвинулся второй раз');
    const after = run(process.execPath, [script(fx.repo, 'task-hash.mjs'), '--task', TASK, '--write'], fx.repo);
    truthy(after.code !== 0, 'task-hash --write перевесил замок после красного (legacy red.json)');
    truthy(/заморожен|at-contract/u.test(after.out), 'отказ не объясняет запрет: ' + after.out.trim().slice(-400));
    const lockAfter = JSON.parse(fs.readFileSync(path.join(fx.dir, 'criteria.lock'), 'utf8'));
    truthy(lockAfter.contractCommit === lock.contractCommit, 'замок всё же переписан на новый HEAD');
  } finally { fs.rmSync(fx.repo, { recursive: true, force: true }); }
  console.log('REDAT OK c2');
}

function c3() {
  const fx = makeRepo();
  try {
    const lock = JSON.parse(fs.readFileSync(path.join(fx.dir, 'criteria.lock'), 'utf8'));
    legacyRed(fx.dir, lock.contractCommit, lock);
    const r = run(process.execPath, [script(fx.repo, 'task-verify.mjs'), '--task', TASK], fx.repo);
    truthy(r.code !== 0, 'task-verify принял исторический red.json без redProven');
    truthy(/red-not-proven/u.test(r.out), 'отказ не назван red-not-proven: ' + r.out.trim().slice(-400));
    truthy(/2\.6\.97/u.test(r.out), 'отказ не говорит, что артефакт старше 2.6.97: ' + r.out.trim().slice(-400));
    truthy(/at-contract/u.test(r.out), 'отказ не подсказывает --at-contract: ' + r.out.trim().slice(-400));
  } finally { fs.rmSync(fx.repo, { recursive: true, force: true }); }
  console.log('REDAT OK c3');
}

const table = { c1, c2, c3 };
const which = process.argv[2];
if (!table[which]) {
  console.log('usage: node spec/checks/red-at-contract.mjs c1|c2|c3');
  process.exit(2);
}
try {
  table[which]();
} catch (error) {
  console.log('REDAT FAIL ' + which + ': ' + (error && error.message ? error.message : error));
  process.exit(1);
}
