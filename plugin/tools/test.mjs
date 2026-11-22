#!/usr/bin/env node
/*
 * Запуск тестов плагина одной командой: `node --test <каталог>` не работает
 * (Node принимает каталог за модуль), а оболочки по-разному раскрывают *.test.mjs.
 * Поэтому список собирает сам Node-скрипт — одинаково на Windows, Ubuntu и в CI.
 *
 * 0098 (2.6.93): гейт не должен давать ложный красный под нагрузкой.
 *  - прогон последовательный (--test-concurrency=1): API-тесты не соревнуются
 *    за порты и тайминги; WF_TEST_CONCURRENCY позволяет поднять осознанно;
 *  - полный вывод пишется в файл, при падении печатается путь и последние
 *    30 строк — по логу видно тест и причину, а не «exit 1».
 * Ретрай-обход не добавлен: гейт не маскирует падения.
 */
import { readdirSync, readFileSync, mkdirSync } from 'node:fs';
import os from 'node:os';
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

const concurrency = Number(process.env.WF_TEST_CONCURRENCY) || 1;
const logsDir = path.join(root, '.tmp');
mkdirSync(logsDir, { recursive: true });
const logFile = path.join(logsDir, 'plugin-test-' + Date.now() + '.log');

/*
 * 0.9.0 (0034): карта внешнего движка не должна влиять на прогон. Наследованный
 * WF_ENGINE_ROOTS уводим в несуществующий файл: тесты карты задают свой путь
 * сами и возвращают прежнее значение.
 */
const env = { ...process.env };
env.WF_ENGINE_ROOTS = path.join(os.tmpdir(), 'wf-plugin-test-engine-roots-' + process.pid + '-' + Date.now() + '.json');

const quoted = files.map((file) => '"' + file + '"').join(' ');
const command = '"' + process.execPath + '" --test --test-concurrency=' + concurrency + ' ' + quoted
  + ' > "' + logFile + '" 2>&1';
const run = spawnSync(command, { cwd: root, stdio: 'inherit', shell: true, env });
const status = run.status === null ? 1 : run.status;
if (status !== 0) {
  console.error('plugin test: лог: ' + logFile);
  try {
    const tail = readFileSync(logFile, 'utf8').split('\n').slice(-30).join('\n');
    console.error(tail);
  } catch (error) {
    console.error('plugin test: лог не прочитан: ' + (error && error.message ? error.message : error));
  }
}
process.exit(status);
