/*
 * Глобы и обход: сопоставление путей, пересечения, защищённые файлы.
 *
 * 0181: часть spec/scripts/lib/common.mjs; публичный вход — common.mjs.
 */
import fs from 'node:fs';
import path from 'node:path';
import { toPosix } from './fsio.mjs';
import { git } from './git-base.mjs';
export function globToRegExp(pattern) {
  const p = toPosix(pattern);
  let re = '^';
  for (let i = 0; i < p.length; i += 1) {
    const c = p[i];
    if (c === '*') {
      if (p[i + 1] === '*') {
        i += 1;
        if (p[i + 1] === '/') { i += 1; re += '(?:.*/)?'; }
        else re += '.*';
      } else re += '[^/]*';
    } else if (c === '?') re += '[^/]';
    else if (c === '[') {
      const end = p.indexOf(']', i + 1);
      if (end === -1) re += '\\[';
      else { re += p.slice(i, end + 1); i = end; }
    } else re += c.replace(/[.+^\${}()|\\]/g, '\\$&');
  }
  re += '$';
  return new RegExp(re);
}

export function matchesAny(file, patterns) {
  const p = toPosix(file);
  return (patterns || []).some((pattern) => globToRegExp(pattern).test(p));
}

/*
 * Пересечение двух шаблонов путей (2.6.4, F-7): существует ли путь, который
 * попадает и под один, и под другой. Нужно lint, чтобы увидеть, что путь из
 * allowedPaths защищён protectedPaths: `src/**` и `src/app.js` пересекаются,
 * `src/**` и `checks/**` — нет.
 *
 * Отдельная функция, а не `globToRegExp(q).test(p)`: проверка одного шаблона
 * регуляркой другого не симметрична и пропускает ровно наш самый частый дефект
 * контракта — «разрешён каталог, защищён файл внутри него» (0012, 0014, 0017).
 */
export function hasWildcard(segment) { return /[*?[]/.test(segment); }
export function literalPrefix(segment) {
  const match = segment.match(/^[^*?[]*/);
  return match ? match[0] : '';
}
export function literalSuffix(segment) {
  const match = segment.match(/[^*?[]*$/);
  return match ? match[0] : '';
}
export function segmentsOverlap(left, right) {
  const leftFixed = !hasWildcard(left);
  const rightFixed = !hasWildcard(right);
  if (leftFixed && rightFixed) return left === right;
  if (leftFixed) return globToRegExp(right).test(left);
  if (rightFixed) return globToRegExp(left).test(right);
  /*
   * Оба сегмента с шаблоном: точного пересечения регулярных языков здесь не
   * строим. Совместимы, если литеральные префикс и суффикс одного продолжают
   * (или содержатся в) другом — этого хватает, чтобы `*.md` и `*.json` не
   * считались пересечением, а `*.js` и `a*.js` — считались.
   */
  const leftPrefix = literalPrefix(left);
  const rightPrefix = literalPrefix(right);
  const leftSuffix = literalSuffix(left);
  const rightSuffix = literalSuffix(right);
  const prefixOk = leftPrefix.startsWith(rightPrefix) || rightPrefix.startsWith(leftPrefix);
  const suffixOk = leftSuffix.endsWith(rightSuffix) || rightSuffix.endsWith(leftSuffix);
  return prefixOk && suffixOk;
}

export function patternsIntersect(patternA, patternB) {
  const split = (pattern) => {
    const posix = toPosix(pattern);
    return (posix.startsWith('./') ? posix.slice(2) : posix).split('/').filter((part) => part !== '');
  };
  const left = split(patternA);
  const right = split(patternB);
  const memo = new Map();
  const walk = (i, j) => {
    const key = i + ':' + j;
    if (memo.has(key)) return memo.get(key);
    let result;
    if (i === left.length && j === right.length) result = true;
    else if (i === left.length) result = right.slice(j).every((part) => part === '**');
    else if (j === right.length) result = left.slice(i).every((part) => part === '**');
    else if (left[i] === '**' && right[j] === '**') result = walk(i + 1, j) || walk(i, j + 1);
    else if (left[i] === '**') result = walk(i + 1, j) || walk(i, j + 1);
    else if (right[j] === '**') result = walk(i, j + 1) || walk(i + 1, j);
    else result = segmentsOverlap(left[i], right[j]) && walk(i + 1, j + 1);
    memo.set(key, result);
    return result;
  };
  return walk(0, 0);
}

export function walkFiles(root, opts = {}) {
  const out = [];
  const skipDirs = new Set(['.git', 'node_modules', '.venv', 'venv', '__pycache__']);
  const walk = (dir, rel) => {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      const childRel = rel ? rel + '/' + entry.name : entry.name;
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        if (skipDirs.has(entry.name)) continue;
        if (opts.exclude && matchesAny(childRel, opts.exclude)) continue;
        walk(path.join(dir, entry.name), childRel);
      } else if (entry.isFile()) {
        if (opts.exclude && matchesAny(childRel, opts.exclude)) continue;
        out.push(childRel);
      }
    }
  };
  walk(root, '');
  return out;
}

export function listRepoFiles(repo, opts = {}) {
  const exclude = opts.exclude || [];
  const set = new Set();
  const add = (text) => {
    for (const p of text.split('\0')) {
      if (!p) continue;
      const rel = toPosix(p);
      if (exclude.length && matchesAny(rel, exclude)) continue;
      set.add(rel);
    }
  };
  const tracked = git(repo, ['ls-files', '-z']);
  if (tracked.exitCode === 0) {
    add(tracked.stdout);
    if (opts.includeUntracked !== false) {
      const untracked = git(repo, ['ls-files', '--others', '--exclude-standard', '-z']);
      if (untracked.exitCode === 0) add(untracked.stdout);
    }
    return [...set].sort();
  }
  return walkFiles(repo, { exclude });
}

/*
 * Движок вне замка задания (2.6.18, 0050).
 *
 * `docs/subagent-workflow/**` — развёрнутая копия пакета, а не проверки задания:
 * её меняет `init --force` и обычный деплой. Пока эти файлы попадали в
 * protected-манифест, замок активной задачи краснел на чужой правке — за сутки
 * пять прерываний цикла (письмо structure --127). Поэтому манифест по умолчанию
 * движок не включает; задание, которое действительно держит его в хеше (редкий,
 * осознанный случай), объявляет `locksEngine: true` в TASK-META.
 */

export const ENGINE_DIR_PATTERNS = ['docs/subagent-workflow/**'];

export function protectedManifest(files, options = {}) {
  const list = Array.isArray(files) ? files : [];
  const locksEngine = options.locksEngine === true;
  const enginePatterns = Array.isArray(options.enginePatterns) && options.enginePatterns.length > 0
    ? options.enginePatterns.map(toPosix)
    : ENGINE_DIR_PATTERNS;
  const seen = new Set();
  for (const file of list) {
    if (typeof file !== 'string' || file.trim() === '') continue;
    const rel = toPosix(file);
    if (!locksEngine && matchesAny(rel, enginePatterns)) continue;
    seen.add(rel);
  }
  return [...seen].sort();
}

/*
 * Re-lock (2.6.18, 0050): правка контракта после доказанного красного без нового
 * номера задания.
 *
 * Разрешено менять только границы — allowedPaths, protectedPaths, redAllowDirty в
 * TASK-META — и покрытие критериев (covers, tags). Команда, ожидание, id, cwd,
 * timeoutMs, число и порядок критериев — это смысл проверки: их правка после
 * красного означает подгонку под результат, а не правку границ, и остаётся
 * новым номером задания.
 *
 * Функция чистая: сравнивает нормализованные снимки контракта и ничего не
 * читает с диска. Игнорируемые поля в снимке не обязаны присутствовать —
 * `task-hash --write` кладёт снимок в `criteria.lock` (`contract`).
 */
