#!/usr/bin/env node
/**
 * T1 (стоп-линия): регрессионный гейт подключён к приёмке и запускается.
 *
 * Проверяем исполняемое: (1) в развёрнутой копии task-accept есть вызов regress;
 * (2) regress-провал блокирует приёмку (ветка с отказом); (3) есть ночной запуск
 * (расписание или tools/test.mjs), а не только e2e.
 */
import fs from 'node:fs';
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
  /*
   * 0180: автозапуск регресса вне приёмки. Время суток не важно — важен факт
   * периодического запуска планировщиком. Доказательство — evidence-файл рядом
   * с чеком, который пишет сам запуск: schedule + lastRunAt + exit.
   */
  const evidenceFile = new URL('./regress-schedule.json', import.meta.url);
  let scheduleOk = false;
  let scheduleDetail = 'нет автозапуска: regress-schedule.json отсутствует';
  try {
    const evidence = JSON.parse(fs.readFileSync(evidenceFile, 'utf8'));
    const last = new Date(evidence.lastRunAt).getTime();
    const fresh = Number.isFinite(last) && Date.now() - last <= 26 * 3600 * 1000;
    const declared = typeof evidence.schedule === 'string' && evidence.schedule.trim() !== '';
    scheduleOk = fresh && declared;
    scheduleDetail = scheduleOk ? '' : (declared ? 'последний автозапуск старше 26 часов' : 'в evidence нет расписания');
  } catch (error) {
    scheduleDetail = 'regress-schedule.json не читается: ' + String(error && error.message ? error.message : error);
  }
  checks.push({ name: 'автозапуск регресса вне приёмки (любое время)', ok: scheduleOk, detail: scheduleDetail });
  return checks;
}

if (process.argv[1] && process.argv[1].endsWith('t1-regress-gate.mjs')) {
  const root = process.argv[2] || path.resolve('.');
  process.exit(report('T1', checkT1(root)));
}