#!/usr/bin/env node
/*
 * 2.6.106 (0128): selftest и отобранные тесты идут одновременно.
 *
 * Причина 5 замера structure: проверка платила суммой — selftest (~45–80 с) плюс
 * затронутые тесты (~80–200 с). Теперь два ребёнка запускаются вместе, а проверка
 * подтверждает перекрытие без реального прогона: runChildren принимает impl.
 *
 * c1: с подменённым impl второй ребёнок стартовал раньше, чем закончился первый.
 * c2: CLI --dry-run --json показывает parallel:true и состав детей.
 *
 * Вне пакета — SKIP (конвенция deployed-copy).
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { runChildren } from '../../tools/check-tests.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PKG = path.resolve(HERE, '..', '..');
const TOOL = path.join(PKG, 'tools', 'check-tests.mjs');

if (!fs.existsSync(path.join(PKG, 'spec'))) {
  console.log('SKIP: проверка пакета вне пакета');
  process.exit(0);
}

function truthy(value, label) {
  if (!value) throw new Error(label);
}

function run(cmd, args, cwd) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-ctp-out-'));
  const outFile = path.join(dir, 'stdout');
  const errFile = path.join(dir, 'stderr');
  const ofd = fs.openSync(outFile, 'w');
  const efd = fs.openSync(errFile, 'w');
  let res;
  try {
    res = spawnSync(cmd, args, { cwd, timeout: 600000, windowsHide: true, stdio: ['ignore', ofd, efd] });
  } finally {
    try { fs.closeSync(ofd); } catch { /* ignore */ }
    try { fs.closeSync(efd); } catch { /* ignore */ }
  }
  let out = '';
  try { out = fs.readFileSync(outFile, 'utf8') + fs.readFileSync(errFile, 'utf8'); } catch { /* ignore */ }
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
  return { code: res.status, out };
}

async function c1() {
  const log = [];
  const started = Date.now();
  const fake = async (child) => {
    const from = Date.now() - started;
    await new Promise((resolve) => setTimeout(resolve, child.name === 'first' ? 80 : 20));
    const to = Date.now() - started;
    log.push({ name: child.name, from, to });
    return { code: 0, output: 'ok ' + child.name, durationMs: to - from };
  };
  const result = await runChildren([{ name: 'first' }, { name: 'second' }], fake);
  truthy(result.results.length === 2, 'детей в результате ' + result.results.length);
  const first = log.find((row) => row.name === 'first');
  const second = log.find((row) => row.name === 'second');
  truthy(second.from < first.to, 'дети шли по очереди: второй стартовал ' + second.from + ' ms, первый закончил ' + first.to + ' ms');
  truthy(result.results[0].name === 'first' && result.results[1].name === 'second', 'порядок результатов не совпадает с порядком детей');
  console.log('CTPAR OK c1');
}

function c2() {
  const dry = run(process.execPath, [TOOL, '--dry-run'], PKG);
  truthy(dry.code === 0, 'check-tests --dry-run вернул код ' + dry.code + ': ' + dry.out.slice(-300));
  const parsed = JSON.parse(dry.out);
  truthy(parsed.mode === 'affected' || parsed.mode === 'full' || parsed.mode === 'selftest', 'неизвестный режим: ' + parsed.mode);
  truthy(parsed.parallel === false || parsed.parallel === true, 'поле parallel отсутствует');
  truthy(Array.isArray(parsed.children) && parsed.children.length >= 1, 'план детей пуст');
  if (parsed.mode === 'affected' && parsed.tests.length > 0) {
    truthy(parsed.parallel === true, 'affected-режим с тестами не помечен parallel:true');
    truthy(parsed.children.includes('selftest') && parsed.children.includes('tests'), 'в плане нет selftest/tests: ' + JSON.stringify(parsed.children));
  }
  console.log('CTPAR OK c2');
}

const table = { c1, c2 };
const which = process.argv[2];
if (!table[which]) {
  console.log('usage: node spec/checks/check-tests-parallel.mjs c1|c2');
  process.exit(2);
}
try {
  await table[which]();
} catch (error) {
  console.log('CTPAR FAIL ' + which + ': ' + (error && error.message ? error.message : error));
  process.exit(1);
}
