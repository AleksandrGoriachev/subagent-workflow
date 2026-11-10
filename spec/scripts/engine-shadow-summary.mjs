#!/usr/bin/env node
/**
 * 0156 (P2b): сводка теневых прогонов. Читает engine-shadow.json по задачам и
 * показывает, где движок и фактическая приёмка разошлись. Нужна для решения
 * «пора ли включать блокировку»: расхождения считаются, а не обсуждаются.
 */
import fs from 'node:fs';
import path from 'node:path';
import { isMainModule } from './lib/common.mjs';

/** Прочитать все теневые отчёты каталога задач. */
export function collectShadow(workspace) {
  const tasksDir = path.join(String(workspace), 'docs', 'tasks');
  if (!fs.existsSync(tasksDir)) return { ok: false, problems: ['нет каталога задач: ' + tasksDir], rows: [] };
  const rows = [];
  for (const entry of fs.readdirSync(tasksDir, { withFileTypes: true })) {
    if (!entry.isDirectory() || !/^[0-9]{4}$/u.test(entry.name)) continue;
    const file = path.join(tasksDir, entry.name, 'engine-shadow.json');
    if (!fs.existsSync(file)) continue;
    try {
      const data = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/u, ''));
      rows.push({
        task: entry.name,
        at: data.at || null,
        engineVerdict: data.engineVerdict || data.status || 'unknown',
        acceptanceStatus: data.acceptanceStatus || null,
        agree: data.agree === true,
        failed: Array.isArray(data.report) ? data.report.filter((item) => item.status === 'fail').map((item) => item.id) : [],
      });
    } catch (error) {
      rows.push({ task: entry.name, error: String(error && error.message ? error.message : error) });
    }
  }
  rows.sort((a, b) => String(a.task).localeCompare(String(b.task)));
  return { ok: true, rows, problems: [] };
}

/** Итог: сколько согласны, сколько нет, какие ограничения падают. */
export function summarize(rows) {
  const checked = rows.filter((row) => row.error === undefined && row.acceptanceStatus !== null);
  const disagree = checked.filter((row) => row.agree !== true);
  const byConstraint = new Map();
  for (const row of disagree) for (const id of row.failed || []) byConstraint.set(id, (byConstraint.get(id) || 0) + 1);
  return {
    total: rows.length,
    checked: checked.length,
    agree: checked.length - disagree.length,
    disagree,
    byConstraint: [...byConstraint.entries()].sort((a, b) => b[1] - a[1]),
  };
}

if (isMainModule(import.meta.url)) {
  const argv = process.argv.slice(2);
  const value = (flag) => { const index = argv.indexOf(flag); return index >= 0 ? argv[index + 1] : undefined; };
  const workspace = value('--workspace') || process.cwd();
  const collected = collectShadow(workspace);
  if (!collected.ok) {
    for (const problem of collected.problems) console.log('SHADOW PROBLEM ' + problem);
    process.exitCode = 2;
  } else {
    const summary = summarize(collected.rows);
    for (const row of collected.rows) {
      const mark = row.error ? 'ERR ' : (row.agree ? 'OK  ' : 'DIFF');
      console.log(mark + ' ' + row.task + ' — движок ' + row.engineVerdict + ', приёмка ' + (row.acceptanceStatus || '?') + (row.failed && row.failed.length ? ' [' + row.failed.join(',') + ']' : ''));
    }
    console.log('итог: проверено ' + summary.checked + ', совпало ' + summary.agree + ', расхождений ' + summary.disagree.length);
    if (summary.byConstraint.length > 0) console.log('по ограничениям: ' + summary.byConstraint.map(([id, count]) => id + '×' + count).join(', '));
    process.exitCode = summary.disagree.length === 0 ? 0 : 1;
  }
}