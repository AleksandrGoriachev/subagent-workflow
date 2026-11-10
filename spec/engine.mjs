#!/usr/bin/env node
/**
 * 0136 (P0): исполнитель ограничений. Читает факты задачи и оценивает
 * ограничения C1–C10 из спецификации v0.2. Чистая функция: ничего не пишет.
 *
 * В P0 ограничения, для которых у сегодняшнего процесса нет источника данных
 * (C2 sealed_run, C5 политика гейтов, C8 план действий, C9 смена правил),
 * получают статус 'not-applicable' — подделать факт хуже, чем честно сказать
 * «такого доказательства сегодня нет».
 */
import fs from 'node:fs';
import path from 'node:path';
import { factFileOf, readFactFile } from './lib/facts.mjs';

function rowsOf(read, kind) {
  return read.rows.filter((row) => row.kind === kind);
}

/** Оценка всех применимых ограничений по фактам задачи. */
export function evaluateTask(read, options = {}) {
  const report = [];
  const t = rowsOf(read, 'task')[0];
  const c = rowsOf(read, 'contract')[0];
  const r = rowsOf(read, 'run')[0];
  const d = rowsOf(read, 'diff')[0];
  const j = rowsOf(read, 'judgment')[0];
  const a = rowsOf(read, 'accept')[0];
  const evidence = rowsOf(read, 'evidence');

  /* C1: задача ссылается на контракт, контракт совпадает с генезисом. */
  const c1 = Boolean(t && c && r && t.contract_hash === c.hash);
  report.push({ id: 'C1', status: c1 ? 'pass' : 'fail', detail: c1 ? 'контракт и запуск согласованы' : 'контракт/запуск не согласованы или отсутствуют' });

  /* C4: суждение о том же артефакте, что в accept, вердикт accepted. */
  const c4 = Boolean(j && a && j.artifact_hash === a.diff_hash && j.verdict === 'accepted');
  report.push({ id: 'C4', status: c4 ? 'pass' : 'fail', detail: c4 ? 'суждение совпадает с диффом' : 'суждение отсутствует или привязано к другому артефакту' });

  /* C7: цепь фактов цела. */
  report.push({ id: 'C7', status: read.ok ? 'pass' : 'fail', detail: read.ok ? 'цепь цела' : read.problems.join('; ') });

  /* C10: свидетельство одно и его хеши совпадают с фактами. */
  const accepts = rowsOf(read, 'accept');
  const c10 = accepts.length === 1 && Boolean(a && c && d && a.contract_hash === c.hash && a.diff_hash === d.diff_hash);
  report.push({ id: 'C10', status: c10 ? 'pass' : 'fail', detail: c10 ? 'свидетельство единственно и согласовано' : 'свидетельств ' + accepts.length + ' или хеши разошлись' });

  /* Не применимо сегодня: честно называем отсутствие источника данных. */
  report.push({ id: 'C2', status: 'not-applicable', detail: 'sealed_run не производится текущим процессом' });
  report.push({ id: 'C5', status: 'not-applicable', detail: 'policy(ruleset, risk) ещё не определена; доказательства гейтов есть: ' + evidence.length });
  report.push({ id: 'C8', status: 'not-applicable', detail: 'planned(t) не записывается' });
  report.push({ id: 'C9', status: 'not-applicable', detail: 'ruleset не подписывается в P0' });
  report.push({ id: 'C3', status: 'not-applicable', detail: 'запрещённые пути задаются правилами (ruleset), которых ещё нет' });
  report.push({ id: 'C6', status: 'not-applicable', detail: 'release-факты для задачи не применимы' });

  const applicable = report.filter((item) => item.status !== 'not-applicable');
  const passed = applicable.filter((item) => item.status === 'pass');
  return { task: t ? t.id : '?', report, verdict: applicable.length > 0 && passed.length === applicable.length ? 'accepted' : 'rejected', passed: passed.length, applicable: applicable.length };
}

/** Оценить задачу воркспейса по id. */
export function evaluateWorkspaceTask(workspace, taskId) {
  const file = factFileOf(workspace, taskId);
  const read = readFactFile(file);
  return evaluateTask(read);
}

if (process.argv[1] && import.meta.url === new URL('file://' + path.resolve(process.argv[1]).split(path.sep).join('/')).href) {
  const argv = process.argv.slice(2);
  const value = (flag) => { const index = argv.indexOf(flag); return index >= 0 ? argv[index + 1] : undefined; };
  const task = value('--task');
  const workspace = value('--workspace') || process.cwd();
  if (!task) { console.log('нужен --task <id>'); process.exitCode = 2; }
  else {
    const result = evaluateWorkspaceTask(workspace, task);
    console.log('engine: ' + result.task + ' — вердикт ' + result.verdict + ' (применимо ' + result.applicable + ', pass ' + result.passed + ')');
    for (const item of result.report) console.log('  ' + item.id + ' ' + item.status + ': ' + item.detail);
  }
}