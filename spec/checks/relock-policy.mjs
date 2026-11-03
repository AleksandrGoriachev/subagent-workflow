#!/usr/bin/env node
/*
 * 2.6.18 (0050): дешёвая правка контракта после красного и движок вне замка задания.
 *
 * Замер structure (письмо --127): переделки контракта стоили 49 мин 21 с за сутки, из них
 * 20 мин 45 с (0031→0032) и 27 мин 22 с (0046→0054, «20 мин 30 с выброшенной работы
 * исполнителя: lib/api.js вне allowedPaths»). Пять прерываний цикла — деплой движка в
 * docs/subagent-workflow/** внутри окна активной задачи (замок ловит чужой деплой).
 *
 * Здесь две чистые функции, которые ворота обязаны использовать:
 *   relockAllowed(prev, next)      — правка допустима, если изменились только границы и
 *                                    покрытие (allowedPaths/protectedPaths/redAllowDirty/
 *                                    covers/tags), а команды и ожидания критериев — нет;
 *   protectedManifest(files, opts) — движок (docs/subagent-workflow/**) вне хеша по умолчанию,
 *                                    включается флагом locksEngine.
 *
 * Вне пакета — SKIP (конвенция deployed-copy).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PKG = path.resolve(HERE, '..', '..');

if (!fs.existsSync(path.join(PKG, 'spec'))) {
  console.log('SKIP: проверка пакета вне пакета');
  process.exit(0);
}

const common = await import(pathToFileURL(path.join(PKG, 'spec', 'scripts', 'lib', 'common.mjs')).href);

function truthy(value, label) {
  if (!value) throw new Error(label);
}

function c1() {
  truthy(typeof common.relockAllowed === 'function', 'в common.mjs нет relockAllowed');
  const base = {
    allowedPaths: ['spec/scripts/task-hash.mjs'],
    protectedPaths: ['plugin/**'],
    redAllowDirty: ['docs/tasks/0050/**'],
    criteria: [
      { id: 'C1', command: 'node a.mjs c1', expect: { exitCode: 0 }, covers: ['spec/scripts/task-hash.mjs'], tags: ['fast'] },
    ],
  };
  const widen = JSON.parse(JSON.stringify(base));
  widen.allowedPaths.push('spec/scripts/lib/common.mjs');
  widen.criteria[0].covers.push('spec/scripts/lib/common.mjs');
  widen.criteria[0].tags.push('negative');
  const widenOk = common.relockAllowed(base, widen);
  truthy(widenOk && widenOk.ok === true, 'расширение границ отклонено: ' + JSON.stringify(widenOk));

  const changedCommand = JSON.parse(JSON.stringify(base));
  changedCommand.criteria[0].command = 'node a.mjs c2';
  const commandDenied = common.relockAllowed(base, changedCommand);
  truthy(commandDenied && commandDenied.ok === false, 'изменение команды критерия разрешено');
  truthy(/команд|измер|смысл/u.test(String(commandDenied.reason || '')), 'отказ не объясняет причину: ' + JSON.stringify(commandDenied));

  const changedExpect = JSON.parse(JSON.stringify(base));
  changedExpect.criteria[0].expect = { exitCode: 1 };
  truthy(common.relockAllowed(base, changedExpect).ok === false, 'изменение ожидания критерия разрешено');

  const addedCriterion = JSON.parse(JSON.stringify(base));
  addedCriterion.criteria.push({ id: 'C2', command: 'node a.mjs c2', expect: { exitCode: 0 } });
  truthy(common.relockAllowed(base, addedCriterion).ok === false, 'добавление критерия разрешено без нового номера');
  console.log('RELOCK OK c1');
}

function c2() {
  truthy(typeof common.protectedManifest === 'function', 'в common.mjs нет protectedManifest');
  const files = [
    'spec/scripts/task-hash.mjs',
    'docs/subagent-workflow/VERSION',
    'docs/subagent-workflow/scripts/lib/common.mjs',
    'plugin/lib/api.js',
  ];
  const plain = common.protectedManifest(files, {});
  truthy(!plain.includes('docs/subagent-workflow/VERSION'), 'движок попал в защищённый манифест без флага: ' + JSON.stringify(plain));
  truthy(plain.includes('spec/scripts/task-hash.mjs'), 'обычный файл потерян: ' + JSON.stringify(plain));
  const locked = common.protectedManifest(files, { locksEngine: true });
  truthy(locked.includes('docs/subagent-workflow/VERSION'), 'с locksEngine движок не защищён');
  truthy(locked.length === plain.length + 2, 'с locksEngine потеряны файлы движка: ' + JSON.stringify(locked));
  const hashed = fs.readFileSync(path.join(PKG, 'spec', 'scripts', 'task-hash.mjs'), 'utf8');
  truthy(/protectedManifest/u.test(hashed), 'task-hash не использует protectedManifest');
  truthy(/relockAllowed/u.test(hashed), 'task-hash не использует relockAllowed');
  console.log('RELOCK OK c2');
}

const table = { c1, c2 };
const which = process.argv[2];
if (!table[which]) {
  console.log('usage: node spec/checks/relock-policy.mjs c1|c2');
  process.exit(2);
}
try {
  table[which]();
} catch (error) {
  console.log('RELOCK FAIL ' + which + ': ' + (error && error.message ? error.message : error));
  process.exit(1);
}
