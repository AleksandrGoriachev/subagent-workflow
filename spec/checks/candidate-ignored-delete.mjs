#!/usr/bin/env node
/*
 * 0154: кандидат несёт удаление объявленного пути даже под .gitignore.
 *
 * Дефект из письма structure--241 (задача 0352): `ignoredPaths` отбрасывал любой
 * путь, на который отвечает `git check-ignore`, — включая ОТСЛЕЖИВАЕМЫЙ. Путь
 * приходил из verify.changedPaths (покрытие проверено), но в кандидата не
 * попадал, и read-tree HEAD возвращал старую версию файла: удаление
 * `structure/graph.json` не доезжало до дерева приёмки.
 *
 *   c1 — фильтр пропускает отслеживаемый путь и отбрасывает неотслеживаемый
 *        игнорируемый; дерево кандидата, собранное теми же командами, что в
 *        task-accept, больше не содержит удалённый файл;
 *   c2 (негатив) — фикстура обязана воспроизводить дефект: `git check-ignore`
 *        отвечает на этот путь, то есть прежний фильтр его бы выбросил. Плюс
 *        исходник task-accept обязан использовать фильтр по неотслеживаемым:
 *        иначе проверка ловила бы регресс молча.
 *
 * Импортировать task-accept.mjs нельзя: у него нет main-стража, импорт запускает
 * приёмку. Поэтому c1/c2 работают на фикстуре теми же git-командами и сверяют
 * фильтр по исходнику — это ровно то место, где дефект жил.
 *
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

const ACCEPT = path.join(PKG, 'spec', 'scripts', 'task-accept.mjs');
const mode = String(process.argv[2] || '').toLowerCase();
let bad = 0;
function fail(tag, message) { bad += 1; console.log('FAIL ' + tag + ': ' + message); }

function git(cwd, args, env) {
  const r = spawnSyncPipeFree('git', ['-C', cwd, ...args], { cwd, encoding: 'utf8', timeout: 120000, env: env ? { ...process.env, ...env } : process.env });
  return { code: r.status, out: String(r.stdout || ''), err: String(r.stderr || '') };
}

/** Фикстура письма 241: .gitignore закрывает каталог, файл в нём — отслеживаемый. */
function makeRepo() {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-cand-ignored-'));
  const repo = path.join(base, 'repo');
  fs.mkdirSync(path.join(repo, 'structure'), { recursive: true });
  git(repo, ['init', '-q']);
  git(repo, ['config', 'user.email', 'p@l']);
  git(repo, ['config', 'user.name', 'p']);
  git(repo, ['config', 'core.autocrlf', 'false']);
  fs.writeFileSync(path.join(repo, '.gitignore'), '/structure/\ndist/\n');
  fs.writeFileSync(path.join(repo, 'structure', 'graph.json'), '{ "nodes": [] }\n');
  fs.writeFileSync(path.join(repo, 'README.md'), '# probe\n');
  git(repo, ['add', '-A']);
  git(repo, ['commit', '-qm', 'base']);
  /* Отслеживаемый файл удаляем в рабочей копии и фиксируем удаление в индексе. */
  fs.rmSync(path.join(repo, 'structure', 'graph.json'));
  git(repo, ['add', '-A', '--', 'structure/graph.json']);
  /* Неотслеживаемый игнорируемый мусор — он в кандидата попадать не должен. */
  fs.mkdirSync(path.join(repo, 'dist'), { recursive: true });
  fs.writeFileSync(path.join(repo, 'dist', 'junk.txt'), 'junk\n');
  return { base, repo };
}

/** Пути кандидата — как verify.changedPaths: объявленное удаление и мусор. */
function candidatePaths() {
  return ['structure/graph.json', 'dist/junk.txt', 'README.md'];
}

/** Фильтр из исправленного task-accept: только неотслеживаемые игнорируемые. */
function ignoredByFix(repo, paths) {
  const r = git(repo, ['ls-files', '--others', '--ignored', '--exclude-standard', '--', ...paths]);
  if (r.code !== 0) throw new Error('git ls-files --others --ignored: ' + r.err.trim());
  return new Set(r.out.split(/\r?\n/u).filter(Boolean));
}

/** Прежний (дефектный) фильтр — нужен только негативному контролю. */
function ignoredByCheckIgnore(repo, paths) {
  const r = git(repo, ['check-ignore', '--', ...paths]);
  return new Set(r.out.split(/\r?\n/u).filter(Boolean));
}

/** Дерево кандидата теми же командами, что в createCandidate. */
function candidateTree(repo, files) {
  const indexPath = path.join(repo, '..', 'candidate.index');
  const env = { GIT_INDEX_FILE: indexPath, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' };
  try {
    git(repo, ['read-tree', 'HEAD'], env);
    git(repo, ['add', '-A', '--', ...files], env);
    const tree = git(repo, ['write-tree'], env).out.trim();
    return tree;
  } finally {
    try { fs.rmSync(indexPath, { force: true }); } catch { /* индекс уже удалён */ }
  }
}

function treeHas(repo, tree, file) {
  const r = git(repo, ['cat-file', '-e', tree + ':' + file]);
  return r.code === 0;
}

if (mode === 'c1') {
  const f = makeRepo();
  const paths = candidatePaths();
  const ignored = ignoredByFix(f.repo, paths);
  if (ignored.has('structure/graph.json')) fail('c1', 'отслеживаемый путь выброшен фильтром: удаление не доедет до кандидата');
  if (!ignored.has('dist/junk.txt')) fail('c1', 'неотслеживаемый игнорируемый мусор остался: он не должен попадать в кандидата');
  const files = paths.filter((p) => !ignored.has(p));
  const tree = candidateTree(f.repo, files);
  if (!tree) fail('c1', 'дерево кандидата не собрано');
  else {
    if (treeHas(f.repo, tree, 'structure/graph.json')) fail('c1', 'файл остался в кандидате: удаление не применилось');
    if (!treeHas(f.repo, tree, 'README.md')) fail('c1', 'посторонний объявленный путь потерян');
    if (treeHas(f.repo, tree, 'dist/junk.txt')) fail('c1', 'мусор попал в кандидата');
  }
  if (bad === 0) console.log('CANDIDATE-IGNORED OK c1');
  process.exit(bad === 0 ? 0 : 1);
}

if (mode === 'c2') {
  const f = makeRepo();
  const paths = candidatePaths();
  /* Фикстура обязана воспроизводить дефект: иначе проверка ничего не доказывает. */
  const old = ignoredByCheckIgnore(f.repo, paths);
  if (!old.has('structure/graph.json')) fail('c2', 'фикстура не воспроизводит дефект: git check-ignore молчит про отслеживаемый путь');
  const fixed = ignoredByFix(f.repo, paths);
  if (fixed.has('structure/graph.json')) fail('c2', 'фильтр по неотслеживаемым всё равно выбросил отслеживаемый путь');
  /*
   * Исходник: фильтр кандидата обязан быть «только неотслеживаемые». Это
   * единственный способ поймать молчаливый откат к check-ignore, потому что
   * импортировать task-accept нельзя — импорт запускает приёмку.
   */
  const source = fs.readFileSync(ACCEPT, 'utf8');
  const filterBlock = (source.match(/export function ignoredPaths\([\s\S]*?\n\}/u) || [''])[0];
  if (filterBlock === '') fail('c2', 'в task-accept.mjs нет функции ignoredPaths');
  else {
    if (!/--others/u.test(filterBlock) || !/--ignored/u.test(filterBlock)) fail('c2', 'ignoredPaths не использует git ls-files --others --ignored');
    if (/check-ignore/u.test(filterBlock)) fail('c2', 'ignoredPaths снова опирается на check-ignore — отслеживаемые пути будут теряться');
  }
  if (bad === 0) console.log('CANDIDATE-IGNORED OK c2');
  process.exit(bad === 0 ? 0 : 1);
}

console.log('usage: node spec/checks/candidate-ignored-delete.mjs c1|c2');
process.exit(2);
