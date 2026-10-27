#!/usr/bin/env node
/*
 * Запуск тестов плагина одной командой: `node --test <каталог>` не работает
 * (Node принимает каталог за модуль), а оболочки по-разному раскрывают *.test.mjs.
 * Поэтому список собирает сам Node-скрипт — одинаково на Windows, Ubuntu и в CI.
 */
import { readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const testDir = path.join(root, 'test');
const files = readdirSync(testDir)
  .filter((name) => name.endsWith('.test.mjs'))
  .sort()
  .map((name) => path.join(testDir, name));

if (files.length === 0) {
  console.error('plugin test: в ' + testDir + ' нет *.test.mjs');
  process.exit(1);
}
console.log('plugin test: ' + files.length + ' файл(ов)');
const run = spawnSync(process.execPath, ['--test', ...files], { cwd: root, stdio: 'inherit' });
process.exit(run.status === null ? 1 : run.status);
