#!/usr/bin/env node
/*
 * 2.6.82: закрытие задания без приёмки (closure.json).
 *
 * Обязательства:
 *  - c1: task-close пишет closure.json с обязательными полями и строку аудита;
 *  - c2: принятое задание закрыть нельзя;
 *  - c3: закрытое задание закрыть повторно нельзя (закрытие окончательное);
 *  - c4: --delete-contract удаляет контракт, оставляя closure.json, и пишет удалённое в аудит;
 *  - c5: закрытое задание не активно для task-guard (не расширяет allowedPaths);
 *  - c6: task-accept и task-verify отказывают закрытому заданию;
 *  - c7: --full удаляет и attack.json (артефакт задания), оставляя closure.json.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { closeTask, closureOf, auditFile } from '../scripts/task-close.mjs';
import { coverageFromWorktree } from '../scripts/task-guard.mjs';
import { spawnSyncPipeFree } from '../scripts/lib/common.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SCRIPTS = path.join(HERE, '..', 'scripts');
const truthy = (value, label) => { if (!value) throw new Error(label); };
const equal = (actual, expected, label) => {
  if (actual !== expected) throw new Error(label + ': ожидалось ' + JSON.stringify(expected) + ', получено ' + JSON.stringify(actual));
};

const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-closure-'));

function taskMd(id) {
  const meta = {
    id, version: 1, title: 'фикстура закрытия', risk: 'low', created: '2026-11-17',
    owner: 'архитектор', executor: 'subagent:executor', acceptor: 'subagent:judge',
    base: 'HEAD', criteria: 'criteria.json', allowedPaths: ['lib/**'],
  };
  return [
    '# Задание ' + id + '. фикстура',
    '',
    '<!-- TASK-META',
    JSON.stringify(meta, null, 2),
    '-->',
    '',
    '<!-- CRITERIA:BEGIN -->',
    '## Критерии приёмки',
    '',
    '| ID | Проверка | Ожидание |',
    '| --- | --- | --- |',
    '| C1 | node -e "process.exit(0)" | exit 0 |',
    '<!-- CRITERIA:END -->',
    '',
  ].join('\n');
}

function makeTask(id, { acceptance = false, closure = false } = {}) {
  const dir = path.join(repo, 'docs', 'tasks', id);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'task.md'), taskMd(id));
  fs.writeFileSync(path.join(dir, 'criteria.json'), JSON.stringify({ task: id, criteria: [{ id: 'C1', title: 'фикстура', command: 'node -e "process.exit(0)"', expect: { exitCode: 0 } }] }, null, 2) + '\n');
  fs.writeFileSync(path.join(dir, 'criteria.lock'), '{}\n');
  if (acceptance) fs.writeFileSync(path.join(dir, 'acceptance.json'), '{}\n');
  if (closure) fs.writeFileSync(path.join(dir, 'closure.json'), JSON.stringify({ version: 1, task: id, status: 'closed', reason: 'фикстура: закрыто', by: 'tester', at: '2026-11-17T20:00:00.000Z', successor: null, evidence: [] }, null, 2) + '\n');
  return dir;
}

try {
  /* c1: закрытие пишет запись и аудит */
  const dir1 = makeTask('0001');
  const r1 = closeTask({
    repo, taskDir: dir1, status: 'superseded', reason: 'заменено 0002',
    by: 'tester', successor: '0002', evidence: ['письмо-04'], at: '2026-11-17T20:10:00.000Z',
  });
  const closure1 = closureOf(dir1);
  equal(closure1.status, 'superseded', 'c1: status');
  equal(closure1.successor, '0002', 'c1: successor');
  equal(closure1.by, 'tester', 'c1: by');
  equal(closure1.task, '0001', 'c1: task');
  equal(r1.deleted.length, 0, 'c1: без --delete-contract файлы не удаляются');
  const auditLines = fs.readFileSync(auditFile(repo), 'utf8').trim().split(/\r?\n/);
  equal(auditLines.length, 1, 'c1: одна строка аудита');
  const audit1 = JSON.parse(auditLines[0]);
  equal(audit1.task, '0001', 'c1: аудит — task');
  equal(audit1.status, 'superseded', 'c1: аудит — status');

  /* c2: принятое закрыть нельзя */
  const dir2 = makeTask('0002', { acceptance: true });
  let refused = false;
  try { closeTask({ repo, taskDir: dir2, status: 'closed', reason: 'нельзя', by: 'tester' }); } catch { refused = true; }
  truthy(refused, 'c2: принятое задание должно быть отвергнуто');
  truthy(!fs.existsSync(path.join(dir2, 'closure.json')), 'c2: closure.json не создан');

  /* c3: повторное закрытие запрещено */
  const dir3 = makeTask('0003', { closure: true });
  refused = false;
  try { closeTask({ repo, taskDir: dir3, status: 'closed', reason: 'повтор', by: 'tester' }); } catch { refused = true; }
  truthy(refused, 'c3: повторное закрытие должно быть отвергнуто');

  /* c4: --delete-contract удаляет контракт, closure.json остаётся */
  const dir4 = makeTask('0004');
  const r4 = closeTask({
    repo, taskDir: dir4, status: 'closed', reason: 'брошено', by: 'tester', deleteContract: true,
  });
  truthy(!fs.existsSync(path.join(dir4, 'task.md')), 'c4: task.md удалён');
  truthy(!fs.existsSync(path.join(dir4, 'criteria.json')), 'c4: criteria.json удалён');
  truthy(fs.existsSync(path.join(dir4, 'closure.json')), 'c4: closure.json остался');
  equal(r4.deleted.sort().join(','), 'criteria.json,task.md', 'c4: список удалённого');
  const last = JSON.parse(fs.readFileSync(auditFile(repo), 'utf8').trim().split(/\r?\n/).pop());
  equal(last.deleted.sort().join(','), 'criteria.json,task.md', 'c4: аудит фиксирует удаление');

  /* c5: закрытое задание не активно для guard */
  const coverage = coverageFromWorktree(repo, { tasksDir: 'docs/tasks' });
  const closedTask = coverage.tasks.find((task) => task.id === '0003');
  truthy(closedTask, 'c5: закрытая задача найдена в coverage');
  equal(closedTask.active, false, 'c5: закрытое задание не активно');
  equal(closedTask.open, false, 'c5: закрытое задание не открыто');

  /* c7: --full удаляет артефакты задания, включая attack.json */
  const dir5 = makeTask('0005');
  fs.writeFileSync(path.join(dir5, 'attack.json'), '{}\n');
  closeTask({ repo, taskDir: dir5, status: 'closed', reason: 'брошено', by: 'tester', deleteContract: true, full: true });
  truthy(!fs.existsSync(path.join(dir5, 'attack.json')), 'c7: attack.json удалён при --full');
  truthy(!fs.existsSync(path.join(dir5, 'criteria.lock')), 'c7: criteria.lock удалён при --full');
  truthy(fs.existsSync(path.join(dir5, 'closure.json')), 'c7: closure.json остался');

  /* c6: приёмка и верификация закрытого отказывают */
  for (const script of ['task-accept.mjs', 'task-verify.mjs']) {
    const run = spawnSyncPipeFree(process.execPath, [path.join(SCRIPTS, script), '--task', dir3, '--repo', repo], { encoding: 'utf8' });
    equal(run.status, 1, 'c6: ' + script + ' должен отказать');
    truthy(String(run.stderr || '').includes('закрыто без приёмки'), 'c6: ' + script + ' называет причину');
  }
} finally {
  fs.rmSync(repo, { recursive: true, force: true });
}

console.log('closure-accounting: OK c1–c7');
