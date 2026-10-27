#!/usr/bin/env node
/*
 * Одна версия — одно место проверки.
 *
 * Урок 2.4.2: версия жила в пяти файлах (VERSION, package.json, README, SPEC,
 * TOOL), а проверялась в одном (TOOL против VERSION), поэтому README и TOOL
 * отставали на две версии, и записи приёмки представлялись старым пакетом.
 *
 * Запускается в пакете (в развёрнутой копии нет ни package.json репозитория,
 * ни CHANGELOG): node tools/check-version.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (file) => {
  try {
    return fs.readFileSync(path.join(root, file), 'utf8');
  } catch {
    return null;
  }
};

const problems = [];
const rows = [];

function expect(file, ok, shown) {
  rows.push({ file, ok, shown });
  if (!ok) problems.push(file);
}

const versionText = (read('VERSION') || '').trim();
const versionOk = /^\d+\.\d+\.\d+$/.test(versionText);
expect('VERSION', versionOk, versionOk ? versionText : 'нет файла или не X.Y.Z: "' + versionText + '"');
const version = versionOk ? versionText : null;

const pkgText = read('package.json');
let pkgVersion = null;
try {
  pkgVersion = pkgText === null ? null : JSON.parse(pkgText).version;
} catch {
  pkgVersion = null;
}
expect('package.json', version !== null && pkgVersion === version, pkgVersion === undefined ? 'нет поля version' : String(pkgVersion));

const readme = read('README.md');
const readmeLine = readme === null ? '' : (readme.split(/\r?\n/)[0] || '');
expect('README.md', version !== null && readmeLine.includes(' ' + version + ' '), readmeLine);

const spec = read('spec/SPEC.md');
expect('spec/SPEC.md', version !== null && spec !== null && spec.includes('Версия: ' + version),
  spec === null ? 'нет файла' : (spec.split(/\r?\n/).find((line) => line.startsWith('Версия:')) || ''));

const common = read('spec/scripts/lib/common.mjs');
const toolLine = common === null ? '' : (common.split(/\r?\n/).find((line) => line.includes('export const TOOL')) || '');
expect('spec/scripts/lib/common.mjs', version !== null && toolLine.includes("'subagent-workflow/" + version + "'"), toolLine);

const changelog = read('CHANGELOG.md');
const firstSection = changelog === null ? '' : (changelog.split(/\r?\n/).find((line) => line.startsWith('## ')) || '');
expect('CHANGELOG.md', version !== null && firstSection.startsWith('## ' + version + ' '), firstSection);

/* Раздел версии в SPEC.md: одна запись на релиз — иначе правки теряются молча. */
const sectionOk = version !== null && spec !== null && spec.includes('Версия ' + version + ':');
expect('spec/SPEC.md (раздел)', sectionOk, sectionOk ? 'есть абзац «Версия ' + version + ':»' : 'нет абзаца «Версия ' + (version || 'X.Y.Z') + ':»');

for (const row of rows) {
  console.log((row.ok ? 'PASS  ' : 'FAIL  ') + row.file.padEnd(28) + (row.shown ? '  — ' + String(row.shown).slice(0, 120) : ''));
}
if (problems.length > 0) {
  console.log('\nVERSION MISMATCH: ' + problems.join(', '));
  process.exit(1);
}
console.log('\nVERSION OK: ' + version);
