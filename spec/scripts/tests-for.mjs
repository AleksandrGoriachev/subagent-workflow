#!/usr/bin/env node
/*
 * 0043: «изменённые файлы → минимальный набор тестов».
 *
 * Читает plugin/test/*.test.mjs, разбирает их относительные импорты (статические
 * import/export ... from, побочные import '...', динамические import('...')) и
 * транзитивно раскрывает цепочку. Для каждого переданного пути печатает только
 * те файлы тестов, в чьём графе зависимостей он встречается.
 *
 * Ничего не пишет на диск и ничего не запускает: одна строка с командой
 * node --test и относительными путями тестов, либо явная ошибка (exit 2).
 *
 * Использование: node spec/scripts/tests-for.mjs <путь> [<путь> ...]
 * Пути — относительно корня пакета.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PKG = path.resolve(HERE, '..', '..');
const TEST_DIR = path.join(PKG, 'plugin', 'test');

/* Ключ файла: настоящий путь, на Windows — без регистра. */
function fileKey(abs) {
  let resolved = path.resolve(abs);
  try {
    resolved = fs.realpathSync.native(resolved);
  } catch {
    /* путь может не существовать: сравниваем как есть */
  }
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

function isFile(abs) {
  try {
    return fs.statSync(abs).isFile();
  } catch {
    return false;
  }
}

/*
 * Относительные импорты файла. Спецификатор с ?query/#hash (кэш-обход в
 * client.test.mjs) отбрасывается до расширения. Несуществующие цели в граф не
 * попадают — «указание» в комментарии не притворяется зависимостью.
 */
const importCache = new Map();

function relativeImports(abs) {
  const key = fileKey(abs);
  if (importCache.has(key)) return importCache.get(key);

  const text = fs.readFileSync(abs, 'utf8');
  const specs = new Set();
  let match;

  const staticRe = /\b(?:import|export)\s+(?:[\s\S]*?\sfrom\s+)?['"]([^'"]+)['"]/gu;
  while ((match = staticRe.exec(text)) !== null) specs.add(match[1]);

  const dynamicRe = /\bimport\s*\(\s*['"]([^'"]+)['"]/gu;
  while ((match = dynamicRe.exec(text)) !== null) specs.add(match[1]);

  const deps = [];
  for (const spec of specs) {
    if (!spec.startsWith('./') && !spec.startsWith('../')) continue;
    const clean = spec.split(/[?#]/u)[0];
    const target = path.resolve(path.dirname(abs), clean);
    if (isFile(target)) deps.push(target);
  }
  importCache.set(key, deps);
  return deps;
}

/* Транзитивное замыкание зависимостей файла, включая сам файл. */
function dependencyClosure(abs) {
  const seen = new Set();
  const stack = [path.resolve(abs)];
  while (stack.length > 0) {
    const current = stack.pop();
    const key = fileKey(current);
    if (seen.has(key)) continue;
    seen.add(key);
    for (const dep of relativeImports(current)) {
      if (!seen.has(fileKey(dep))) stack.push(dep);
    }
  }
  return seen;
}

function testFiles() {
  if (!fs.existsSync(TEST_DIR)) return [];
  return fs.readdirSync(TEST_DIR)
    .filter((name) => name.endsWith('.test.mjs'))
    .sort()
    .map((name) => path.join(TEST_DIR, name));
}

function displayPath(abs) {
  return path.relative(PKG, abs).split(path.sep).join('/');
}

function main(argv) {
  if (argv.length === 0) {
    process.stderr.write('usage: node spec/scripts/tests-for.mjs <путь> [<путь> ...]\n');
    process.exitCode = 2;
    return;
  }

  const tests = testFiles();
  const testsByDependency = new Map();
  for (const testAbs of tests) {
    const testRel = displayPath(testAbs);
    for (const depKey of dependencyClosure(testAbs)) {
      if (!testsByDependency.has(depKey)) testsByDependency.set(depKey, new Set());
      testsByDependency.get(depKey).add(testRel);
    }
  }

  const selected = new Set();
  const unknown = [];
  for (const raw of argv) {
    const abs = path.resolve(PKG, raw);
    const hits = testsByDependency.get(fileKey(abs));
    if (!hits || hits.size === 0) unknown.push(raw);
    else for (const testRel of hits) selected.add(testRel);
  }

  if (unknown.length > 0) {
    for (const raw of unknown) {
      process.stderr.write('tests-for: неизвестный путь, тестов не найдено: ' + raw + '\n');
    }
    process.exitCode = 2;
    return;
  }

  const ordered = [...selected].sort();
  process.stdout.write('node --test ' + ordered.join(' ') + '\n');
}

main(process.argv.slice(2));
