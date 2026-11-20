#!/usr/bin/env node
/*
 * Задание 0082: удаление тега штатным путём — tools/commit.ps1 -DeleteTag.
 *
 * Сторож процесса запрещает прямой git push в инструменте pwsh (processPolicy=fail),
 * а commit.ps1 умел только ставить тег и пушить ветку/тег. Удаление тега (в том
 * числе в origin) должно идти через тот же вход, что и создание.
 *
 *   c1 — тег есть: -DeleteTag удаляет его локально, exit 0;
 *   c2 — тега нет: отказ с понятным сообщением, exit 8;
 *   c3 — регресс: обычный вызов commit.ps1 без аргументов ведёт себя как прежде.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSyncPipeFree } from '../scripts/lib/common.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PKG = path.resolve(HERE, '..', '..');
const CASE = process.argv[2] || 'c1';
const PROBE = 'wf-check-delete-tag';
const ABSENT = 'wf-check-absent-tag';

function git(args) {
  return spawnSyncPipeFree('git', args, { cwd: PKG, encoding: 'utf8' });
}
function commitScript(extra) {
  return spawnSyncPipeFree('pwsh', ['-NoProfile', '-File', 'tools/commit.ps1', ...extra], { cwd: PKG, encoding: 'utf8' });
}
function text(result) {
  return String(result.stdout || '') + String(result.stderr || '');
}
function fail(message) {
  console.log('FAIL ' + CASE + ': ' + message);
  return 1;
}

if (CASE === 'c2') {
  const result = commitScript(['-DeleteTag', ABSENT]);
  const output = text(result);
  if (result.status !== 8) {
    process.exitCode = fail('ожидался exit 8 для несуществующего тега, пришло ' + result.status);
  } else {
    console.log('COMMIT DELETE TAG OK c2');
    process.exitCode = 0;
  }
} else if (CASE === 'c3') {
  const result = commitScript([]);
  const output = text(result);
  if (result.status !== 2) process.exitCode = fail('ожидался exit 2 на пустом вызове, пришло ' + result.status);
  else {
    console.log('COMMIT DELETE TAG OK c3');
    process.exitCode = 0;
  }
} else {
  git(['tag', '-f', PROBE]);
  const before = String(git(['tag', '--list', PROBE]).stdout || '').trim();
  if (before !== PROBE) process.exitCode = fail('не удалось поставить пробный тег ' + PROBE);
  else {
    const result = commitScript(['-DeleteTag', PROBE]);
    const output = text(result);
    const after = String(git(['tag', '--list', PROBE]).stdout || '').trim();
    if (result.status !== 0) process.exitCode = fail('exit ' + result.status + ': ' + output.trim().split(String.fromCharCode(10)).slice(-2).join(' / '));
    else if (after !== '') { git(['tag', '-d', PROBE]); process.exitCode = fail('тег ' + PROBE + ' остался после удаления'); }
    else { console.log('COMMIT DELETE TAG OK c1'); process.exitCode = 0; }
  }
}