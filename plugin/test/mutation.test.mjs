/**
 * 0149: мутационный набор — «убрали факт → отказ», «добавили мусор → не лучше».
 *
 * Каждый кейс берёт копию корпусных фактов 0076 и портит ровно одно место.
 * Смысл не в том, чтобы перечислить ограничения, а в том, чтобы доказать:
 * доказательство нельзя получить удалением или подмешиванием данных.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { factFileOf, readFactFile } from '../../spec/lib/facts.mjs';
import { evaluateTask, loadAcceptors } from '../../spec/engine.mjs';
import { repairFactsFile } from '../../spec/scripts/facts-repair.mjs';

const SOURCE = path.join(process.cwd(), 'docs', 'facts', '0076.jsonl');
const acceptors = loadAcceptors(process.cwd());

function copyFacts() {
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-mut-'));
  fs.mkdirSync(path.join(ws, 'docs', 'facts'), { recursive: true });
  fs.copyFileSync(SOURCE, factFileOf(ws, '0076'));
  return { ws, file: factFileOf(ws, '0076') };
}

function lines(file) { return fs.readFileSync(file, 'utf8').split('\n').filter(Boolean); }
function write(file, rows) { fs.writeFileSync(file, rows.join('\n') + '\n'); }
function verdictOf(ws) { return evaluateTask(readFactFile(factFileOf(ws, '0076')), { acceptors }).verdict; }

const cases = [
  ['убрали accept', (rows) => rows.filter((line) => !line.includes('"kind":"accept"'))],
  ['убрали judgment', (rows) => rows.filter((line) => !line.includes('"kind":"judgment"'))],
  ['убрали evidence verify', (rows) => rows.filter((line) => !(line.includes('"kind":"evidence"') && line.includes('"gate":"verify"')))],
  ['убрали ruleset', (rows) => rows.filter((line) => !line.includes('"kind":"ruleset"'))],
  ['убрали diff', (rows) => rows.filter((line) => !line.includes('"kind":"diff"'))],
];

for (const [name, mutate] of cases) {
  test('мутация: ' + name + ' → rejected', () => {
    const { ws, file } = copyFacts();
    write(file, mutate(lines(file)));
    assert.equal(verdictOf(ws), 'rejected');
  });
}

test('мутация: подмена exit в evidence → rejected', () => {
  const { ws, file } = copyFacts();
  const rows = lines(file).map((line) => (line.includes('"gate":"verify"') ? line.replace('"exit":0', '"exit":1') : line));
  write(file, rows);
  assert.equal(verdictOf(ws), 'rejected');
});

test('мутация: запрещённый путь в diff → rejected', () => {
  const { ws, file } = copyFacts();
  const rows = lines(file).map((line) => (line.includes('"kind":"diff"') ? line.replace('"paths":[', '"paths":["tests/pwn.mjs",') : line));
  write(file, rows);
  assert.equal(verdictOf(ws), 'rejected');
});

test('мутация: удалили успешный sealed, оставив неуспешный → rejected', () => {
  const { ws, file } = copyFacts();
  const rows = lines(file);
  const failed = JSON.stringify({ kind: 'evidence', task: '0076', run: '0076:1', gate: 'sealed', artifact_hash: 'f1', exit: 1, seal_hash: 'x', writer: 'acceptor' });
  write(file, rows.concat([failed]));
  assert.equal(verdictOf(ws), 'rejected');
});

test('мутация: снятие подписи с accept → rejected (C10)', () => {
  const { ws, file } = copyFacts();
  const rows = lines(file).map((line) => {
    if (!line.includes('"kind":"accept"')) return line;
    const row = JSON.parse(line);
    delete row.signature;
    delete row.keyId;
    return JSON.stringify(row);
  });
  write(file, rows);
  const result = evaluateTask(readFactFile(factFileOf(ws, '0076')), { acceptors });
  assert.equal(result.report.find((item) => item.id === 'C10').status, 'fail');
  assert.equal(result.verdict, 'rejected');
});

test('мутация: подписанная строка не уходит в карантин', () => {
  const { ws, file } = copyFacts();
  const signed = lines(file).find((line) => line.includes('"gate":"verify"'));
  fs.appendFileSync(file, signed + '\nпорча');
  const repaired = repairFactsFile(file);
  assert.equal(repaired.ok, false);
});

test('свойство: добавление мусора не улучшает вердикт', () => {
  const { ws, file } = copyFacts();
  const rows = lines(file);
  rows.push(JSON.stringify({ kind: 'evidence', task: '0076', run: '0076:1', gate: 'magic', artifact_hash: 'x', exit: 0, writer: 'acceptor' }));
  write(file, rows);
  assert.equal(verdictOf(ws), 'rejected');
});

test('свойство: правка подписанного факта не улучшает вердикт', () => {
  const { ws, file } = copyFacts();
  const rows = lines(file).map((line) => (line.includes('"kind":"judgment"') ? line.replace('"verdict":"accepted"', '"verdict":"accepted","extra":1') : line));
  write(file, rows);
  assert.equal(verdictOf(ws), 'rejected');
});

test('контроль: исходный корпус accepted (иначе мутации ничего не доказывают)', () => {
  const { ws } = copyFacts();
  assert.equal(verdictOf(ws), 'accepted');
});