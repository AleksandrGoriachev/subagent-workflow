/*
 * 0106 (2.6.96): монитор задач — стадия и флаги.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const { summarizeTasks } = await import('../../tools/task-monitor.mjs');

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-monitor-'));
  const tasks = path.join(root, 'docs', 'tasks');
  fs.mkdirSync(tasks, { recursive: true });
  return { root, tasks };
}

function writeTask(tasks, id, meta, extras = {}) {
  const dir = path.join(tasks, id);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'task.md'), '# Задание ' + id + '\n\n<!-- TASK-META\n' + JSON.stringify(meta, null, 2) + '\n-->\n');
  for (const [name, value] of Object.entries(extras)) {
    fs.writeFileSync(path.join(dir, name), typeof value === 'string' ? value : JSON.stringify(value, null, 2) + '\n');
  }
  return dir;
}

test('монитор: стадии и флаги незавершённой задачи', () => {
  const { root, tasks } = fixture();
  writeTask(tasks, '0001', { id: '0001', title: 'в работе', risk: 'medium' }, {
    'criteria.lock': '{}\n',
    'red.json': { redProven: false },
    'verify.json': { allPassed: false },
  });
  const summary = summarizeTasks(root, { now: new Date() });
  assert.equal(summary.tasks.length, 1);
  const row = summary.tasks[0];
  assert.equal(row.stage, 'contract');
  for (const flag of ['red-not-proven', 'verify-red', 'no-acceptance']) assert.ok(row.flags.includes(flag), 'нет флага ' + flag);
});

test('монитор: принятая задача без флагов', () => {
  const { root, tasks } = fixture();
  writeTask(tasks, '0002', { id: '0002', title: 'принята', risk: 'medium' }, {
    'criteria.lock': '{}\n',
    'red.json': { redProven: true },
    'verify.json': { allPassed: true },
    'acceptance.json': { status: 'accepted' },
  });
  const summary = summarizeTasks(root, { now: new Date() });
  const row = summary.tasks[0];
  assert.equal(row.stage, 'accepted');
  assert.deepEqual(row.flags, []);
});

test('монитор: зависшая задача и superseeded', () => {
  const { root, tasks } = fixture();
  const old = writeTask(tasks, '0003', { id: '0003', title: 'старая', risk: 'medium' }, {
    'criteria.lock': '{}\n',
    'red.json': { redProven: true },
    'verify.json': { allPassed: true },
  });
  const longAgo = new Date(Date.now() - 48 * 3600 * 1000);
  for (const name of ['task.md', 'criteria.lock', 'red.json', 'verify.json']) fs.utimesSync(path.join(old, name), longAgo, longAgo);
  writeTask(tasks, '0004', { id: '0004', title: 'заменена', risk: 'low' }, { 'closure.json': { status: 'superseded' } });
  const summary = summarizeTasks(root, { now: new Date(), stallHours: 6 });
  const stalled = summary.tasks.find((row) => row.id === '0003');
  assert.ok(stalled.flags.includes('stalled'), 'нет флага stalled');
  const closed = summary.tasks.find((row) => row.id === '0004');
  assert.equal(closed.stage, 'closed');
  assert.ok(closed.flags.includes('superseded'));
});
