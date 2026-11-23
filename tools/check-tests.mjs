#!/usr/bin/env node
/*
 * 0112 (2.6.99): выбор проверки по изменённым файлам.
 *
 *   node tools/check-tests.mjs [--dry-run] [--repo <корень>]
 *
 * Режимы:
 *  - full     — менялся код плагина (plugin/lib|test|tools): полный набор плагина;
 *  - affected — менялся движок (spec/**, tools/**): selftest + тесты, чьи
 *               зависимости затронуты (spec/scripts/tests-for.mjs);
 *  - selftest — изменений в коде нет (только docs/артефакты): selftest.
 *
 * Полный набор не пропускается там, где менялся код плагина: качество не
 * снижается, сокращается только простой движковых правок.
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PKG = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function git(repo, args) {
  return spawnSync('git', args, { cwd: repo, encoding: 'utf8' });
}

/** Какие пути считаем изменёнными (незакоммиченные + неотслеживаемые). */
export function changedPaths(repo) {
  const out = new Set();
  const status = git(repo || PKG, ['status', '--porcelain', '-z']);
  if (status.status === 0) {
    for (const item of String(status.stdout || '').split('\0')) {
      if (!item) continue;
      const raw = item.length > 3 ? item.slice(3) : item;
      if (raw) out.add(raw.split('\\').join('/'));
    }
  }
  return [...out].sort();
}

/** Решение по списку путей: full | affected | selftest. */
export function decide(changed) {
  const list = (Array.isArray(changed) ? changed : [])
    .map((p) => String(p).split('\\').join('/'))
    .filter((p) => p !== '' && !p.startsWith('docs/') && !p.startsWith('.dsh/') && !p.startsWith('dist/'));
  if (list.length === 0) return { mode: 'selftest', changed: [], reason: 'изменений в коде нет' };
  const plugin = list.filter((p) => /^plugin\/(lib|test|tools)\//u.test(p));
  if (plugin.length > 0) return { mode: 'full', changed: list, reason: 'изменён код плагина: ' + plugin.slice(0, 3).join(', ') };
  return { mode: 'affected', changed: list, reason: 'изменён движок или инструменты' };
}

/** Тесты, зависящие от перечисленных путей (по одному запуску tests-for). */
export function affectedTests(changed, repo) {
  const base = path.resolve(repo || PKG);
  const selected = new Set();
  for (const rel of changed) {
    if (!(rel.startsWith('spec/') || rel.startsWith('tools/'))) continue;
    const run = spawnSync(process.execPath, [path.join(base, 'spec/scripts/tests-for.mjs'), rel], { cwd: base, encoding: 'utf8' });
    if (run.status !== 0) continue;
    const line = String(run.stdout || '').trim();
    const match = /^node --test (.+)$/u.exec(line);
    if (!match) continue;
    for (const file of match[1].split(' ')) if (file) selected.add(file);
  }
  return [...selected].sort();
}

function run(nodeArgs) {
  const r = spawnSync(process.execPath, nodeArgs, { cwd: PKG, stdio: 'inherit' });
  return r.status === null ? 1 : r.status;
}

function main() {
  const argv = process.argv.slice(2);
  const dryRun = argv.includes('--dry-run');
  const repoIndex = argv.indexOf('--repo');
  const repo = repoIndex >= 0 ? path.resolve(argv[repoIndex + 1] || PKG) : PKG;
  const decision = decide(changedPaths(repo));
  const tests = decision.mode === 'affected' ? affectedTests(decision.changed, repo) : [];
  if (dryRun) {
    console.log(JSON.stringify({ mode: decision.mode, reason: decision.reason, changed: decision.changed, tests }, null, 2));
    return 0;
  }
  if (decision.mode === 'full') return run([path.join(PKG, 'plugin/tools/test.mjs')]);
  const selftest = run([path.join(PKG, 'spec/selftest.mjs')]);
  if (decision.mode === 'selftest' || tests.length === 0) return selftest;
  const mapped = run(['--test', ...tests.map((file) => path.join(PKG, file))]);
  return selftest === 0 && mapped === 0 ? 0 : 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exit(main());
}
