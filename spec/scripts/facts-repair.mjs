#!/usr/bin/env node
/**
 * 0147: пересборка и починка файлов фактов.
 *
 * Зачем: факты — append-only, но файл может испортиться (обрыв записи, правка
 * «Блокнотом», ручная правка). Молчаливый --force это скрывал. Здесь два режима:
 *   --rebuild  — пересобрать все задачи из docs/tasks (с бэкапом каждого файла);
 *   --repair   — отрезать битый хвост в <file>.quarantine-<ts> и сказать, что осталось.
 * Отрезается только ХВОСТ: если битая строка в середине — это подделка, а не сбой,
 * и такой файл не «чинится», а требует разбора.
 */
import fs from 'node:fs';
import path from 'node:path';
import { convertToWorkspace } from './facts-convert.mjs';
import { factFileOf, lineHash } from '../lib/facts.mjs';
import { isMainModule } from './lib/common.mjs';

/** Отрезать битый хвост: неразбираемые строки и разрыв цепи в конце файла. */
export function repairFactsFile(file) {
  if (!fs.existsSync(file)) return { ok: false, problems: ['нет файла: ' + file] };
  const raw = fs.readFileSync(file, 'utf8').replace(/^\uFEFF/u, '').split('\n');
  const kept = [];
  const quarantined = [];
  let brokenInMiddle = false;
  for (let index = 0; index < raw.length; index += 1) {
    const line = raw[index];
    if (line.trim() === '') continue;
    let row = null;
    try { row = JSON.parse(line); } catch { row = null; }
    if (row === null) {
      /* Не JSON: допустимо только как хвост. */
      const rest = raw.slice(index + 1).some((item) => item.trim() !== '');
      if (rest) { brokenInMiddle = true; break; }
      quarantined.push(line);
      continue;
    }
    expected: {
      if (kept.length === 0 && row.kind !== 'genesis') { brokenInMiddle = true; break; }
      if (kept.length > 0) {
        const prevHash = lineHash(kept[kept.length - 1]);
        if (row.prev !== prevHash) {
          const rest = raw.slice(index + 1).some((item) => item.trim() !== '');
          if (rest) { brokenInMiddle = true; break; }
          quarantined.push(line);
          continue;
        }
      }
      kept.push(line);
    }
  }
  if (brokenInMiddle) return { ok: false, problems: ['разрыв в середине файла — это не сбой записи, нужен разбор: ' + file] };
  if (quarantined.length === 0) return { ok: true, quarantined: 0, problems: [] };
  const stamp = new Date().toISOString().replace(/[:.]/gu, '-');
  const quarantineFile = file + '.quarantine-' + stamp;
  fs.writeFileSync(quarantineFile, quarantined.join('\n') + '\n');
  fs.writeFileSync(file, kept.join('\n') + (kept.length > 0 ? '\n' : ''));
  return { ok: true, quarantined: quarantined.length, quarantineFile, problems: [] };
}

/** Пересобрать факты всех задач каталога docs/tasks. */
export function rebuildAll(workspace, options = {}) {
  const tasksDir = path.join(String(workspace), 'docs', 'tasks');
  if (!fs.existsSync(tasksDir)) return { ok: false, problems: ['нет каталога задач: ' + tasksDir] };
  const tasks = fs.readdirSync(tasksDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && /^[0-9]{4}$/u.test(entry.name))
    .map((entry) => entry.name)
    .sort();
  const results = [];
  for (const task of tasks) {
    const result = convertToWorkspace(path.join(tasksDir, task), workspace, { ...options, force: true });
    results.push({ task, ok: result.ok, rows: result.rows, problems: result.problems });
  }
  const failed = results.filter((item) => !item.ok);
  return { ok: failed.length === 0, results, failed };
}

if (isMainModule(import.meta.url)) {
  const argv = process.argv.slice(2);
  const value = (flag) => { const index = argv.indexOf(flag); return index >= 0 ? argv[index + 1] : undefined; };
  const workspace = value('--workspace') || process.cwd();
  if (argv.includes('--rebuild')) {
    const result = rebuildAll(workspace, { repoRoot: value('--repo') || workspace });
    for (const item of result.results) console.log((item.ok ? 'OK ' : 'FAIL ') + item.task + ' (' + (item.rows || 0) + ' фактов)');
    process.exitCode = result.ok ? 0 : 1;
  } else if (argv.includes('--repair')) {
    const task = value('--task');
    if (!task) { console.log('нужен --task <id>'); process.exitCode = 2; }
    else {
      const result = repairFactsFile(factFileOf(workspace, task));
      for (const problem of result.problems) console.log('REPAIR PROBLEM ' + problem);
      if (result.ok) console.log('repair: ' + task + ' — отрезано ' + result.quarantined + ', карантин: ' + (result.quarantineFile || 'нет'));
      else process.exitCode = 1;
    }
  } else {
    console.log('Usage: node facts-repair.mjs --workspace <dir> --rebuild | --repair --task <id>');
    process.exitCode = 2;
  }
}