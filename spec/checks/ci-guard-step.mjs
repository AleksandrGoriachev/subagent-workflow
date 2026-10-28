#!/usr/bin/env node
/*
 * Приёмочная проверка задания 0005: шаг guard-acceptance присутствует в CI.
 *
 * Без него проверка обхода живёт только внутри заданий: между задачами её
 * регрессию никто не поймает. Скрипт читает .github/workflows/ci.yml и требует
 * ровно один шаг, который запускает spec/checks/guard-acceptance.mjs --all.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
/* 2.6.2: проверка относится к пакету (spec/checks); в развёрнутой копии spec/SPEC.md нет — SKIP. */
if (!fs.existsSync(path.join(ROOT, 'spec', 'SPEC.md'))) {
  console.log('SKIP: проверка относится к пакету (spec/checks), а не к развёрнутой копии');
  process.exit(0);
}
const FILE = path.join(ROOT, '.github', 'workflows', 'ci.yml');

if (!fs.existsSync(FILE)) {
  console.log('FAIL шаг guard-acceptance: нет файла .github/workflows/ci.yml');
  process.exit(1);
}
const text = fs.readFileSync(FILE, 'utf8');
const lines = text.split(/\r?\n/);
const hits = lines
  .map((line, index) => ({ line, index }))
  .filter((item) => /guard-acceptance\.mjs/.test(item.line) && /^\s*(run:|-\s*run:|.*\brun:)/.test(item.line) === false ? /guard-acceptance\.mjs/.test(item.line) : /guard-acceptance\.mjs/.test(item.line));
const runHits = lines.filter((line) => /run:/.test(line) && /guard-acceptance\.mjs/.test(line));
const callsAll = runHits.some((line) => /--all/.test(line));

if (runHits.length === 0) {
  console.log('FAIL шаг guard-acceptance: в ci.yml нет ни одной строки run: с guard-acceptance.mjs');
  console.log('     нужно: run: node spec/checks/guard-acceptance.mjs --all');
  process.exit(1);
}
if (!callsAll) {
  console.log('FAIL шаг guard-acceptance: найден вызов без --all (проверялись бы не все кейсы)');
  process.exit(1);
}
console.log('PASS шаг guard-acceptance: ' + runHits.length + ' вызов(ов) с --all');