#!/usr/bin/env node
/* Задание 0031: проверки CI и хуков смотрят на поведение, а не на подстроку (2.6.8).
 * A) ослабленный хук (exit 0) должен быть пойман hooks-mode;
 * B) шаг guard-acceptance, оставленный только в комментарии, должен быть пойман ci-guard-step;
 * C) нетронутая копия — обе проверки зелёные;
 * D) шаг chmod +x spec/hooks/* в CI — hooks-mode краснеет. */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSyncPipeFree } from '../scripts/lib/common.mjs';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PKG = path.resolve(HERE, '..', '..');
/* Задание 0035: вне пакета каталога spec нет — развёрнутая копия печатает SKIP и выходит 0. */
if (!fs.existsSync(path.join(PKG, 'spec'))) {
  console.log('SKIP: проверка пакета вне пакета');
  process.exit(0);
}
let failed = 0;
const pass = (n) => console.log('PASS ' + n);
const fail = (n, d) => { failed += 1; console.log('FAIL ' + n + (d ? ' — ' + d : '')); };
function run(cmd, args, cwd) { const r = spawnSyncPipeFree(cmd, args, { cwd, encoding: 'utf8', timeout: 900000 }); return { code: r.status, out: String(r.stdout || '') + String(r.stderr || '') }; }
function git(cwd, args) { return run('git', ['-C', cwd, ...args], cwd); }
function copyPkg() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-ci-'));
  const tar = spawnSyncPipeFree('git', ['-C', PKG, 'archive', 'HEAD'], { encoding: 'buffer' });
  if (tar.status !== 0) throw new Error('git archive failed');
  fs.mkdirSync(path.join(dir, 'pkg'), { recursive: true });
  /* Помощник пишет вывод в файлы и закрывает stdin: архив HEAD кладём в файл,
   * а распаковщику отдаём его через -f — смысл `git archive | tar -x` сохранён. */
  const archive = path.join(dir, 'head.tar');
  fs.writeFileSync(archive, tar.stdout);
  const t = spawnSyncPipeFree('tar', ['-x', '-f', archive, '-C', path.join(dir, 'pkg')]);
  if (t.status !== 0) throw new Error('tar failed');
  const pkg = path.join(dir, 'pkg');
  /* Изменённые и новые файлы рабочего дерева поверх HEAD: иначе проверки из критериев
   * гоняют старые версии и «красный» не воспроизводится в незакоммиченном дереве. */
  const changed = run('git', ['-C', PKG, 'ls-files', '-m', '-o', '--exclude-standard', '-z'], PKG);
  for (const rel of changed.out.split('\0')) {
    if (!rel) continue;
    const src = path.join(PKG, rel);
    if (!fs.existsSync(src) || fs.statSync(src).isDirectory()) continue;
    fs.mkdirSync(path.dirname(path.join(pkg, rel)), { recursive: true });
    fs.copyFileSync(src, path.join(pkg, rel));
  }
  git(pkg, ['init', '-q']); git(pkg, ['config', 'user.email', 'p@l']); git(pkg, ['config', 'user.name', 'p']);
  git(pkg, ['add', '-A']);
  for (const h of ['pre-commit', 'commit-msg', 'pre-push']) git(pkg, ['update-index', '--chmod=+x', 'spec/hooks/' + h]);
  git(pkg, ['commit', '-q', '-m', 'copy']);
  return pkg;
}
function hooksMode(pkg) { return run(process.execPath, [path.join(pkg, 'spec', 'checks', 'hooks-mode.mjs')], pkg); }
function guardStep(pkg) { return run(process.execPath, [path.join(pkg, 'spec', 'checks', 'ci-guard-step.mjs')], pkg); }
const cleanups = [];
function cleanup() { for (const d of cleanups) { try { fs.rmSync(d, { recursive: true, force: true }); } catch {} } }

/* C. Контроль: нетронутая копия — обе зелёные. */
let pkg = copyPkg(); cleanups.push(pkg);
try {
  const h = hooksMode(pkg), g = guardStep(pkg);
  if (h.code === 0 && g.code === 0) pass('C: нетронутая копия — обе проверки зелёные');
  else fail('C: нетронутая копия — обе проверки зелёные', 'hooks=' + h.code + ' ci=' + g.code + ' ' + (h.out + g.out).trim().slice(-220));
} catch (e) { fail('C: нетронутая копия', e.message); }

/* A. Ослабленный хук: файл на месте, режим 100755, но exit 0 — поведение проверкой не ловится. */
pkg = copyPkg(); cleanups.push(pkg);
try {
  fs.writeFileSync(path.join(pkg, 'spec', 'hooks', 'pre-commit'), '#!/bin/sh\nexit 0\n');
  git(pkg, ['update-index', '--chmod=+x', 'spec/hooks/pre-commit']); git(pkg, ['add', '-A']);
  const h = hooksMode(pkg);
  if (h.code !== 0) pass('A: ослабленный хук — hooks-mode краснеет');
  else fail('A: ослабленный хук — hooks-mode краснеет', 'exit=0');
} catch (e) { fail('A: ослабленный хук', e.message); }

/* B. Шаг guard-acceptance только в комментарии. */
pkg = copyPkg(); cleanups.push(pkg);
try {
  const file = path.join(pkg, '.github', 'workflows', 'ci.yml');
  const text = fs.readFileSync(file, 'utf8');
  const mutated = text.replace(/^\s*- name: guard-acceptance[^\n]*\n\s*run: node spec\/checks\/guard-acceptance\.mjs --all\s*$/m, '      # node spec/checks/guard-acceptance.mjs --all');
  fs.writeFileSync(file, mutated, 'utf8');
  const g = guardStep(pkg);
  if (g.code !== 0) pass('B: шаг только в комментарии — ci-guard-step краснеет');
  else fail('B: шаг только в комментарии — ci-guard-step краснеет', 'exit=0');
} catch (e) { fail('B: шаг только в комментарии', e.message); }

/* D. chmod в CI чинит права под тестами. */
pkg = copyPkg(); cleanups.push(pkg);
try {
  const file = path.join(pkg, '.github', 'workflows', 'ci.yml');
  fs.appendFileSync(file, '\n# тестовый шаг\n');
  fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace('      - name: режим хуков в индексе', '      - name: chmod\n        run: chmod +x spec/hooks/*\n      - name: режим хуков в индексе'));
  const h = hooksMode(pkg);
  if (h.code !== 0) pass('D: chmod в CI — hooks-mode краснеет');
  else fail('D: chmod в CI — hooks-mode краснеет', 'exit=0');
} catch (e) { fail('D: chmod в CI', e.message); }

cleanup();
if (failed > 0) { console.log(''); console.log('CI BEHAVIOR FAIL: ' + failed); process.exit(1); }
console.log(''); console.log('CI BEHAVIOR OK');