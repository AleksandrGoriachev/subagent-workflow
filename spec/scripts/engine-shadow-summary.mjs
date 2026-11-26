#!/usr/bin/env node
/**
 * 0156 (P2b): сводка теневых прогонов. Читает engine-shadow.json по задачам и
 * показывает, где движок и фактическая приёмка разошлись. Нужна для решения
 * «пора ли включать блокировку»: расхождения считаются, а не обсуждаются.
 */
import fs from 'node:fs';
import path from 'node:path';
import { isMainModule } from './lib/common.mjs';

/** Где лежит реестр отклонений (путь относительно корня воркспейса). */
export const DEVIATIONS_REL = 'docs/shadow-deviations.json';

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
        problem: data.problem || null,
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

/**
 * 0163: реестр отклонений. Битый или неполный реестр — ошибка, а не тихое согласие:
 * отклонение без причины, автора или привязки к строкам не действует.
 */
export function readDeviations(workspace) {
  const rel = DEVIATIONS_REL;
  const file = path.join(String(workspace), 'docs', 'shadow-deviations.json');
  if (!fs.existsSync(file)) return { ok: true, rel, entries: [], problems: [] };
  let data;
  try {
    data = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/u, ''));
  } catch (error) {
    return { ok: false, rel, entries: [], problems: [rel + ': не читается как JSON (' + String(error && error.message ? error.message : error) + ')'] };
  }
  if (!data || typeof data !== 'object' || !Array.isArray(data.entries)) {
    return { ok: false, rel, entries: [], problems: [rel + ': нет массива entries'] };
  }
  const problems = [];
  const entries = [];
  data.entries.forEach((entry, index) => {
    const tag = rel + ': запись #' + (index + 1);
    if (!entry || typeof entry !== 'object') { problems.push(tag + ' — не объект'); return; }
    const task = String(entry.task || '');
    if (!/^[0-9]{4}$/u.test(task)) { problems.push(tag + ' — task должен быть номером задания'); return; }
    if (String(entry.facts || '') !== 'docs/facts/' + task + '.jsonl') { problems.push(tag + ' — facts должен указывать на docs/facts/' + task + '.jsonl'); return; }
    if (typeof entry.reason !== 'string' || entry.reason.trim() === '') { problems.push(tag + ' — нет причины (reason)'); return; }
    if (typeof entry.by !== 'string' || entry.by.trim() === '') { problems.push(tag + ' — нет автора решения (by)'); return; }
    if (typeof entry.at !== 'string' || entry.at.trim() === '') { problems.push(tag + ' — нет времени решения (at)'); return; }
    if (!Array.isArray(entry.conflicts) || entry.conflicts.length === 0) { problems.push(tag + ' — нет привязки к строкам доказательств (conflicts)'); return; }
    const conflicts = [];
    for (const [i, conflict] of entry.conflicts.entries()) {
      const ctag = tag + ', conflicts[' + i + ']';
      if (!conflict || typeof conflict !== 'object') { problems.push(ctag + ' — не объект'); return; }
      const gate = String(conflict.gate || '');
      if (gate === '') { problems.push(ctag + ' — без гейта'); return; }
      const exits = Array.isArray(conflict.exits) ? conflict.exits.map(Number).filter((value) => !Number.isNaN(value)) : [];
      if (exits.length < 2 || new Set(exits).size !== exits.length) { problems.push(ctag + ' — exits должны быть двумя разными кодами'); return; }
      const evidence = Array.isArray(conflict.evidence) ? conflict.evidence.map(String).filter((value) => value !== '') : [];
      if (evidence.length === 0) { problems.push(ctag + ' — без хешей строк доказательств (evidence)'); return; }
      conflicts.push({ gate, exits: [...exits].sort((a, b) => a - b), evidence: [...evidence].sort() });
    }
    entries.push({ task, facts: String(entry.facts), reason: entry.reason.trim(), by: entry.by.trim(), at: entry.at.trim(), conflicts });
  });
  return { ok: problems.length === 0, rel, entries, problems };
}

/** 0163: конфликтующие доказательства задания — гейт, оба exit и хеши строк. */
export function evidenceConflicts(workspace, task) {
  const rel = 'docs/facts/' + task + '.jsonl';
  const file = path.join(String(workspace), 'docs', 'facts', task + '.jsonl');
  if (!fs.existsSync(file)) return { rel, conflicts: [], evidence: 0 };
  const byGate = new Map();
  let count = 0;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/u)) {
    const text = line.trim();
    if (text === '') continue;
    let fact;
    try { fact = JSON.parse(text); } catch { continue; }
    if (!fact || fact.kind !== 'evidence') continue;
    const gate = String(fact.gate || '');
    if (gate === '') continue;
    count += 1;
    if (!byGate.has(gate)) byGate.set(gate, []);
    byGate.get(gate).push({ exit: Number(fact.exit), hash: String(fact.artifact_hash || '') });
  }
  const conflicts = [];
  for (const [gate, rows] of byGate) {
    const exits = [...new Set(rows.map((row) => row.exit))].filter((value) => !Number.isNaN(value)).sort((a, b) => a - b);
    if (exits.length < 2) continue;
    conflicts.push({ gate, exits, evidence: rows.map((row) => row.hash).filter((value) => value !== '').sort() });
  }
  conflicts.sort((a, b) => a.gate.localeCompare(b.gate));
  return { rel, conflicts, evidence: count };
}

/** 0163: действует ли запись реестра для текущего набора конфликтов. */
export function deviationCovers(entry, conflicts) {
  if (!entry || !Array.isArray(entry.conflicts)) return false;
  if (typeof entry.reason !== 'string' || entry.reason.trim() === '') return false;
  if (entry.conflicts.length !== conflicts.length) return false;
  const left = [...entry.conflicts].sort((a, b) => a.gate.localeCompare(b.gate));
  const right = [...conflicts].sort((a, b) => a.gate.localeCompare(b.gate));
  for (let i = 0; i < left.length; i += 1) {
    if (left[i].gate !== right[i].gate) return false;
    if (left[i].exits.join(',') !== right[i].exits.join(',')) return false;
    const a = [...left[i].evidence].sort();
    const b = [...right[i].evidence].sort();
    if (a.length !== b.length) return false;
    for (let j = 0; j < a.length; j += 1) if (a[j] !== b[j]) return false;
  }
  return true;
}

/**
 * 0163: разложить строки сводки на «совпало», «отклонение по реестру»,
 * «расхождение» и «не вычислима». Ничего не решает: показывает, что чем названо.
 */
export function reconcile(workspace, rows, options = {}) {
  const deviations = options.deviations || readDeviations(workspace);
  const entries = deviations.ok === true ? deviations.entries : [];
  const result = { checked: 0, agree: [], waived: [], diverged: [], notComputable: [], problems: [...(deviations.problems || [])] };
  for (const row of rows) {
    if (row.error !== undefined) {
      result.notComputable.push({ task: row.task, reason: 'файл тени не читается: ' + row.error });
      continue;
    }
    if (row.acceptanceStatus === null || row.acceptanceStatus === undefined) {
      result.notComputable.push({ task: row.task, reason: row.problem || 'тень не совпадает ни с вердиктом движка, ни с приёмкой' });
      continue;
    }
    result.checked += 1;
    if (row.agree === true) { result.agree.push(row); continue; }
    const evidence = evidenceConflicts(workspace, row.task);
    const entry = entries.find((item) => item.task === row.task && deviationCovers(item, evidence.conflicts));
    if (entry) result.waived.push({ row, entry, evidence });
    else result.diverged.push({ row, evidence });
  }
  return result;
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

/**
 * 0161: объяснить расхождение тени данными, а не названием задачи.
 *
 * Читает docs/facts/<task>.jsonl и ищет гейты, по которым лежат доказательства
 * с разными exit — именно это правило 0143/0144 называет конфликтом. Возвращает
 * готовые строки для печати; политику не меняет и ничего не решает.
 * @param {string} workspace корень воркспейса
 * @param {{task: string, agree?: boolean, error?: string}} row строка сводки
 * @returns {string[]}
 */
export function explainShadowRow(workspace, row) {
  const task = String((row && row.task) || '');
  const factsRel = 'docs/facts/' + task + '.jsonl';
  const factsFile = path.join(String(workspace), 'docs', 'facts', task + '.jsonl');
  if (!fs.existsSync(factsFile)) {
    return [task + ': файл фактов не найден (' + factsRel + ') — причина расхождения не выводится'];
  }
  const evidence = [];
  for (const line of fs.readFileSync(factsFile, 'utf8').split(/\r?\n/u)) {
    const text = line.trim();
    if (text === '') continue;
    let fact;
    try { fact = JSON.parse(text); } catch { continue; }
    if (!fact || fact.kind !== 'evidence') continue;
    evidence.push(fact);
  }
  if (evidence.length === 0) {
    return [task + ': в ' + factsRel + ' нет строк evidence — причина расхождения не выводится'];
  }
  const byGate = new Map();
  for (const item of evidence) {
    const gate = String(item.gate || '');
    if (gate === '') continue;
    if (!byGate.has(gate)) byGate.set(gate, []);
    byGate.get(gate).push(item);
  }
  const lines = [];
  for (const [gate, rows] of byGate) {
    const exits = [...new Set(rows.map((item) => Number(item.exit)))]
      .filter((value) => !Number.isNaN(value)).sort((a, b) => a - b);
    if (exits.length < 2) continue;
    const heads = [...new Set(rows.map((item) => String(item.head || '')).filter((value) => value !== ''))]
      .map((value) => value.slice(0, 12));
    lines.push(task + ': конфликт гейта ' + gate + ' — доказательства с exit ' + exits.join(' и ')
      + (heads.length > 0 ? ' на head ' + heads.join(', ') : '')
      + '; строки в ' + factsRel);
  }
  if (lines.length === 0) {
    return [task + ': в ' + factsRel + ' нет конфликтующих доказательств — расхождение по другой причине'];
  }
  return lines;
}

if (isMainModule(import.meta.url)) {
  const argv = process.argv.slice(2);
  const value = (flag) => { const index = argv.indexOf(flag); return index >= 0 ? argv[index + 1] : undefined; };
  const workspace = value('--workspace') || process.cwd();
  /* 0161: по флагу объясняем расхождение данными, а не названием задачи. */
  const explain = argv.includes('--explain');
  const collected = collectShadow(workspace);
  if (!collected.ok) {
    for (const problem of collected.problems) console.log('SHADOW PROBLEM ' + problem);
    process.exitCode = 2;
  } else {
    const result = reconcile(workspace, collected.rows);
    const waived = new Map(result.waived.map((item) => [item.row.task, item]));
    const diverged = new Map(result.diverged.map((item) => [item.row.task, item]));
    const unavailable = new Map(result.notComputable.map((item) => [item.task, item]));
    for (const row of collected.rows) {
      if (unavailable.has(row.task)) {
        console.log('N/A  ' + row.task + ' — тень не вычислима: ' + unavailable.get(row.task).reason);
        continue;
      }
      if (waived.has(row.task)) {
        const item = waived.get(row.task);
        console.log('WAIV ' + row.task + ' — принято с отклонением (' + DEVIATIONS_REL + '): ' + item.entry.reason);
        continue;
      }
      const mark = row.agree ? 'OK  ' : 'DIFF';
      console.log(mark + ' ' + row.task + ' — движок ' + row.engineVerdict + ', приёмка ' + (row.acceptanceStatus || '?') + (row.failed && row.failed.length ? ' [' + row.failed.join(',') + ']' : ''));
      if (explain === true && row.agree !== true && diverged.has(row.task)) {
        for (const line of explainShadowRow(workspace, row)) console.log('  объяснение ' + line);
      }
    }
    const byConstraint = [];
    for (const item of result.diverged) for (const id of item.row.failed || []) {
      const found = byConstraint.find((pair) => pair[0] === id);
      if (found) found[1] += 1; else byConstraint.push([id, 1]);
    }
    byConstraint.sort((a, b) => b[1] - a[1]);
    console.log('итог: проверено ' + result.checked + ', совпало ' + result.agree.length
      + ', отклонений ' + result.waived.length + ', расхождений ' + result.diverged.length
      + ', не вычислима ' + result.notComputable.length);
    if (byConstraint.length > 0) console.log('по ограничениям: ' + byConstraint.map(([id, count]) => id + '×' + count).join(', '));
    if (result.problems.length > 0) {
      for (const problem of result.problems) console.log('SHADOW PROBLEM ' + problem);
      process.exitCode = 2;
    } else {
      process.exitCode = result.diverged.length === 0 ? 0 : 1;
    }
  }
}