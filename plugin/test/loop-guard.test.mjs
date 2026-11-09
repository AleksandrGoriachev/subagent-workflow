/**
 * 0127 (WC-80): отсечение зацикливания.
 *
 * c1: серия одинаковых падений — предупреждение, затем отказ;
 * c2: успех обнуляет серию (падение «раз в жизни» не блокирует);
 * c3: разные аргументы с тем же классом ошибки тоже считаются циклом;
 * c4: отказ объясняет, что менять (метод, а не «попробуй ещё»);
 * c5: детектор по журналу находит серию с разными аргументами.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import {
  createLoopState,
  observeResult,
  refusalFor,
  signatureOf,
  callSignature,
} from '../lib/loop-guard.js';
import { analyzeJournal } from '../../spec/checks/loop-detector.mjs';

const SESSION = 's-1';

test('c1: серия одинаковых падений — warn, затем refuse', () => {
  const state = createLoopState({ limit: 3 });
  const input = { session: SESSION, tool: 'run_code', args: { code: 'x' }, error: 'Error: Unexpected token const' };
  assert.equal(observeResult(state, input).action, 'allow');
  assert.equal(observeResult(state, input).action, 'warn');
  assert.equal(observeResult(state, input).action, 'refuse');
  assert.ok(refusalFor(state, { session: SESSION, tool: 'run_code', args: { code: 'x' } }));
});

test('c2: успех обнуляет серию', () => {
  const state = createLoopState({ limit: 2 });
  const input = { session: SESSION, tool: 'run_code', args: { code: 'x' }, error: 'boom' };
  observeResult(state, input);
  assert.equal(observeResult(state, { ...input, error: '' }).action, 'allow');
  assert.equal(refusalFor(state, { session: SESSION, tool: 'run_code', args: { code: 'x' } }), null);
});

test('c3: разные аргументы, та же ошибка — цикл по классу', () => {
  const state = createLoopState({ limit: 3 });
  for (const code of ['a', 'b', 'c']) {
    observeResult(state, { session: SESSION, tool: 'run_code', args: { code }, error: 'Error: Unexpected token const' });
  }
  const reason = refusalFor(state, { session: SESSION, tool: 'run_code', args: { code: 'd' } });
  assert.ok(reason, 'инструмент блокируется по классу ошибки');
});

test('c4: отказ называет метод, а не повтор', () => {
  const state = createLoopState({ limit: 2 });
  for (let i = 0; i < 2; i += 1) {
    observeResult(state, { session: SESSION, tool: 'run_code', args: { code: 'x' + i }, error: 'Error: Unexpected token const' });
  }
  const reason = refusalFor(state, { session: SESSION, tool: 'run_code', args: { code: 'z' } });
  assert.match(String(reason), /Смени метод/u);
  assert.match(String(reason), /write|edit|шаблон/iu);
});

test('c5: детектор находит серию в журнале (аргументы разные)', () => {
  const call = (id, code) => JSON.stringify({ type: 'tool/call', seq: 1, data: { callId: id, name: 'run_code', arguments: JSON.stringify({ code }) } });
  const result = (id, text) => JSON.stringify({
    type: 'tool/result',
    seq: 2,
    data: { message: { toolCallId: id, isError: true, content: [{ type: 'text', text }] } },
  });
  const lines = [
    call('c1', 'a'), result('c1', 'Error: code run failed (exception): Unexpected token const'),
    call('c2', 'b'), result('c2', 'Error: code run failed (exception): Unexpected token const'),
    call('c3', 'c'), result('c3', 'Error: code run failed (exception): Unexpected token const'),
  ];
  const report = analyzeJournal(lines, { limit: 3 });
  assert.equal(report.groups.length, 1);
  assert.equal(report.groups[0].count, 3);
  assert.equal(report.groups[0].tool, 'run_code');
  assert.match(report.groups[0].hint, /write|edit|шаблон/iu);
});
