#!/usr/bin/env node
/*
 * Проверка развёртывания — отдельный шаг CI.
 *
 * Регрессия 2.0.2: init, запущенный из уже развёрнутого каталога, копировал
 * acceptors.json, и новое пространство оставалось с публичным ключом без пары
 * (приёмка падала уже на первом задании). Здесь это ловится узко и быстро:
 *
 *   init из пакета → A (свой ключ)
 *   init из A → B (свой ключ, не ключ A; скрипты свежие)
 *   повторный init в B не пересоздаёт ключ
 *   doctor и new-task в B работают
 *
 * Полный цикл задачи проверяет e2e.mjs; этот сценарий — только развёртывание.
 */
import fs from 'node:fs';
import os from 'node:os';
import crypto from 'node:crypto';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PKG = path.resolve(HERE, '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wf2-deploy-'));
const repoA = path.join(tmp, 'a');
const repoB = path.join(tmp, 'b');
const keysA = path.join(tmp, 'keys-a');
const keysB = path.join(tmp, 'keys-b');
const WORKFLOW = 'docs/subagent-workflow';
let failed = 0;

function report(label, ok, detail) {
  if (ok) console.log('PASS  ' + label);
  else { failed += 1; console.log('FAIL  ' + label + (detail ? '\n      ' + String(detail).slice(0, 1200) : '')); }
}

function runNode(script, args, opts = {}) {
  const r = spawnSync(process.execPath, [script, ...args], {
    cwd: opts.cwd || tmp,
    env: { ...process.env, ...(opts.env || {}) },
    encoding: 'utf8',
    timeout: 300000,
  });
  return { code: r.status, out: (r.stdout || '') + (r.stderr || '') };
}

function git(cwd, args) {
  const r = spawnSync('git', ['-C', cwd, ...args], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error('git ' + args.join(' ') + ': ' + r.stderr);
}

function readPem(file) {
  return fs.existsSync(file) ? fs.readFileSync(file, 'utf8').trim() : null;
}

function keyIds(repo) {
  const file = path.join(repo, WORKFLOW, 'acceptors.json');
  return JSON.parse(fs.readFileSync(file, 'utf8')).acceptors;
}

/* Файлы дерева, без состояния конкретного пространства. */
const STATE_FILES = new Set(['acceptors.json', 'workflow.config.json']);

function listFiles(dir, base = dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, entry.name);
    const rel = path.relative(base, abs).split(path.sep).join('/');
    if (entry.isDirectory()) listFiles(abs, base, out);
    else out.push(rel);
  }
  return out;
}

function diffTree(src, dst) {
  const srcFiles = listFiles(src).filter((rel) => !STATE_FILES.has(rel)).sort();
  const dstFiles = listFiles(dst).filter((rel) => !STATE_FILES.has(rel)).sort();
  const missing = srcFiles.filter((rel) => !dstFiles.includes(rel));
  const extra = dstFiles.filter((rel) => !srcFiles.includes(rel));
  const changed = srcFiles.filter((rel) => {
    if (!dstFiles.includes(rel)) return false;
    return !fs.readFileSync(path.join(src, rel)).equals(fs.readFileSync(path.join(dst, rel)));
  });
  return { missing, extra, changed };
}

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

try {
  for (const dir of [repoA, repoB]) {
    fs.mkdirSync(dir, { recursive: true });
    git(dir, ['init', '-q']);
    git(dir, ['config', 'user.email', 'deploy@local']);
    git(dir, ['config', 'user.name', 'deploy']);
  }

  const initA = runNode(path.join(HERE, 'scripts', 'init.mjs'), ['--repo', repoA, '--key-out', keysA, '--key-id', 'agent-judge']);
  report('init из пакета разворачивает пространство', initA.code === 0, initA.out);
  report(
    'пространство A получает закреплённый публичный ключ и приватный ключ',
    fs.existsSync(path.join(repoA, WORKFLOW, 'acceptors.json')) && fs.existsSync(path.join(keysA, 'agent-judge.key.pem')),
  );

  const deployDiff = diffTree(HERE, path.join(repoA, WORKFLOW));
  report(
    'развёрнутое дерево совпадает с пакетом (кроме acceptors.json и конфигурации)',
    deployDiff.missing.length === 0 && deployDiff.extra.length === 0 && deployDiff.changed.length === 0,
    JSON.stringify(deployDiff),
  );
  const configA = JSON.parse(fs.readFileSync(path.join(repoA, WORKFLOW, 'workflow.config.json'), 'utf8'));
  report('конфигурация A: каталог заданий и logs по умолчанию', configA.tasksDir === 'docs/tasks' && configA.logs === 'local', JSON.stringify(configA));
  report('A игнорирует журналы прогонов', fs.readFileSync(path.join(repoA, '.gitignore'), 'utf8').includes('docs/tasks/**/*.log'));

  const deployedInit = path.join(repoA, WORKFLOW, 'scripts', 'init.mjs');
  const initB = runNode(deployedInit, ['--repo', repoB, '--key-out', keysB]);
  report('init из развёрнутого каталога разворачивает второе пространство', initB.code === 0, initB.out);

  const keyFileA = path.join(keysA, 'agent-judge.key.pem');
  const keyFileB = path.join(keysB, 'agent-judge.key.pem');
  report('у B есть свой приватный ключ', fs.existsSync(keyFileB));
  report(
    'приватный ключ B не скопирован из A',
    Boolean(readPem(keyFileB)) && readPem(keyFileB) !== readPem(keyFileA),
  );

  const idsA = keyIds(repoA);
  const idsB = keyIds(repoB);
  report(
    'публичные ключи A и B разные (acceptors.json не скопирован)',
    idsB.length === 1 && idsB[0].keyId === 'agent-judge' && idsB[0].publicKeyPem !== idsA[0].publicKeyPem,
    JSON.stringify({ a: idsA[0].fingerprint, b: idsB[0] && idsB[0].fingerprint }),
  );

  const leaked = listFiles(repoB).filter((rel) => /\.key\.pem$/i.test(rel));
  report('в дереве B нет приватных ключей', leaked.length === 0, leaked.join(', '));

  const scriptsDiff = diffTree(path.join(HERE, 'scripts'), path.join(repoB, WORKFLOW, 'scripts'));
  report(
    'скрипты B побайтно равны скриптам пакета (свежая копия)',
    scriptsDiff.missing.length === 0 && scriptsDiff.extra.length === 0 && scriptsDiff.changed.length === 0,
    JSON.stringify(scriptsDiff),
  );

  const acceptorsB = path.join(repoB, WORKFLOW, 'acceptors.json');
  const before = { keys: sha256(acceptorsB), priv: readPem(keyFileB) };
  const initAgain = runNode(path.join(repoB, WORKFLOW, 'scripts', 'init.mjs'), ['--repo', repoB, '--key-out', keysB]);
  report(
    'повторный init в B не пересоздаёт закреплённый ключ',
    initAgain.code === 0 && sha256(acceptorsB) === before.keys && readPem(keyFileB) === before.priv,
    initAgain.out,
  );

  const doctor = runNode(path.join(repoB, WORKFLOW, 'scripts', 'doctor.mjs'), ['--repo', repoB], { cwd: repoB, env: { DSH_SESSION_ID: 'deploy-doctor', DSH_MODEL: 'deploy-model' } });
  report('doctor в B зелёный', doctor.code === 0 && /DOCTOR OK/.test(doctor.out), doctor.out);

  const task = runNode(path.join(repoB, WORKFLOW, 'scripts', 'new-task.mjs'), ['--repo', repoB, '--id', '0001', '--title', 'Проверка развёртывания', '--risk', 'medium'], { cwd: repoB, env: { DSH_SESSION_ID: 'deploy-session', DSH_MODEL: 'deploy-model' } });
  const taskFile = path.join(repoB, 'docs/tasks/0001/task.md');
  report(
    'new-task в B создаёт задание с issuedBy из сессии',
    task.code === 0 && fs.existsSync(taskFile) && fs.readFileSync(taskFile, 'utf8').includes('deploy-session') && fs.existsSync(path.join(repoB, 'docs/tasks/0001/criteria.json')),
    task.out,
  );
} catch (err) {
  failed += 1;
  console.error('DEPLOY E2E ERROR: ' + err.stack);
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}

if (failed) {
  console.log('\nDEPLOY E2E FAILED: ' + failed);
  process.exit(1);
}
console.log('\nDEPLOY E2E OK');
