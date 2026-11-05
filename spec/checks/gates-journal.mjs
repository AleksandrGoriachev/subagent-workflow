#!/usr/bin/env node
/*
 * 2.6.18 (0051): журнал вердиктов ворот.
 *
 * Замер structure (письмо --127): «сколько раз ворота отказали и сколько это стоило — сейчас
 * неизмеримо; цена переделок считается косвенно, по git log». Ворота пишут только успешные
 * прогоны (red.log/verify.log), отказы исчезают.
 *
 * Здесь: gateRecord(record) — нормализованная запись, appendGateRecord(file, record) — append-only
 * JSONL. Ворота task-red/task-verify/task-accept обязаны писать по строке на каждый прогон.
 *
 * Вне пакета — SKIP (конвенция deployed-copy).
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSyncPipeFree } from '../scripts/lib/common.mjs';
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
  truthy(typeof common.gateRecord === 'function', 'в common.mjs нет gateRecord');
  truthy(typeof common.appendGateRecord === 'function', 'в common.mjs нет appendGateRecord');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-gates-'));
  const file = path.join(dir, 'gates.jsonl');
  const first = common.gateRecord({
    kind: 'verify',
    task: '0051',
    at: '2026-11-04T02:10:00+03:00',
    head: 'abcdef0',
    criteria: [
      { id: 'C1', exitCode: 0, durationMs: 12, passed: true },
      { id: 'C2', exitCode: 3, durationMs: 40, passed: false, reasons: ['ждали 0, получили 3'] },
    ],
    verdict: 'red',
  });
  truthy(first && first.kind === 'verify', 'gateRecord потерял kind: ' + JSON.stringify(first));
  truthy(Array.isArray(first.criteria) && first.criteria.length === 2, 'gateRecord потерял критерии');
  truthy(first.criteria[1].exitCode === 3 && first.criteria[1].durationMs === 40, 'gateRecord потерял exit/ms');
  truthy(Array.isArray(first.criteria[1].reasons) && first.criteria[1].reasons.length === 1, 'причина отказа потеряна');
  common.appendGateRecord(file, first);
  common.appendGateRecord(file, common.gateRecord({ kind: 'accept', task: '0051', head: 'abcdef0', criteria: [], verdict: 'accepted' }));
  const lines = fs.readFileSync(file, 'utf8').trim().split('\n');
  truthy(lines.length === 2, 'строк в журнале ' + lines.length + ', ожидалось 2');
  const parsed = lines.map((line) => JSON.parse(line));
  truthy(parsed[0].kind === 'verify' && parsed[1].kind === 'accept', 'порядок записей нарушен');
  truthy(typeof parsed[1].at === 'string' && parsed[1].at.length > 10, 'у записи нет времени');
  console.log('GATES OK c1');
}

function c2() {
  const source = fs.readFileSync(path.join(PKG, 'spec', 'scripts', 'lib', 'common.mjs'), 'utf8');
  truthy(/gates\.jsonl/u.test(source), 'в common.mjs нет имени gates.jsonl');
  for (const gate of ['task-red.mjs', 'task-verify.mjs', 'task-accept.mjs']) {
    const file = path.join(PKG, 'spec', 'scripts', gate);
    truthy(fs.existsSync(file), 'нет ' + gate);
    const text = fs.readFileSync(file, 'utf8');
    truthy(/appendGateRecord/u.test(text), gate + ' не пишет журнал вердиктов');
    const syntax = spawnSyncPipeFree(process.execPath, ['--check', file], { encoding: 'utf8' });
    truthy(syntax.status === 0, file + ': ' + String(syntax.stderr || '').trim());
  }
  console.log('GATES OK c2');
}

const table = { c1, c2 };
const which = process.argv[2];
if (!table[which]) {
  console.log('usage: node spec/checks/gates-journal.mjs c1|c2');
  process.exit(2);
}
try {
  table[which]();
} catch (error) {
  console.log('GATES FAIL ' + which + ': ' + (error && error.message ? error.message : error));
  process.exit(1);
}
