#!/usr/bin/env node
/*
 * 2.6.105 (0124): gate.mjs знает, что доступно в этой копии движка.
 *
 * В развёрнутой копии нет tools/check-tests.mjs и spec/selftest.mjs, а раскладка
 * scripts/ другая. Раньше gate.mjs молча запускал несуществующий файл и падал
 * «Cannot find module» — то есть агент тратил шаг на выяснение, а не на работу.
 *
 * c1: в пакете доступны все действия; --help их перечисляет, tests --dry-run работает.
 * c2: в копии без tools/spec — tests/selftest помечены недоступными в справке,
 *     а вызов tests отказывает кодом 2 с причиной, а не падением Node.
 *
 * Вне пакета — SKIP (конвенция deployed-copy).
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PKG = path.resolve(HERE, '..', '..');

if (!fs.existsSync(path.join(PKG, 'spec'))) {
  console.log('SKIP: проверка пакета вне пакета');
  process.exit(0);
}

function truthy(value, label) {
  if (!value) throw new Error(label);
}

function run(cmd, args, cwd) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-gateav-out-'));
  const outFile = path.join(dir, 'stdout');
  const errFile = path.join(dir, 'stderr');
  const ofd = fs.openSync(outFile, 'w');
  const efd = fs.openSync(errFile, 'w');
  let res;
  try {
    res = spawnSync(cmd, args, { cwd, timeout: 300000, windowsHide: true, stdio: ['ignore', ofd, efd] });
  } finally {
    try { fs.closeSync(ofd); } catch { /* ignore */ }
    try { fs.closeSync(efd); } catch { /* ignore */ }
  }
  let out = '';
  let err = '';
  try { out = fs.readFileSync(outFile, 'utf8'); } catch { /* ignore */ }
  try { err = fs.readFileSync(errFile, 'utf8'); } catch { /* ignore */ }
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
  return { code: res.status, out, err };
}

function c1() {
  const help = run(process.execPath, [path.join(PKG, 'spec', 'scripts', 'gate.mjs'), '--help'], PKG);
  truthy(help.code === 0, 'gate --help вернул код ' + help.code);
  truthy(/red\|verify\|accept/u.test(help.out), 'справка не перечисляет ворота: ' + help.out.slice(0, 300));
  truthy(/tests\|selftest/u.test(help.out), 'в пакете tests/selftest должны быть доступны: ' + help.out.slice(0, 300));
  truthy(!/Недоступно в этой копии/u.test(help.out), 'в пакете что-то помечено недоступным: ' + help.out.slice(0, 300));
  const dry = run(process.execPath, [path.join(PKG, 'spec', 'scripts', 'gate.mjs'), 'tests', '--dry-run', '--tail', '3'], PKG);
  truthy(dry.code === 0, 'gate tests --dry-run вернул код ' + dry.code + ': ' + (dry.err || dry.out).slice(-400));
  truthy(/GATE tests JOB [0-9a-f]{12}/u.test(dry.out), 'нет строки GATE tests JOB <id>');
  console.log('GATEAV OK c1');
}

function c2() {
  const copy = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-gateav-copy-'));
  try {
    /* Копия «развёрнутого движка»: scripts/ есть, tools/ и spec/ — нет. */
    fs.cpSync(path.join(PKG, 'spec', 'scripts'), path.join(copy, 'scripts'), { recursive: true });
    const help = run(process.execPath, [path.join(copy, 'scripts', 'gate.mjs'), '--help'], copy);
    truthy(help.code === 0, 'копия: --help вернул код ' + help.code);
    truthy(/Недоступно в этой копии движка: tests, selftest/u.test(help.out), 'недоступные действия не названы: ' + help.out.slice(0, 400));
    const denied = run(process.execPath, [path.join(copy, 'scripts', 'gate.mjs'), 'tests', '--dry-run'], copy);
    truthy(denied.code === 2, 'недоступное действие вернуло код ' + denied.code + ', ожидался 2');
    truthy(/недоступно в этой копии/u.test(denied.err), 'отказ не назвал причину: ' + (denied.err || denied.out).slice(0, 300));
    truthy(!/Cannot find module/u.test(denied.err), 'падение Node вместо отказа с причиной');
  } finally { fs.rmSync(copy, { recursive: true, force: true }); }
  console.log('GATEAV OK c2');
}

const table = { c1, c2 };
const which = process.argv[2];
if (!table[which]) {
  console.log('usage: node spec/checks/gate-availability.mjs c1|c2');
  process.exit(2);
}
try {
  table[which]();
} catch (error) {
  console.log('GATEAV FAIL ' + which + ': ' + (error && error.message ? error.message : error));
  process.exit(1);
}
