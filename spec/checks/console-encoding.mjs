#!/usr/bin/env node
/*
 * Задание 0083: проверки не должны зависеть от кодовой страницы консоли.
 *
 * Дефект: check сравнивал русские маркеры («НЕ НАЙДЕН», «УДАЛЁН») в выводе pwsh.
 * При запуске через spec/scripts/job.mjs у дочернего pwsh кодовая страница 866,
 * а вывод декодируется как UTF-8 — маркеры не совпадают, получается ложный красный.
 *
 * Проверка поведенческая: запускает дочернюю проверку commit-delete-tag.mjs c2 и c1
 * В КОНСОЛИ С КОДОВОЙ СТРАНИЦЕЙ 866 (chcp 866) и требует exit 0. Пока проверка
 * сверяет кириллицу — под cp866 она красная; когда сверяет коды выхода — зелёная
 * в любой кодировке.
 *
 *   c1 — под cp866: commit-delete-tag c2 (отсутствующий тег) → exit 0;
 *   c2 — под cp866: commit-delete-tag c1 (удаление пробного тега) → exit 0;
 *   c3 — в обычной консоли оба случая по-прежнему зелёные.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSyncPipeFree } from '../scripts/lib/common.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PKG = path.resolve(HERE, '..', '..');
const CASE = process.argv[2] || 'c1';

function runInConsole(codePage, innerArgs) {
  const inner = 'node spec/checks/commit-delete-tag.mjs ' + innerArgs;
  const command = codePage === '' ? inner : ('chcp ' + codePage + ' > $null; ' + inner);
  return spawnSyncPipeFree('pwsh', ['-NoProfile', '-Command', command + '; exit $LASTEXITCODE'], {
    cwd: PKG,
    encoding: 'utf8',
  });
}

function fail(message) {
  console.log('FAIL ' + CASE + ': ' + message);
  return 1;
}

if (CASE === 'c3') {
  const results = [runInConsole('', 'c2'), runInConsole('', 'c1')];
  const bad = results.findIndex((result) => (result.status === null ? 1 : result.status) !== 0);
  if (bad >= 0) {
    process.exitCode = fail('в обычной консоли проверка красная (случай ' + (bad === 0 ? 'c2' : 'c1') + '): ' + String(results[bad].stderr || results[bad].stdout || '').trim().split(String.fromCharCode(10)).slice(-2).join(' / '));
  } else {
    console.log('CONSOLE ENCODING OK c3');
    process.exitCode = 0;
  }
} else {
  const innerArgs = CASE === 'c1' ? 'c2' : 'c1';
  const result = runInConsole('866', innerArgs);
  const status = result.status === null ? 1 : result.status;
  if (status !== 0) {
    const tail = String(result.stdout || '') + String(result.stderr || '');
    process.exitCode = fail('под cp866 проверка commit-delete-tag ' + innerArgs + ' красная (exit ' + status + '): ' + tail.trim().split(String.fromCharCode(10)).slice(-2).join(' / '));
  } else {
    console.log('CONSOLE ENCODING OK ' + CASE);
    process.exitCode = 0;
  }
}
