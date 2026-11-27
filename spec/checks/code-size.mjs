#!/usr/bin/env node
/*
 * Порог размера файлов как исполняемое правило.
 *
 * Заказчик принял: рукописный производственный файл больше 600 строк —
 * ревизия при следующей правке, больше 900 — отдельная задача. Правило
 * записано в docs/CODE-SIZE.md; здесь оно проверяется машиной, чтобы файлы не
 * отрастали молча.
 *
 * Область: plugin/lib/**, plugin/client/**, spec/scripts/**, spec/checks/**,
 * tools/**. Исключения: plugin/lib/client.js — сгенерированный сборкой
 * артефакт (plugin/client/*.js), он обязан быть одним скриптом для загрузчика
 * DSH; тесты plugin/test/** — отдельный контур.
 *
 *   node spec/checks/code-size.mjs c1   порог 900 (fail), список >600 (WARN), правило записано
 *   node spec/checks/code-size.mjs c2   негативный случай: компаратор отвергает 901 и пропускает 900
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PKG = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const RULE_FILE = path.join(PKG, 'docs', 'CODE-SIZE.md');
const HARD_LIMIT = 900;
const REVIEW_LIMIT = 600;
const AREAS = ['plugin/lib', 'plugin/client', 'spec/scripts', 'spec/checks', 'tools'];
const GENERATED = new Set(['plugin/lib/client.js']);
const SKIP = /(^|[\\/])(node_modules|\.git|\.tmp|vendor|dist)([\\/]|$)/;

export function exceeds(lines, limit = HARD_LIMIT) {
  return Number(lines) > Number(limit);
}

/** Все рукописные производственные файлы кода с числом строк. */
export function collect(root) {
  const found = [];
  const walk = (dir) => {
    let entries = [];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (SKIP.test(full)) continue;
      if (entry.isDirectory()) { walk(full); continue; }
      if (!/\.(mjs|js|cjs|ps1)$/u.test(entry.name)) continue;
      const rel = path.relative(root, full).split(path.sep).join('/');
      if (GENERATED.has(rel)) continue;
      found.push({ rel, lines: fs.readFileSync(full, 'utf8').split('\n').length });
    }
  };
  for (const area of AREAS) walk(path.join(root, area));
  return found.sort((a, b) => b.lines - a.lines);
}

function fail(message) {
  console.error('CODE-SIZE FAIL: ' + message);
  process.exit(1);
}

function c1() {
  if (!fs.existsSync(RULE_FILE)) fail('нет docs/CODE-SIZE.md: правило не записано');
  const rule = fs.readFileSync(RULE_FILE, 'utf8');
  for (const token of ['600', '900', 'code-size.mjs']) {
    if (!rule.includes(token)) fail('docs/CODE-SIZE.md не называет ' + token);
  }
  const files = collect(PKG);
  for (const file of files) {
    if (exceeds(file.lines, HARD_LIMIT)) fail(file.rel + ' ' + file.lines + ' строк: порог ' + HARD_LIMIT + ' превышен — нужна отдельная задача');
  }
  const review = files.filter((file) => exceeds(file.lines, REVIEW_LIMIT));
  for (const file of review) console.log('WARN  ' + file.rel + ' ' + file.lines + ' строк — ревизия при следующей правке (порог ' + REVIEW_LIMIT + ')');
  console.log('CODE-SIZE OK c1: ' + files.length + ' файлов, максимум ' + (files[0] ? files[0].lines : 0) + ' строк');
}

function c2() {
  if (!exceeds(901)) fail('компаратор не ловит 901 строку: проверка лжива');
  if (exceeds(900)) fail('компаратор отвергает ровно 900: порог должен быть строгим «больше»');
  if (!exceeds(1000, 900)) fail('компаратор не ловит превышение на явном лимите');
  const files = collect(PKG);
  if (files.some((file) => GENERATED.has(file.rel))) fail('сгенерированный client.js попал в проверку: исключение не работает');
  console.log('CODE-SIZE OK c2');
}

const table = { c1, c2 };
const which = process.argv[2];
if (!table[which]) {
  console.log('usage: node spec/checks/code-size.mjs c1|c2');
  process.exit(2);
}
try {
  table[which]();
} catch (error) {
  console.error('CODE-SIZE FAIL ' + which + ': ' + (error && error.message ? error.message : error));
  process.exit(1);
}
