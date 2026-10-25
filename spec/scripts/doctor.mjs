#!/usr/bin/env node
/*
 * Проверка готовности рабочего пространства и харнесса.
 * Ничего не меняет: только читает и запускает безопасные команды.
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { findRepoRoot, loadConfig, exists, readJson } from './lib/common.mjs';
import { detectActor, assessIndependence } from './actor.mjs';
import { loadAcceptors } from './sign.mjs';

function args(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith('--')) { out[a.slice(2)] = next; i += 1; }
      else out[a.slice(2)] = true;
    } else out._.push(a);
  }
  return out;
}

const argv = args(process.argv.slice(2));
const repo = path.resolve(String(argv.repo || process.cwd()));
const checks = [];
function check(name, ok, detail, severity = 'fail') { checks.push({ name, ok, detail: detail || '', severity }); }

const major = Number(String(process.versions.node).split('.')[0]);
check('Node.js >= 20', major >= 20, 'сейчас ' + process.versions.node);

const gitVersion = spawnSync('git', ['--version'], { encoding: 'utf8' });
check('git доступен', gitVersion.status === 0, (gitVersion.stdout || '').trim());

const root = findRepoRoot(repo);
check('git-репозиторий найден', Boolean(root), root || 'нет .git: выполните git init');
if (root) {
  const config = loadConfig(root);
  check('workflow.config.json', config.loaded, config.file);
  const keysPath = path.join(root, config.keysFile);
  check('acceptors.json', exists(keysPath), keysPath);
  if (exists(keysPath)) {
    try {
      const list = loadAcceptors(keysPath);
      const bad = list.filter((key) => !String(key.keyId).startsWith(key.kind + '-'));
      check('ключи: kind совпадает с префиксом', bad.length === 0, bad.map((key) => key.keyId).join(', '));
      check('ключи: есть human-* для high-risk', list.some((key) => key.kind === 'human'), 'иначе high-risk не принимается человеком', 'warn');
    } catch (err) {
      check('acceptors.json читается', false, err.message);
    }
  }
  for (const file of ['templates/task.md', 'templates/criteria.json', 'scripts/task-accept.mjs']) {
    check('есть ' + file, exists(path.join(root, 'docs/subagent-workflow', file)));
  }
}

const actor = detectActor(process.env);
const independence = assessIndependence({ actor, issuedBy: null, executorSession: null, risk: 'medium' });
check('актор виден окружению', actor.attestedBy === 'env', actor.attestedBy + ' / ' + (actor.session || 'нет сессии'));
check('medium возможен в этой сессии', independence.ok, independence.errors.join('; '));

if (argv.json) console.log(JSON.stringify({ repo, checks }, null, 2));
else {
  for (const item of checks) {
    const mark = item.ok ? 'PASS' : item.severity === 'warn' ? 'WARN' : 'FAIL';
    console.log(mark.padEnd(6) + item.name + (item.detail ? '  — ' + item.detail : ''));
  }
  const failed = checks.filter((item) => !item.ok && item.severity !== 'warn').length;
  const warned = checks.filter((item) => !item.ok && item.severity === 'warn').length;
  console.log('');
  console.log(failed ? 'DOCTOR: ' + failed + ' проблем' : 'DOCTOR OK' + (warned ? ' (предупреждений: ' + warned + ')' : ''));
}
process.exit(checks.some((item) => !item.ok && item.severity !== 'warn') ? 1 : 0);
