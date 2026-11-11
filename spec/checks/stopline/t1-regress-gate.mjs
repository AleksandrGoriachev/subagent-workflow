#!/usr/bin/env node
/**
 * T1 (стоп-линия): регрессионный гейт подключён к приёмке и запускается.
 *
 * Проверяем исполняемое: (1) в развёрнутой копии task-accept есть вызов regress;
 * (2) regress-провал блокирует приёмку (ветка с отказом); (3) есть ночной запуск
 * (расписание или tools/test.mjs), а не только e2e.
 */
import path from 'node:path';
import { read, exists, report } from './common.mjs';

export function checkT1(root) {
  const acc = read(root, 'docs/subagent-workflow/scripts/task-accept.mjs');
  const nightly = read(root, 'docs/subagent-workflow/scripts/task-regress.mjs');
  const pkg = read(root, 'package.json') || '';
  const checks = [];
  checks.push({
    name: 'task-accept вызывает регресс',
    ok: Boolean(acc && /task-regress|runRegress|regress\(/u.test(acc)),
    detail: acc === null ? 'нет task-accept.mjs' : 'в task-accept нет упоминания регресса — гейт не подключён',
  });
  checks.push({
    name: 'провал регресса блокирует приёмку',
    ok: Boolean(acc && /regress[\s\S]{0,400}?(fail|exit\(1\)|process\.exit\(1\)|rejected|блок)/iu.test(acc)),
    detail: 'нет ветки, где провал регресса останавливает приёмку',
  });
  /* Ночной запуск должен звать именно регресс, а не просто «есть test.mjs». */
  const runner = read(root, 'tools/test.mjs') || '';
  const schedule = read(root, 'docs/subagent-workflow/scripts/task-regress.mjs') ? (read(root, 'tools/test.mjs') || '') : '';
  const callsRegress = /task-regress|regress\.mjs/iu.test(runner) || /task-regress|regress\.mjs/iu.test(schedule);
  checks.push({
    name: 'ночной запуск зовёт регресс (не только e2e)',
    ok: callsRegress,
    detail: 'task-regress вызывается только из e2e — вне приёмки регрессии не перезапускаются',
  });
  return checks;
}

if (process.argv[1] && process.argv[1].endsWith('t1-regress-gate.mjs')) {
  const root = process.argv[2] || path.resolve('.');
  process.exit(report('T1', checkT1(root)));
}