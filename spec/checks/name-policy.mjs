#!/usr/bin/env node
/*
 * 0168: каталог задания — только четыре цифры, и это сказано.
 *   c1 — линт: суффикс в имени каталога — ошибка с правилом; каталог из цифр проходит;
 *   c2 — new-task отказывает до создания каталога и не создаёт его; цифровой id создаётся;
 *   c3 — сводка тени печатает «каталог не распознан» и не меняет код возврата.
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

const mode = String(process.argv[2] || '').toLowerCase();
let bad = 0;
function fail(tag, message) { bad += 1; console.log('FAIL ' + tag + ': ' + message); }

function run(cmd, args, cwd, env = {}) {
  const r = spawnSyncPipeFree(cmd, args, { cwd, encoding: 'utf8', timeout: 120000, env: { ...process.env, ...env } });
  return { code: r.status, out: String(r.stdout || '') + String(r.stderr || '') };
}

function normalContract(root, id) {
  const dir = path.join(root, 'docs', 'tasks', id);
  fs.mkdirSync(dir, { recursive: true });
  const meta = {
    id, version: 1, title: 'Проверка', risk: 'low', created: '2026-11-26', owner: 'координатор',
    executor: 'subagent:coordinator', acceptor: 'subagent:judge',
    issuedBy: { kind: 'agent', session: 'session-check', model: 'check' },
    base: 'HEAD', criteria: 'criteria.json', allowedPaths: ['tools/**'],
    redAllowDirty: ['docs/tasks/' + id + '/**'],
    decisions: [{ id: 'D1', class: 'mechanical', question: 'Как проверяется', chosen: 'Командой', options: ['Командой'], impact: 'internal', evidence: { kind: 'criterion', ref: 'C1' }, reversible: true }],
    resultShape: { artifact: 'файл', format: 'код', criterion: 'C1' },
    securityReview: false, humanSignoff: false, followUps: [],
  };
  fs.writeFileSync(path.join(dir, 'task.md'), [
    '# Задание ' + id + '. Проверка', '', '<!-- TASK-META', JSON.stringify(meta, null, 2), '-->', '',
    '## Цель', '', 'Проверить.', '',
    '## Что не входит', '', '1. Ничего.', '',
    '## Инварианты', '', '1. Проверка наблюдаемая.', '',
    '## Границы знания', '', '1. Только allowedPaths.', '',
    '## Среда', '', 'node 25.', '',
    '## Критерии приёмки', '', '<!-- CRITERIA:BEGIN -->',
    '| ID | Проверка | Ожидание |', '| --- | --- | --- |',
    '| C1 | `node -e "process.exit(0)"` | `exit 0` |', '', '<!-- CRITERIA:END -->', '',
    '## Отчёт', '', 'Отчёт — критерии.', '',
    '## Коммит', '', 'По правилам движка.', '',
  ].join('\n'));
  fs.writeFileSync(path.join(dir, 'criteria.json'), JSON.stringify({
    task: id,
    criteria: [{ id: 'C1', title: 'Проверка', command: 'node -e "process.exit(0)"', expect: { exitCode: 0 }, covers: ['tools/a.mjs'], tags: ['fast'] }],
  }, null, 2) + '\n');
  return dir;
}

if (mode === 'c1') {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-name-c1-'));
  try {
    const badDir = normalContract(root, '0001-bot');
    const r = run(process.execPath, [path.join(PKG, 'spec', 'scripts', 'task-lint.mjs'), '--task', badDir, '--repo', root], PKG);
    if (r.code === 0) fail('c1', 'линт пропустил каталог с суффиксом');
    if (!/только четыре цифры/u.test(r.out)) fail('c1', 'правило имени не названо: ' + r.out.trim().slice(-400));
    if (!/0001-bot/u.test(r.out)) fail('c1', 'каталог не назван: ' + r.out.trim().slice(-400));

    /* Контроль: каталог из четырёх цифр проходит. */
    const goodDir = normalContract(root, '0701');
    const ok = run(process.execPath, [path.join(PKG, 'spec', 'scripts', 'task-lint.mjs'), '--task', goodDir, '--repo', root], PKG);
    if (ok.code !== 0) fail('c1', 'каталог 0701 не прошёл линт: ' + ok.out.trim().slice(-500));
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
  if (bad === 0) console.log('NAME-POLICY OK c1');
  process.exit(bad === 0 ? 0 : 1);
}

if (mode === 'c2') {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-name-c2-'));
  try {
    /* new-task берёт шаблоны из проекта — копируем их в пустой корень. */
    fs.mkdirSync(path.join(root, 'docs', 'subagent-workflow'), { recursive: true });
    fs.cpSync(path.join(PKG, 'spec', 'templates'), path.join(root, 'docs', 'subagent-workflow', 'templates'), { recursive: true });
    const env = { WF_ACTOR_SESSION: 'session-check', DSH_MODEL: 'check' };
    const badRun = run(process.execPath, [path.join(PKG, 'spec', 'scripts', 'new-task.mjs'), '--id', '0001-bot', '--title', 'Проверка', '--risk', 'low', '--repo', root], PKG, env);
    if (badRun.code === 0) fail('c2', 'new-task принял id с суффиксом');
    if (!/четыре цифры/u.test(badRun.out)) fail('c2', 'правило не названо: ' + badRun.out.trim().slice(-400));
    if (fs.existsSync(path.join(root, 'docs', 'tasks', '0001-bot'))) fail('c2', 'каталог с суффиксом создан несмотря на отказ');

    /* Контроль: цифровой id создаётся. */
    const okRun = run(process.execPath, [path.join(PKG, 'spec', 'scripts', 'new-task.mjs'), '--id', '0702', '--title', 'Проверка', '--risk', 'low', '--repo', root], PKG, env);
    if (okRun.code !== 0) fail('c2', 'new-task не создал 0702: ' + okRun.out.trim().slice(-500));
    if (!fs.existsSync(path.join(root, 'docs', 'tasks', '0702', 'task.md'))) fail('c2', 'каталог 0702 не создан');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
  if (bad === 0) console.log('NAME-POLICY OK c2');
  process.exit(bad === 0 ? 0 : 1);
}

function shadowWorkspace(root, name, data) {
  const dir = path.join(root, 'docs', 'tasks', name);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'engine-shadow.json'), JSON.stringify(data, null, 2) + '\n');
}

if (mode === 'c3') {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-name-c3-'));
  try {
    shadowWorkspace(root, '0001-bot', { at: '2026-11-26T00:00:00.000Z', engineVerdict: 'accepted', acceptanceStatus: 'accepted', agree: true });
    shadowWorkspace(root, '0703', { at: '2026-11-26T00:00:00.000Z', engineVerdict: 'accepted', acceptanceStatus: 'accepted', agree: true });
    const r = run(process.execPath, [path.join(PKG, 'spec', 'scripts', 'engine-shadow-summary.mjs'), '--workspace', root], PKG);
    if (r.code !== 0) fail('c3', 'сводка вышла ' + r.code + ' вместо 0: ' + r.out.trim().slice(-400));
    if (!/каталог задания «0001-bot» не распознан/u.test(r.out)) fail('c3', 'нераспознанный каталог не назван: ' + r.out.trim().slice(-400));
    if (!/OK   0703/u.test(r.out)) fail('c3', 'обычное задание не посчитано: ' + r.out.trim().slice(-400));
    if (/DIFF 0001-bot/u.test(r.out)) fail('c3', 'нераспознанный каталог посчитан расхождением');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
  if (bad === 0) console.log('NAME-POLICY OK c3');
  process.exit(bad === 0 ? 0 : 1);
}

console.log('usage: node spec/checks/name-policy.mjs c1|c2|c3');
process.exit(2);
