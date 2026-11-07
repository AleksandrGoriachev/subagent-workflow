/**
 * Пачка приёмки (WC-19, 0091): разбор списка заданий и план церемонии.
 *
 * Церемония дорога не проверками (критерии ~1 с каждый), а числом отдельных
 * шагов и ходов вокруг них. Пачка даёт одну команду на 2–3 задания: preflight
 * один раз, дальше — по одному task-accept на задание (подпись и запись
 * остаются персональными), сводка в конце.
 */
import fs from 'node:fs';
import path from 'node:path';

/** Список id из строки "0110,0111 0112" (запятые и пробелы). */
export function parseTaskList(value) {
  const raw = Array.isArray(value) ? value.join(',') : String(value === null || value === undefined ? '' : value);
  const ids = [];
  for (const piece of raw.split(/[,\s]+/u)) {
    const id = piece.trim();
    if (id === '') continue;
    if (!/^\d{4}$/u.test(id)) throw new Error('id задания — четыре цифры, получено: ' + id);
    if (!ids.includes(id)) ids.push(id);
  }
  if (ids.length === 0) throw new Error('список заданий пуст: --tasks 0110,0111');
  if (ids.length > 3) throw new Error('пачка — 2–3 задания, получено ' + ids.length + ': больше не экономит церемонию, а прячет ошибку');
  return ids;
}

/**
 * План: какие каталоги существуют и в каком порядке принимать.
 * @returns {{tasks: {id: string, dir: string, exists: boolean}[], missing: string[]}}
 */
export function batchPlan({ root, tasksDir = 'docs/tasks', ids }) {
  const base = path.join(path.resolve(String(root)), String(tasksDir));
  const tasks = ids.map((id) => {
    const dir = path.join(base, id);
    return { id, dir, exists: fs.existsSync(dir) };
  });
  return { tasks, missing: tasks.filter((item) => !item.exists).map((item) => item.id) };
}

/** Аргументы, которые надо передать каждому task-accept (без пачечных). */
export function forwardedArgs(argv) {
  const out = [];
  for (let index = 0; index < argv.length; index += 1) {
    const token = String(argv[index]);
    if (token === '--tasks' || token === '--parallel') {
      index += 1;
      continue;
    }
    if (token.startsWith('--tasks=') || token.startsWith('--parallel=')) continue;
    out.push(token);
  }
  return out;
}
