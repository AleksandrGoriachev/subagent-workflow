#!/usr/bin/env node
/*
 * 0036: doctor обязан заранее сказать, что закреплённый ключ нельзя использовать —
 * приватного нет. Иначе это выясняется на task-accept, после красного прогона.
 *
 * Сценарии (все — на временном репозитории с подменённым HOME):
 *   A. один пин без приватного, другой с приватным -> WARN с id и списком доступных, exit 0
 *   B. у всех пинов есть приватные -> предупреждения нет, exit 0
 *   C. ни у одного пина нет приватного -> FAIL, exit 1
 *   D. нужного отпечатка нет, но в штатном каталоге лежит чужой ключ -> WARN без «никаким»,
 *      exit 0: ключ можно передать явно в --key.
 *
 * --no-signable: только сценарий C (негативный контроль критерия C2).
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PKG = path.resolve(HERE, '..', '..');
const MODE_C = process.argv.includes('--no-signable');
const MODE_D = process.argv.includes('--wrong-fingerprint');

/* 0035: вне пакета каталога spec нет — развёрнутая копия печатает SKIP и выходит 0. */
if (!fs.existsSync(path.join(PKG, 'spec'))) {
  console.log('SKIP: проверка пакета вне пакета');
  process.exit(0);
}

const fail = (message) => {
  console.log((MODE_C ? 'NO-SIGNABLE FAIL: ' : MODE_D ? 'WRONG-FP FAIL: ' : 'DOCTOR KEYS FAIL: ') + message);
  process.exit(1);
};

function copyTree(from, to) {
  fs.mkdirSync(to, { recursive: true });
  for (const e of fs.readdirSync(from, { withFileTypes: true })) {
    const s = path.join(from, e.name), t = path.join(to, e.name);
    if (e.isDirectory()) copyTree(s, t);
    else if (e.isFile()) fs.copyFileSync(s, t);
  }
}

function makeKey() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  const publicKeyPem = publicKey.export({ type: 'spki', format: 'pem' }).toString();
  const privateKeyPem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
  const fingerprint = crypto.createHash('sha256').update(publicKey.export({ type: 'spki', format: 'der' })).digest('hex').slice(0, 16);
  return { publicKeyPem, privateKeyPem, fingerprint };
}

/* withPrivate — какие keyId получают приватный ключ в подменённом HOME. */
function makeRepo(withPrivate, stray) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-doc-keys-'));
  const repoDir = path.join(root, 'repo');
  const home = path.join(root, 'home');
  const engine = path.join(repoDir, 'docs', 'subagent-workflow');
  for (const dir of ['scripts', 'templates']) copyTree(path.join(PKG, 'spec', dir), path.join(engine, dir));
  fs.copyFileSync(path.join(PKG, 'spec', 'SPEC.md'), path.join(engine, 'SPEC.md'));
  fs.copyFileSync(path.join(PKG, 'VERSION'), path.join(engine, 'VERSION'));
  fs.mkdirSync(path.join(repoDir, 'docs', 'tasks'), { recursive: true });
  fs.writeFileSync(path.join(engine, 'workflow.config.json'), JSON.stringify({ tasksDir: 'docs/tasks', keysFile: 'docs/subagent-workflow/acceptors.json' }, null, 2), 'utf8');
  spawnSync('git', ['init', '-q'], { cwd: repoDir });
  fs.mkdirSync(path.join(home, '.wf-keys'), { recursive: true });
  const keys = { 'agent-judge': makeKey(), 'agent-judge-2': makeKey() };
  const acceptors = Object.entries(keys).map(([keyId, k]) => ({
    keyId, kind: 'agent', owner: 'acceptor', publicKeyPem: k.publicKeyPem,
    createdAt: '2026-11-02T00:00:00.000Z', fingerprint: k.fingerprint,
  }));
  fs.writeFileSync(path.join(engine, 'acceptors.json'), JSON.stringify({ acceptors }, null, 2), 'utf8');
  for (const keyId of withPrivate) {
    fs.writeFileSync(path.join(home, '.wf-keys', keyId + '.key.pem'), keys[keyId].privateKeyPem, 'utf8');
  }
  /* stray: под именем пина лежит ключ с другим отпечатком (ротация/чужой ключ). */
  if (stray) {
    const other = makeKey();
    fs.writeFileSync(path.join(home, '.wf-keys', stray + '.key.pem'), other.privateKeyPem, 'utf8');
  }
  return { root, repoDir, home, engine, keys };
}

function runDoctor(ctx) {
  const r = spawnSync(process.execPath, [path.join(ctx.engine, 'scripts', 'doctor.mjs'), '--repo', ctx.repoDir], {
    cwd: ctx.repoDir,
    encoding: 'utf8',
    timeout: 300000,
    env: { ...process.env, HOME: ctx.home, USERPROFILE: ctx.home, DSH_SESSION_ID: 'session-doctor-keys-test', TASK_ACTOR_SESSION: 'session-doctor-keys-test' },
  });
  return { code: r.status, out: String(r.stdout || '') + String(r.stderr || '') };
}

const scenarios = [];
const cleanup = [];
try {
  if (MODE_C) {
    const ctx = makeRepo([]);
    cleanup.push(ctx.root);
    const got = runDoctor(ctx);
    if (got.code === 0) fail('doctor не упал, хотя ни один пин не имеет приватного ключа');
    if (!/ни один закреплённый ключ/iu.test(got.out)) fail('нет сообщения про отсутствие пригодного ключа: ' + got.out.split('\n').filter((l) => /ключ/i.test(l)).join(' | ').slice(0, 200));
    console.log('NO-SIGNABLE OK: doctor падает, когда подписывать нечем');
    process.exit(0);
  }

  /* A: есть закреплённый ключ без приватного. */
  {
    const ctx = makeRepo(['agent-judge-2']);
    cleanup.push(ctx.root);
    const got = runDoctor(ctx);
    if (got.code !== 0) fail('сценарий A: doctor вышел ' + got.code + ' вместо 0 (нехватка ключа — предупреждение, а не отказ)');
    if (!/без приватного ключа/iu.test(got.out)) fail('сценарий A: нет предупреждения «без приватного ключа»');
    if (!got.out.includes('agent-judge')) fail('сценарий A: предупреждение не называет keyId agent-judge');
    if (!got.out.includes('agent-judge-2')) fail('сценарий A: нет подсказки, каким keyId подписывать');
  }

  /* B: все пины подписываемы — предупреждения быть не должно. */
  {
    const ctx = makeRepo(['agent-judge', 'agent-judge-2']);
    cleanup.push(ctx.root);
    const got = runDoctor(ctx);
    if (got.code !== 0) fail('сценарий B: doctor вышел ' + got.code + ' вместо 0');
    if (/без приватного ключа/iu.test(got.out)) fail('сценарий B: ложное предупреждение, хотя все ключи на месте');
  }

  /* D: нужного ключа нет, но под именем пина лежит чужой — WARN, а не «никаким». */
  {
    const ctx = makeRepo([], 'agent-judge');
    cleanup.push(ctx.root);
    const got = runDoctor(ctx);
    if (got.code !== 0) fail('сценарий D: doctor вышел ' + got.code + ' вместо 0 (чужой ключ — повод сказать, а не отказать)');
    if (/никаким/iu.test(got.out)) fail('сценарий D: противоречивое «подписывать можно: никаким»');
    if (!/подписывать нечем/iu.test(got.out)) fail('сценарий D: нет честного сообщения, что закреплённым ключом подписывать нечем');
  }

  console.log('DOCTOR KEYS OK: предупреждение о ключе без приватного, тишина когда ключи есть');
} finally {
  for (const root of cleanup) { try { fs.rmSync(root, { recursive: true, force: true }); } catch {} }
}
