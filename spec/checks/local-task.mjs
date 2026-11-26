#!/usr/bin/env node
/*
 * 0170: локальное задание без коммитов (vcs=none, только light+low).
 *   c1 — verify в каталоге без git: vcs=none, head=local, проверки исполнены;
 *   c2 — линт: vcs=none без light или при risk>low — отказ; light+vcs=none проходит;
 *   c3 — сквозная приёмка без git: подпись, vcs=none, кандидата нет, digest есть,
 *        запись проверяется task-check-acceptance.
 * Вне пакета — SKIP (конвенция deployed-copy).
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
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
  const r = spawnSyncPipeFree(cmd, args, { cwd, encoding: 'utf8', timeout: 300000, env: { ...process.env, ...env } });
  return { code: r.status, out: String(r.stdout || '') + String(r.stderr || '') };
}

function contractText(id, { light = true, risk = 'low', vcs = 'none', checks } = {}) {
  const meta = {
    id, version: 1, title: 'Локальная проверка', risk, created: '2026-11-26', owner: 'координатор',
    executor: 'subagent:coordinator', acceptor: 'subagent:judge',
    issuedBy: { kind: 'agent', session: 'session-issuer', model: 'check' },
    base: 'HEAD', allowedPaths: ['tools/**'], redAllowDirty: ['docs/tasks/' + id + '/**'],
    decisions: [{ id: 'D1', class: 'mechanical', question: 'q', chosen: 'c', options: ['o'], impact: 'internal', evidence: { kind: 'criterion', ref: 'C1' }, reversible: true }],
    resultShape: { artifact: 'a', format: 'f', criterion: 'C1' },
    securityReview: false, humanSignoff: false, followUps: [],
  };
  if (light) meta.mode = 'light';
  if (vcs !== '') meta.vcs = vcs;
  if (light || vcs === 'none') {
    meta.checks = checks === undefined
      ? [{ id: 'C1', title: 'Проверка', command: 'node -e "process.exit(0)"', expect: { exitCode: 0 } }]
      : checks;
  } else {
    meta.criteria = 'criteria.json';
  }
  return {
    meta,
    text: [
      '# Задание ' + id + '. Локальная проверка', '', '<!-- TASK-META', JSON.stringify(meta, null, 2), '-->', '',
      '## Цель', '', 'Проверить.', '',
      '## Что не входит', '', '1. Ничего.', '',
      '## Инварианты', '', '1. Наблюдаемо.', '',
      '## Границы знания', '', '1. Только allowedPaths.', '',
      '## Среда', '', 'node 25.', '',
      '## Критерии приёмки', '', '<!-- CRITERIA:BEGIN -->',
      '| ID | Проверка | Ожидание |', '| --- | --- | --- |',
      '| C1 | `node -e "process.exit(0)"` | `exit 0` |', '', '<!-- CRITERIA:END -->', '',
      '## Отчёт', '', 'Отчёт — критерии.', '',
      '## Коммит', '', 'Локально, без git.', '',
    ].join('\n'),
  };
}

function makeLocalDir(id, opts = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-local-' + id + '-'));
  const taskDir = path.join(root, 'docs', 'tasks', id);
  fs.mkdirSync(taskDir, { recursive: true });
  const built = contractText(id, opts);
  fs.writeFileSync(path.join(taskDir, 'task.md'), built.text);
  fs.mkdirSync(path.join(root, 'tools'), { recursive: true });
  fs.writeFileSync(path.join(root, 'tools', 'a.mjs'), 'export const a = 1;\n');
  return { root, taskDir, meta: built.meta };
}

if (mode === 'c1') {
  const ws = makeLocalDir('0901');
  try {
    const r = run(process.execPath, [path.join(PKG, 'spec', 'scripts', 'task-verify.mjs'), '--task', ws.taskDir, '--repo', ws.root, '--allow-missing-red'], ws.root);
    if (r.code !== 0) fail('c1', 'verify без git отказал: ' + r.out.trim().slice(-800));
    const record = JSON.parse(fs.readFileSync(path.join(ws.taskDir, 'verify.json'), 'utf8'));
    if (record.vcs !== 'none') fail('c1', 'в verify.json нет vcs=none: ' + JSON.stringify(record.vcs));
    if (record.headSha !== 'local') fail('c1', 'headSha не local: ' + JSON.stringify(record.headSha));
    if (!Array.isArray(record.results) || !record.results.some((x) => String(x.id) === 'C1' && x.passed === true)) fail('c1', 'проверка C1 не исполнена');
    if (!/VCS/u.test(fs.readFileSync(path.join(ws.taskDir, 'verify.log'), 'utf8'))) fail('c1', 'в логе нет строки про отсутствие VCS-гейтов');
  } finally { fs.rmSync(ws.root, { recursive: true, force: true }); }
  if (bad === 0) console.log('LOCAL-TASK OK c1');
  process.exit(bad === 0 ? 0 : 1);
}

if (mode === 'c2') {
  const lint = (root, taskDir) => run(process.execPath, [path.join(PKG, 'spec', 'scripts', 'task-lint.mjs'), '--task', taskDir, '--repo', root], PKG);
  const a = makeLocalDir('0902', { vcs: 'none', light: true });
  try {
    const ok = lint(a.root, a.taskDir);
    if (ok.code !== 0) fail('c2', 'light+vcs=none не прошёл линт: ' + ok.out.trim().slice(-500));
  } finally { fs.rmSync(a.root, { recursive: true, force: true }); }

  const b = makeLocalDir('0903', { vcs: 'none', light: false });
  try {
    fs.writeFileSync(path.join(b.taskDir, 'criteria.json'), JSON.stringify({ task: '0903', criteria: [{ id: 'C1', title: 't', command: 'node -e "process.exit(0)"', expect: { exitCode: 0 } }] }, null, 2) + '\n');
    const r = lint(b.root, b.taskDir);
    if (r.code === 0) fail('c2', 'vcs=none без mode=light прошёл линт');
    if (!/vcs=none/u.test(r.out) || !/mode=light/u.test(r.out)) fail('c2', 'правило пары не названо: ' + r.out.trim().slice(-400));
  } finally { fs.rmSync(b.root, { recursive: true, force: true }); }

  const c = makeLocalDir('0904', { risk: 'medium' });
  try {
    const r = lint(c.root, c.taskDir);
    if (r.code === 0) fail('c2', 'vcs=none при medium прошёл линт');
    if (!/risk=low/u.test(r.out)) fail('c2', 'риск не назван: ' + r.out.trim().slice(-400));
  } finally { fs.rmSync(c.root, { recursive: true, force: true }); }
  if (bad === 0) console.log('LOCAL-TASK OK c2');
  process.exit(bad === 0 ? 0 : 1);
}

function makeKey(root) {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  const privatePem = privateKey.export({ type: 'pkcs8', format: 'pem' });
  const publicPem = publicKey.export({ type: 'spki', format: 'pem' });
  const keyFile = path.join(root, 'judge.key.pem');
  fs.writeFileSync(keyFile, privatePem);
  fs.mkdirSync(path.join(root, 'docs', 'subagent-workflow'), { recursive: true });
  fs.writeFileSync(path.join(root, 'docs', 'subagent-workflow', 'workflow.config.json'), JSON.stringify({
    version: 1, tasksDir: 'docs/tasks', keysFile: 'docs/subagent-workflow/acceptors.json', logs: 'local',
  }, null, 2) + '\n');
  fs.writeFileSync(path.join(root, 'docs', 'subagent-workflow', 'acceptors.json'), JSON.stringify({
    acceptors: [{ keyId: 'agent-judge', kind: 'agent', owner: 'acceptor', publicKeyPem: publicPem, createdAt: '2026-11-26T00:00:00.000Z' }],
  }, null, 2) + '\n');
  return keyFile;
}

if (mode === 'c3') {
  const ws = makeLocalDir('0905');
  try {
    const keyFile = makeKey(ws.root);
    const env = { DSH_SESSION_ID: 'session-judge-local', DSH_MODEL: 'check' };
    const acc = run(process.execPath, [path.join(PKG, 'spec', 'scripts', 'task-accept.mjs'),
      '--task', ws.taskDir, '--repo', ws.root, '--key', keyFile, '--key-id', 'agent-judge',
      '--deviation', 'пакет вне разрешённых корней спавна узла judge (root-not-allowed); приёмку выполняет отдельная сессия',
      '--note', 'локальная задача без git (vcs=none)'], ws.root, env);
    if (acc.code !== 0) fail('c3', 'приёмка без git отказала: ' + acc.out.trim().slice(-900));
    const acceptanceFile = path.join(ws.taskDir, 'acceptance.json');
    if (!fs.existsSync(acceptanceFile)) fail('c3', 'acceptance.json не создан');
    else {
      const record = JSON.parse(fs.readFileSync(acceptanceFile, 'utf8'));
      if (record.status !== 'accepted') fail('c3', 'статус не accepted: ' + record.status);
      if (record.vcs !== 'none') fail('c3', 'в записи нет vcs=none');
      if (record.candidateCommit !== null || record.tree !== null) fail('c3', 'локальная запись ссылается на коммит/дерево');
      if (typeof record.worktreeDigest !== 'string' || record.worktreeDigest === '') fail('c3', 'нет worktreeDigest');
      const check = run(process.execPath, [path.join(PKG, 'spec', 'scripts', 'task-check-acceptance.mjs'),
        '--file', acceptanceFile, '--repo', ws.root, '--task', 'docs/tasks/0905'], ws.root);
      if (check.code !== 0) fail('c3', 'check-acceptance отверг локальную запись: ' + check.out.trim().slice(-700));
      if (!/запись корректна/u.test(check.out)) fail('c3', 'check-acceptance не подтвердил запись: ' + check.out.trim().slice(-500));
    }
  } finally { fs.rmSync(ws.root, { recursive: true, force: true }); }
  if (bad === 0) console.log('LOCAL-TASK OK c3');
  process.exit(bad === 0 ? 0 : 1);
}

console.log('usage: node spec/checks/local-task.mjs c1|c2|c3');
process.exit(2);
