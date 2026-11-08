#!/usr/bin/env node
/**
 * 0104 (WC-67): исходящий запрос обязан нести headers.
 *
 * Дефект 2.6.53 был не в логике, а в контракте: заголовок Accept, общий для всех
 * загрузок, оказался неверным для API. Тест-мок такой случай ловит, но только
 * если тест вообще доходит до вызова. Эта проверка смотрит исходник: каждый
 * вызов fetch( или fetchWithRetry( в plugin/lib обязан передавать headers —
 * иначе запрос уходит «как получится» и никто этого не замечает.
 *
 * Проверка статическая и намеренно узкая: она не доказывает правильность
 * значения заголовка (это делает контрактный мок), а ловит его отсутствие.
 */
import fs from 'node:fs';
import path from 'node:path';

/** Вызовы, которые обязаны нести headers. */
const CALL_RE = /\b(fetch|fetchWithRetry)\s*\(/gu;

/**
 * Текст вызова от открывающей скобки до парной закрывающей.
 * Строки и шаблоны пропускаются, чтобы скобки внутри них не сбивали счёт.
 */
export function callText(source, startIndex) {
  let depth = 0;
  let quote = null;
  for (let index = startIndex; index < source.length; index += 1) {
    const char = source[index];
    if (quote) {
      if (char === '\\') { index += 1; continue; }
      if (char === quote) quote = null;
      continue;
    }
    if (char === '"' || char === "'" || char === '`') { quote = char; continue; }
    if (char === '(') depth += 1;
    else if (char === ')') {
      depth -= 1;
      if (depth === 0) return source.slice(startIndex, index + 1);
    }
  }
  return source.slice(startIndex);
}

/**
 * Исходник без комментариев, той же длины: номера строк не сдвигаются.
 * Комментарии не код — «fetch(… без пайпов)» в шапке файла не нарушение.
 */
export function stripComments(source) {
  const text = String(source || '');
  let out = '';
  let quote = null;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];
    if (quote) {
      out += char;
      if (char === '\\') { out += next === undefined ? '' : next; index += 1; continue; }
      if (char === quote) quote = null;
      continue;
    }
    if (char === '"' || char === "'" || char === '`') { quote = char; out += char; continue; }
    if (char === '/' && next === '/') {
      while (index < text.length && text[index] !== '\n') { out += ' '; index += 1; }
      if (index < text.length) out += '\n';
      continue;
    }
    if (char === '/' && next === '*') {
      out += '  ';
      index += 2;
      while (index < text.length && !(text[index] === '*' && text[index + 1] === '/')) {
        out += text[index] === '\n' ? '\n' : ' ';
        index += 1;
      }
      out += ' ';
      index += 1;
      continue;
    }
    out += char;
  }
  return out;
}

/** Объявление функции — не вызов: fetch( в сигнатуре заголовки не передаёт. */
function isDeclaration(text, index) {
  const before = text.slice(Math.max(0, index - 40), index);
  return /function\s+$/u.test(before) || /function\s+[A-Za-z0-9_$]+\s*$/u.test(before);
}

/**
 * Нарушения в одном исходнике: [{ line, call }].
 * @param {string} source
 * @returns {{line: number, call: string}[]}
 */
export function scanSource(source) {
  const problems = [];
  const text = stripComments(source);
  CALL_RE.lastIndex = 0;
  let match;
  while ((match = CALL_RE.exec(text)) !== null) {
    if (isDeclaration(text, match.index)) continue;
    const openIndex = match.index + match[0].length - 1;
    const call = callText(text, openIndex);
    if (!/headers\s*:/u.test(call)) {
      const line = text.slice(0, match.index).split('\n').length;
      problems.push({ line, call: call.replace(/\s+/gu, ' ').slice(0, 120) });
    }
  }
  return problems;
}

/** Файлы plugin/lib: сетевой слой панели. */
export function libFiles(root) {
  const dir = path.join(String(root), 'plugin', 'lib');
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter((name) => name.endsWith('.mjs') || name.endsWith('.js'))
    .map((name) => path.join(dir, name));
}

/**
 * @param {string} root корень репозитория (где лежит plugin/lib)
 * @returns {{file: string, line: number, call: string}[]}
 */
export function scanRepo(root) {
  const problems = [];
  for (const file of libFiles(root)) {
    const source = fs.readFileSync(file, 'utf8');
    for (const problem of scanSource(source)) {
      problems.push({ file: path.relative(String(root), file).split(path.sep).join('/'), ...problem });
    }
  }
  return problems;
}

if (process.argv[1] && import.meta.url === new URL('file://' + path.resolve(process.argv[1]).split(path.sep).join('/')).href) {
  const root = process.argv[2] ? path.resolve(process.argv[2]) : path.resolve(import.meta.dirname, '..', '..');
  const problems = scanRepo(root);
  if (problems.length === 0) {
    console.log('outgoing-headers: OK — все исходящие запросы несут headers');
  } else {
    for (const problem of problems) {
      console.log('OUTGOING-HEADERS ERROR ' + problem.file + ':' + problem.line + ' — вызов без headers: ' + problem.call);
    }
    process.exitCode = 1;
  }
}
