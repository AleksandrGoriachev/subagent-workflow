#!/usr/bin/env node
/*
 * 0135 (2.6.109): снимок рабочего дерева на приёмке и роль в финализации.
 *
 * c1: правила parsePorcelainStatus/extrasAtRisk — что уничтожит git reset --hard
 *     (M вне keep — потеря, keep — нет, untracked — нет, удалённый — нет,
 *     переименование — новый путь, ignored — нет, кавычки и UTF-8 разбираются).
 * c2: finalizationLines: первая строка называет координатора и «приёмщик git не
 *     двигает», рядом с reset --hard — предупреждение; stashSnapshot видит стэш.
 * c3: worktreeSnapshot видит dirty tracked вне keep как extras (и не видит его при
 *     keep, включающем путь); реальный отказ accept-foreign-worktree на фикстуре,
 *     обход --allow-extras пишет блок worktree в запись, проверка её печатает.
 * c4: негатив — untracked и удалённые не потери; запись без блока worktree валидна.
 *
 * Настоящий репозиторий только читается. git init/add/commit/stash идут во
 * временных каталогах os.tmpdir — это фикстуры, не рабочее дерево пакета.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  spawnSyncPipeFree, parsePorcelainStatus, extrasAtRisk, stashSnapshot,
  worktreeSnapshot, finalizationLines,
} from '../scripts/lib/common.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PKG = path.resolve(HERE, '..', '..');
/* 2.6.2: проверка пакета (spec/checks) — в развёрнутой копии spec/SPEC.md нет. */
if (!fs.existsSync(path.join(PKG, 'spec', 'SPEC.md'))) {
  console.log('SKIP: проверка относится к пакету (spec/checks), а не к развёрнутой копии');
  process.exit(0);
}

function check(ok, message) {
  if (!ok) throw new Error(message);
}

function run(cmd, args, cwd, env) {
  const result = spawnSyncPipeFree(cmd, args, {
    cwd,
    encoding: 'utf8',
    env: env || process.env,
    timeout: 300000,
  });
  return { code: result.status, out: String(result.stdout || '') + String(result.stderr || '') };
}

function git(repo, args) {
  return run('git', ['-C', repo, ...args], repo);
}

function write(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
}

function cleanup(dir) {
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
}

function tail(text, size = 600) {
  const s = String(text || '').trim();
  return s.length > size ? s.slice(-size) : s;
}

function initRepo(prefix) {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  git(repo, ['init', '-q']);
  git(repo, ['config', 'user.email', 'aw@local']);
  git(repo, ['config', 'user.name', 'aw']);
  git(repo, ['config', 'commit.gpgsign', 'false']);
  return repo;
}

/* ---------- c1: что уничтожит reset --hard ---------- */
function c1() {
  const text = [
    ' M src/a.js',
    ' M keep/x.js',
    '?? untracked.txt',
    ' D gone.txt',
    'R  old.txt -> new.txt',
    ' M ignored.tmp',
    'A  added.txt',
    'RM staged.txt -> renamed2.txt',
    ' M "with space.txt"',
    '?? "with space new.txt"',
    ' M "\\321\\216\\320\\275\\320\\270\\320\\272\\320\\276\\320\\264.txt"',
  ].join('\n');
  const entries = parsePorcelainStatus(text);
  check(entries.length === 11, 'c1: разобрано ' + entries.length + ' строк из 11');
  const byPath = new Map(entries.map((entry) => [entry.path, entry]));

  const modified = byPath.get('src/a.js');
  check(modified && modified.code === ' M' && modified.index === ' ' && modified.worktree === 'M',
    'c1: строка M разобрана неверно: ' + JSON.stringify(modified));
  const rename = byPath.get('new.txt');
  check(rename && rename.code === 'R ' && rename.index === 'R', 'c1: переименование R  не разобрано: ' + JSON.stringify(rename));
  const renameModified = byPath.get('renamed2.txt');
  check(renameModified && renameModified.code === 'RM' && renameModified.worktree === 'M',
    'c1: переименование RM не разобрано: ' + JSON.stringify(renameModified));
  const spaced = byPath.get('with space.txt');
  check(spaced && spaced.worktree === 'M', 'c1: путь в кавычках не раскодирован: ' + JSON.stringify(spaced));
  const unicode = byPath.get('юникод.txt');
  check(unicode && unicode.code === ' M', 'c1: восьмеричные байты UTF-8 не декодированы: ' + JSON.stringify(unicode));

  const extras = extrasAtRisk(entries, { keep: ['keep/x.js'], ignored: ['ignored.tmp'] });
  check(extras.includes('src/a.js'), 'c1: M вне keep не попал в потери: ' + JSON.stringify(extras));
  check(extras.includes('added.txt'), 'c1: добавленный отслеживаемый файл не попал в потери');
  check(extras.includes('new.txt'), 'c1: переименование: новый путь не попал в потери');
  check(extras.includes('renamed2.txt'), 'c1: RM: новый путь не попал в потери');
  check(extras.includes('with space.txt'), 'c1: путь с пробелом не попал в потери');
  check(extras.includes('юникод.txt'), 'c1: путь UTF-8 не попал в потери');
  check(!extras.includes('keep/x.js'), 'c1: файл из keep посчитан потерей');
  check(!extras.includes('ignored.tmp'), 'c1: ignored посчитан потерей');
  check(!extras.includes('untracked.txt'), 'c1: untracked посчитан потерей');
  check(!extras.includes('gone.txt'), 'c1: удалённый ( D) посчитан потерей');
  console.log('AWORKTREE OK c1');
}

/* ---------- c2: роль в финализации и снимок стэшей ---------- */
function c2() {
  const lines = finalizationLines({
    candidate: '0123456789abcdef0123456789abcdef01234567',
    acceptanceRel: 'docs/tasks/0135/acceptance.json',
    gateRel: 'docs/tasks/0135/gates.jsonl',
    checkScriptRel: 'spec/scripts/task-check-acceptance.mjs',
  });
  check(Array.isArray(lines) && lines.length >= 4, 'c2: finalizationLines пуст');
  check(lines[0].includes('координатор'), 'c2: первая строка не называет координатора: ' + lines[0]);
  check(lines[0].includes('архитектор/релиз-инженер'), 'c2: первая строка не называет роль архитектора/релиз-инженера');
  check(lines[0].includes('приёмщик git не двигает'), 'c2: первая строка не говорит «приёмщик git не двигает»');
  const all = lines.join('\n');
  check(all.includes('git reset --hard 0123456789abcdef0123456789abcdef01234567'), 'c2: нет команды git reset --hard <candidate>');
  const reset = lines.find((line) => line.includes('git reset --hard'));
  check(/уничтожит/u.test(reset), 'c2: рядом с reset --hard нет предупреждения «уничтожит»: ' + reset);
  check(/незакоммиченные/u.test(reset) && /отслеживаемые/u.test(reset) && /вне кандидата/u.test(reset),
    'c2: предупреждение не говорит о незакоммиченных отслеживаемых правках вне кандидата: ' + reset);
  check(lines.some((line) => line.includes('git add docs/tasks/0135/acceptance.json docs/tasks/0135/gates.jsonl')),
    'c2: нет команды git add acceptance.json gates.jsonl');
  check(lines.some((line) => line.includes('git commit -m "task 0135: приёмка (metadata)"')),
    'c2: нет команды git commit metadata');
  check(lines.some((line) => line.includes('spec/scripts/task-check-acceptance.mjs')),
    'c2: нет подсказки о проверке записи');

  const repo = initRepo('wf-aw-stash-');
  try {
    write(path.join(repo, 'a.txt'), '1\n');
    check(git(repo, ['add', '-A']).code === 0, 'c2: фикстура: git add не прошёл');
    check(git(repo, ['commit', '-q', '-m', 'init']).code === 0, 'c2: фикстура: коммит не создан');
    write(path.join(repo, 'a.txt'), '2\n');
    const pushed = git(repo, ['stash', 'push', '-m', '0135 probe stash']);
    check(pushed.code === 0, 'c2: git stash push не прошёл: ' + tail(pushed.out));
    const stashes = stashSnapshot(repo);
    check(Array.isArray(stashes) && stashes.length === 1, 'c2: stashSnapshot не увидел созданный стэш: ' + JSON.stringify(stashes));
    check(stashes[0].includes('0135 probe stash'), 'c2: снимок стэша без сообщения: ' + stashes[0]);
    check(stashes[0].startsWith('stash@{0}'), 'c2: снимок стэша без %gd: ' + stashes[0]);
  } finally {
    cleanup(repo);
  }
  console.log('AWORKTREE OK c2');
}

/* ---------- фикстура полной приёмки (как acceptance-p0) ---------- */
function makeInitRepo(prefix) {
  const repo = initRepo(prefix);
  const keys = repo + '-keys';
  const init = run(process.execPath, [
    path.join(PKG, 'spec', 'scripts', 'init.mjs'),
    '--repo', repo, '--force', '--key-out', keys,
  ], PKG);
  if (init.code !== 0) {
    cleanup(repo);
    cleanup(keys);
    throw new Error('фикстура: init не прошёл: ' + tail(init.out));
  }
  return { repo, keys };
}

function nodeAt(repo, rel, args) {
  const script = path.join(repo, 'docs', 'subagent-workflow', 'scripts', rel);
  return run(process.execPath, [script, ...args], repo, { ...process.env, DSH_SESSION_ID: 'judge-session' });
}

function addLowTask(repo, id) {
  const dir = path.join(repo, 'docs', 'tasks', id);
  const meta = {
    id, version: 1, title: 'низкий риск', risk: 'low', created: '2026-11-24',
    owner: 'архитектор', executor: 'subagent:executor', acceptor: 'subagent:judge',
    issuedBy: { kind: 'agent', session: 'issuer-session', model: 'model-x' },
    base: 'HEAD', criteria: 'criteria.json',
    allowedPaths: ['docs/tasks/' + id + '/**'],
    protectedPaths: ['docs/tasks/' + id + '/task.md', 'docs/tasks/' + id + '/criteria.json'],
    redAllowDirty: ['docs/tasks/' + id + '/**'],
    hashExclude: [], decisions: [],
  };
  const body = [
    '# Задание ' + id, '', '<!-- TASK-META', JSON.stringify(meta, null, 2), '-->', '',
    '## Цель', '', 'Заглушка.', '',
    '<!-- CRITERIA:BEGIN -->', '## Критерии приёмки', '',
    '| ID | Проверка | Ожидание |', '| --- | --- | --- |',
    '| C1 | node -e "console.log(1)" | exit 0 |', '<!-- CRITERIA:END -->', '',
  ].join('\n');
  write(path.join(dir, 'task.md'), body);
  write(path.join(dir, 'criteria.json'), JSON.stringify({
    task: id,
    criteria: [
      { id: 'C1', title: 'зелёная проверка', command: 'node -e "console.log(1)"', timeoutMs: 60000, expect: { exitCode: 0 }, tags: ['fast'] },
    ],
  }, null, 2) + '\n');
}

function commitAll(repo, message) {
  const add = git(repo, ['add', '-A']);
  check(add.code === 0, 'фикстура: git add: ' + tail(add.out));
  const commit = git(repo, ['commit', '-q', '-m', message]);
  check(commit.code === 0, 'фикстура: git commit: ' + tail(commit.out));
}

function acceptArgs(keys) {
  return [
    '--task', 'docs/tasks/0001',
    '--acceptor', 'judge',
    '--key', path.join(keys, 'agent-judge.key.pem'),
    '--key-id', 'agent-judge',
    '--allow-missing-red',
    '--note', 'фикстура 0135: красного прогона нет (low-risk)',
  ];
}

/* ---------- c3: снимок на фикстуре и реальный отказ ---------- */
function c3() {
  /* Часть A: worktreeSnapshot и keep — на чистом временном репозитории. */
  const repo = initRepo('wf-aw-snap-');
  try {
    write(path.join(repo, 'docs', 'dirty.txt'), '1\n');
    write(path.join(repo, 'docs', 'clean.txt'), '1\n');
    commitAll(repo, 'init');
    write(path.join(repo, 'docs', 'dirty.txt'), '2\n');
    const outside = worktreeSnapshot(repo, { keep: [] });
    check(Array.isArray(outside.extras) && outside.extras.includes('docs/dirty.txt'),
      'c3: worktreeSnapshot не увидел dirty tracked вне keep: ' + JSON.stringify(outside.extras));
    check(outside.trackedChanges >= 1, 'c3: trackedChanges не посчитан: ' + outside.trackedChanges);
    check(/^[0-9a-f]{40}$/u.test(String(outside.headBefore)), 'c3: headBefore не SHA: ' + outside.headBefore);
    check(/^[0-9a-f]{40}$/u.test(String(outside.head)), 'c3: head не SHA: ' + outside.head);
    check(Array.isArray(outside.stashes) && outside.stashes.length === 0, 'c3: stashes не массив');
    const inside = worktreeSnapshot(repo, { keep: ['docs/dirty.txt'] });
    check(!inside.extras.includes('docs/dirty.txt'),
      'c3: путь из keep всё равно посчитан потерей: ' + JSON.stringify(inside.extras));
  } finally {
    cleanup(repo);
  }

  /* Часть B: реальный task-accept на фикстуре с правкой чужой задачи. */
  const fixture = makeInitRepo('wf-aw-accept-');
  try {
    addLowTask(fixture.repo, '0001');
    /* Чужая задача закоммичена в контракт: её dirty-правка в кандидата не войдёт. */
    write(path.join(fixture.repo, 'docs', 'tasks', '0099', 'task.md'), '# Задание 0099\n');
    /* Метка обхода: хук guard фикстуры иначе не даст закоммитить чужой каталог. */
    commitAll(fixture.repo, 'task 0001: контракт [workflow-bypass: фикстура 0135]');

    const hash = nodeAt(fixture.repo, 'task-hash.mjs', ['--task', 'docs/tasks/0001', '--write']);
    check(hash.code === 0, 'c3: task-hash не прошёл: ' + tail(hash.out));
    const verify = nodeAt(fixture.repo, 'task-verify.mjs', ['--task', 'docs/tasks/0001', '--allow-missing-red']);
    check(verify.code === 0, 'c3: task-verify не прошёл: ' + tail(verify.out));

    fs.appendFileSync(path.join(fixture.repo, 'docs', 'tasks', '0099', 'task.md'), '\n# чужая незакоммиченная правка\n');
    const refusal = nodeAt(fixture.repo, 'task-accept.mjs', acceptArgs(fixture.keys));
    check(refusal.code !== 0, 'c3: приёмка не отказала на чужих правках (exit=0)');
    check(refusal.out.includes('accept-foreign-worktree'), 'c3: нет кода отказа accept-foreign-worktree: ' + tail(refusal.out));
    check(refusal.out.includes('docs/tasks/0099/task.md'), 'c3: отказ не называет путь: ' + tail(refusal.out));
    check(!fs.existsSync(path.join(fixture.repo, 'docs', 'tasks', '0001', 'acceptance.json')),
      'c3: при отказе запись всё равно подписана');

    const allowed = nodeAt(fixture.repo, 'task-accept.mjs', [
      ...acceptArgs(fixture.keys), '--allow-extras', '--note', '0135: проверка обхода',
    ]);
    check(allowed.code === 0, 'c3: --allow-extras не продолжил приёмку: ' + tail(allowed.out));
    const acceptanceFile = path.join(fixture.repo, 'docs', 'tasks', '0001', 'acceptance.json');
    check(fs.existsSync(acceptanceFile), 'c3: запись приёмки не создана');
    const record = JSON.parse(fs.readFileSync(acceptanceFile, 'utf8'));
    const wt = record.worktree;
    check(wt && typeof wt === 'object' && !Array.isArray(wt), 'c3: в записи нет блока worktree');
    check(Array.isArray(wt.extras) && wt.extras.includes('docs/tasks/0099/task.md'),
      'c3: extras не содержит чужой путь: ' + JSON.stringify(wt.extras));
    check(/^[0-9a-f]{40}$/u.test(String(wt.headBefore)), 'c3: worktree.headBefore не SHA: ' + wt.headBefore);
    check(/^[0-9a-f]{40}$/u.test(String(wt.head)), 'c3: worktree.head не SHA: ' + wt.head);
    check(Number.isInteger(wt.trackedChanges) && wt.trackedChanges >= 1, 'c3: worktree.trackedChanges не число: ' + wt.trackedChanges);
    check(Array.isArray(wt.stashes), 'c3: worktree.stashes не массив');
    check(record.bypasses && record.bypasses.allowExtras === true, 'c3: обход не записан в bypasses.allowExtras');
    check(String(record.notes || '').includes('allow-extras'), 'c3: обход не записан в notes: ' + String(record.notes || ''));

    const checker = nodeAt(fixture.repo, 'task-check-acceptance.mjs', [
      '--file', 'docs/tasks/0001/acceptance.json', '--repo', '.',
    ]);
    check(checker.out.includes('worktree headBefore'), 'c3: проверка записи не печатает headBefore: ' + tail(checker.out));
    check(checker.out.includes('worktree trackedChanges'), 'c3: проверка записи не печатает trackedChanges: ' + tail(checker.out));
    check(checker.out.includes('worktree stashes'), 'c3: проверка записи не печатает stashes: ' + tail(checker.out));
    check(checker.out.includes('worktree extras docs/tasks/0099/task.md'),
      'c3: проверка записи не печатает extras: ' + tail(checker.out));
    check(checker.out.includes('в рабочем дереве были правки вне кандидата'),
      'c3: проверка записи не отмечает правки вне кандидата: ' + tail(checker.out));
  } finally {
    cleanup(fixture.repo);
    cleanup(fixture.keys);
  }
  console.log('AWORKTREE OK c3');
}

/* ---------- c4: негатив и запись без блока ---------- */
function validateSchema(schema, value, where = '') {
  /* Подмножество draft-07 из acceptance-schema.mjs: работаем без ajv. */
  const errors = [];
  if (!schema || typeof schema !== 'object') return errors;
  const name = where || 'значение';
  if ('const' in schema && value !== schema.const) errors.push(name + ': ожидалось ' + JSON.stringify(schema.const));
  if (Array.isArray(schema.enum) && !schema.enum.includes(value)) errors.push(name + ': допустимо ' + JSON.stringify(schema.enum));
  if (schema.type !== undefined) {
    const types = Array.isArray(schema.type) ? schema.type : [schema.type];
    const actual = value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value;
    const normalize = (type) => (type === 'integer' ? 'number' : type);
    if (!types.map(normalize).includes(normalize(actual))) errors.push(name + ': тип ' + actual + ', ожидался ' + types.join('|'));
  }
  if (typeof value === 'string') {
    if (schema.minLength !== undefined && value.length < schema.minLength) errors.push(name + ': короче ' + schema.minLength);
    if (schema.pattern !== undefined && !new RegExp(schema.pattern).test(value)) errors.push(name + ': не соответствует /' + schema.pattern + '/');
  }
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    for (const key of schema.required || []) if (!(key in value)) errors.push(name + ': нет обязательного поля ' + key);
    const properties = schema.properties || {};
    for (const [key, child] of Object.entries(properties)) {
      if (key in value) errors.push(...validateSchema(child, value[key], (where ? where + '.' : '') + key));
    }
    if (schema.additionalProperties === false) {
      for (const key of Object.keys(value)) if (!(key in properties)) errors.push(name + ': лишнее поле ' + key);
    }
  }
  return errors;
}

function minimalRecord() {
  return {
    version: 4,
    status: 'accepted',
    task: '0001',
    risk: 'low',
    taskFileSha256: 'a'.repeat(64),
    criteriaSha256: 'b'.repeat(64),
    criteriaJsonSha256: 'c'.repeat(64),
    contractCommit: 'a'.repeat(40),
    baseCommit: 'a'.repeat(40),
    candidateCommit: 'b'.repeat(40),
    tree: 'c'.repeat(40),
    worktreeDigest: 'd'.repeat(64),
    issuedBy: { kind: 'agent', session: 'issuer-session' },
    actor: { kind: 'agent', session: 'judge-session', keyId: 'agent-judge', attestedBy: 'env' },
    independence: { level: 'separate-session', separateSession: true, reportWithheld: true, keyCustody: 'agent-key' },
    acceptorRun: { fresh: true, runKind: 'accept', nonce: 'n', verifySha256: 'e'.repeat(64) },
    bypasses: {},
    checks: [],
    acceptor: 'judge',
    acceptedAt: '2026-11-24T12:00:00.000Z',
    humanSignoff: false,
    signatureAlgorithm: 'ed25519',
    keyId: 'agent-judge',
    publicKeyFingerprint: 'f'.repeat(16),
    signature: 's'.repeat(32),
  };
}

function c4() {
  const entries = parsePorcelainStatus([
    '?? untracked-a.txt',
    ' D deleted-b.txt',
    '!! ignored-c.txt',
  ].join('\n'));
  const extras = extrasAtRisk(entries, { keep: [], ignored: [] });
  check(extras.length === 0, 'c4: untracked/удалённые попали в потери: ' + JSON.stringify(extras));

  const schema = JSON.parse(fs.readFileSync(path.join(PKG, 'spec', 'templates', 'acceptance.schema.json'), 'utf8'));
  check(!Array.isArray(schema.required) || !schema.required.includes('worktree'),
    'c4: схема требует блок worktree у всех записей');
  const wtSchema = schema.properties && schema.properties.worktree;
  check(wtSchema && wtSchema.type === 'object', 'c4: в схеме нет worktree object');
  check(wtSchema.additionalProperties === false, 'c4: worktree без additionalProperties: false');
  for (const key of ['headBefore', 'head', 'trackedChanges', 'extras', 'stashes']) {
    check(wtSchema.properties && wtSchema.properties[key], 'c4: в схеме worktree нет свойства ' + key);
  }
  const legacy = minimalRecord();
  const legacyErrors = validateSchema(schema, legacy);
  check(legacyErrors.length === 0, 'c4: запись без worktree не проходит схему: ' + legacyErrors.join('; '));
  const withWorktree = {
    ...legacy,
    worktree: {
      headBefore: 'a'.repeat(40),
      head: 'a'.repeat(40),
      trackedChanges: 0,
      extras: [],
      stashes: [],
    },
  };
  const worktreeErrors = validateSchema(schema, withWorktree);
  check(worktreeErrors.length === 0, 'c4: запись с worktree не проходит схему: ' + worktreeErrors.join('; '));
  const unknown = { ...withWorktree, worktree: { ...withWorktree.worktree, vendor: 'x' } };
  check(validateSchema(schema, unknown).length > 0, 'c4: лишнее поле в worktree не отклоняется');

  /*
   * Реальная историческая запись без worktree (0134, 2.6.108) проходит
   * task-check-acceptance: отсутствие блока не ошибка и не note.
   */
  const legacyFile = path.join(PKG, 'docs', 'tasks', '0134', 'acceptance.json');
  if (fs.existsSync(legacyFile)) {
    const record = JSON.parse(fs.readFileSync(legacyFile, 'utf8'));
    check(record.worktree === undefined, 'c4: историческая 0134 уже содержит worktree — фикстура устарела');
    const checked = run(process.execPath, [
      path.join(PKG, 'spec', 'scripts', 'task-check-acceptance.mjs'),
      '--file', legacyFile,
      '--repo', PKG,
      '--task', 'docs/tasks/0134',
    ], PKG);
    check(checked.code === 0, 'c4: историческая запись без worktree не проходит проверку: ' + tail(checked.out));
    check(!checked.out.includes('worktree headBefore'), 'c4: проверка печатает worktree для записи без блока');
  }
  console.log('AWORKTREE OK c4');
}

/* ---------- c5: чужой артефакт, объявленный в allowedPaths ---------- */
function c5() {
  const fixture = makeInitRepo('wf-aw-declared-');
  try {
    addLowTask(fixture.repo, '0001');
    /* Контракт объявляет чужой артефакт: покрытие и границы задаёт allowedPaths. */
    const taskMd = path.join(fixture.repo, 'docs', 'tasks', '0001', 'task.md');
    const body = fs.readFileSync(taskMd, 'utf8').replace(
      '"allowedPaths": [\n    "docs/tasks/0001/**"\n  ]',
      '"allowedPaths": [\n    "docs/tasks/0001/**",\n    "docs/tasks/0099/engine-shadow.json"\n  ]',
    );
    fs.writeFileSync(taskMd, body);
    const criteriaFile = path.join(fixture.repo, 'docs', 'tasks', '0001', 'criteria.json');
    const criteria = JSON.parse(fs.readFileSync(criteriaFile, 'utf8'));
    criteria.criteria[0].covers = ['docs/tasks/0099/engine-shadow.json'];
    fs.writeFileSync(criteriaFile, JSON.stringify(criteria, null, 2) + '\n');

    write(path.join(fixture.repo, 'docs', 'tasks', '0099', 'engine-shadow.json'), '{"agree":false}\n');
    commitAll(fixture.repo, 'task 0001: контракт с чужим артефактом [workflow-bypass: фикстура 0145]');

    const hash = nodeAt(fixture.repo, 'task-hash.mjs', ['--task', 'docs/tasks/0001', '--write']);
    check(hash.code === 0, 'c5: task-hash не прошёл: ' + tail(hash.out));
    const verify = nodeAt(fixture.repo, 'task-verify.mjs', ['--task', 'docs/tasks/0001', '--allow-missing-red']);
    check(verify.code === 0, 'c5: task-verify не прошёл: ' + tail(verify.out));

    /* Правка объявленного чужого артефакта — своё изменение, обход не нужен. */
    write(path.join(fixture.repo, 'docs', 'tasks', '0099', 'engine-shadow.json'), '{"agree":true}\n');
    const accept = nodeAt(fixture.repo, 'task-accept.mjs', acceptArgs(fixture.keys));
    check(accept.code === 0, 'c5: приёмка отказала на объявленном артефакте: ' + tail(accept.out));
    check(!accept.out.includes('accept-foreign-worktree'), 'c5: сработал отказ на объявленный путь: ' + tail(accept.out));
    const record = JSON.parse(fs.readFileSync(path.join(fixture.repo, 'docs', 'tasks', '0001', 'acceptance.json'), 'utf8'));
    check(Array.isArray(record.worktree && record.worktree.extras) && record.worktree.extras.length === 0,
      'c5: объявленный путь попал в extras: ' + JSON.stringify(record.worktree && record.worktree.extras));
    const checker = nodeAt(fixture.repo, 'task-check-acceptance.mjs', ['--file', 'docs/tasks/0001/acceptance.json', '--repo', '.']);
    check(!/в рабочем дереве были правки вне кандидата/u.test(checker.out), 'c5: проверка записи видит несуществующие правки: ' + tail(checker.out));
  } finally {
    cleanup(fixture.repo);
    cleanup(fixture.keys);
  }
  console.log('AWORKTREE OK c5');
}

/* ---------- c6: объяснённый extras — WARN, без объяснения — ERROR ---------- */
function c6() {
  const fixture = makeInitRepo('wf-aw-explained-');
  try {
    addLowTask(fixture.repo, '0001');
    write(path.join(fixture.repo, 'docs', 'tasks', '0099', 'task.md'), '# Задание 0099\n');
    commitAll(fixture.repo, 'task 0001: контракт [workflow-bypass: фикстура 0145]');
    const hash = nodeAt(fixture.repo, 'task-hash.mjs', ['--task', 'docs/tasks/0001', '--write']);
    check(hash.code === 0, 'c6: task-hash не прошёл: ' + tail(hash.out));
    const verify = nodeAt(fixture.repo, 'task-verify.mjs', ['--task', 'docs/tasks/0001', '--allow-missing-red']);
    check(verify.code === 0, 'c6: task-verify не прошёл: ' + tail(verify.out));
    fs.appendFileSync(path.join(fixture.repo, 'docs', 'tasks', '0099', 'task.md'), '\n# чужая правка\n');
    const accept = nodeAt(fixture.repo, 'task-accept.mjs', [
      ...acceptArgs(fixture.keys), '--allow-extras', '--note', '0145: фикстура объяснённого обхода',
    ]);
    check(accept.code === 0, 'c6: --allow-extras не продолжил приёмку: ' + tail(accept.out));

    const explained = nodeAt(fixture.repo, 'task-check-acceptance.mjs', ['--file', 'docs/tasks/0001/acceptance.json', '--repo', '.']);
    check(explained.code === 0, 'c6: объяснённый extras не принят (exit ' + explained.code + '): ' + tail(explained.out));
    check(explained.out.includes('в рабочем дереве были правки вне кандидата'), 'c6: WARN не назвал правки: ' + tail(explained.out));
    check(!/check-acceptance: ERROR/u.test(explained.out), 'c6: объяснённый extras дал ERROR: ' + tail(explained.out));

    /* Тот же extras без обхода: WARN не применяется, extras остаётся ошибкой. */
    const bare = JSON.parse(fs.readFileSync(path.join(fixture.repo, 'docs', 'tasks', '0001', 'acceptance.json'), 'utf8'));
    delete bare.bypasses.allowExtras;
    const bareFile = path.join(fixture.repo, 'docs', 'tasks', '0001', 'acceptance-bare.json');
    fs.writeFileSync(bareFile, JSON.stringify(bare, null, 2) + '\n');
    const strict = nodeAt(fixture.repo, 'task-check-acceptance.mjs', ['--file', 'docs/tasks/0001/acceptance-bare.json', '--repo', '.']);
    check(strict.code !== 0, 'c6: extras без обхода принят (exit 0)');
    check(strict.out.includes('в рабочем дереве были правки вне кандидата'), 'c6: отказ не назвал extras: ' + tail(strict.out));
  } finally {
    cleanup(fixture.repo);
    cleanup(fixture.keys);
  }
  console.log('AWORKTREE OK c6');
}

const table = { c1, c2, c3, c4, c5, c6 };
const which = process.argv[2];
if (!table[which]) {
  console.log('usage: node spec/checks/accept-worktree.mjs c1|c2|c3|c4|c5|c6');
  process.exit(2);
}
try {
  table[which]();
} catch (error) {
  console.log('AWORKTREE FAIL ' + which + ': ' + (error && error.message ? error.message : error));
  process.exit(1);
}
