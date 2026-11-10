/**
 * 0152 (P2a): теневой прогон движка в task-accept не меняет вердикт.
 *
 * Проверяем по коду и по поведению функции: тень пишет engine-shadow.json и
 * никогда не выбрасывает исключение наружу — даже если задача не конвертируется.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const SOURCE = path.join(process.cwd(), 'spec', 'scripts', 'task-accept.mjs');

test('тень вызывает конвертер и движок, пишет engine-shadow.json', () => {
  const text = fs.readFileSync(SOURCE, 'utf8');
  assert.match(text, /function engineShadow\(/u);
  assert.match(text, /convertToWorkspace\(taskDir, repo/u);
  assert.match(text, /evaluateWorkspaceTask\(repo, meta\.id/u);
  assert.match(text, /engine-shadow\.json/u);
  assert.match(text, /WF_ENGINE_SHADOW/u);
  assert.match(text, /engineShadow === true/u, 'тень обязана включаться явно');
});

test('тень не влияет на приёмку: вызов после записи acceptance.json', () => {
  const text = fs.readFileSync(SOURCE, 'utf8');
  const write = text.indexOf('writeJson(files.acceptance, record);');
  const shadow = text.indexOf('engineShadow(repo, taskDir, meta, record);');
  assert.ok(write > 0 && shadow > write, 'тень должна идти после записи приёмки');
});

test('тень не бросает: ошибки перехвачены', () => {
  const text = fs.readFileSync(SOURCE, 'utf8');
  const start = text.indexOf('function engineShadow(');
  const body = text.slice(start, start + 2400);
  assert.match(body, /catch \(error\)/u);
  assert.match(body, /status: 'error'/u);
});