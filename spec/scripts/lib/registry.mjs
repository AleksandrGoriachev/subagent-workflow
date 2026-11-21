/**
 * 0092 / 2.6.90: реестр задач (docs/tasks/REGISTRY.json) — upstream-поведение
 * по спеке structure (их локальный гейт 0317/0318).
 *
 * Смысл: номер задачи и её предмет фиксируются заранее, чтобы приёмка не
 * открывала «нулевые» задания и не подменяла предмет работы. Формат:
 * { version: 1, tasks: [{ id, subject, status, at }] }.
 * Нет файла — поведение прежнее: фикстуры без реестра не краснеют.
 */
import fs from 'node:fs';
import path from 'node:path';

export const REGISTRY_REL = path.join('docs', 'tasks', 'REGISTRY.json');

export function registryPathOf(repo, override) {
  return override ? path.resolve(String(override)) : path.join(path.resolve(String(repo || '.')), REGISTRY_REL);
}

export function checkRegistry({ repo, id, title, registryPath }) {
  const file = registryPathOf(repo, registryPath);
  if (!fs.existsSync(file)) return { applicable: false, ok: true, problems: [], file };
  let doc;
  try {
    doc = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    return { applicable: true, ok: false, problems: ['REGISTRY.json не читается: ' + (error && error.message ? error.message : error)], file };
  }
  const tasks = doc && Array.isArray(doc.tasks) ? doc.tasks : [];
  const entry = tasks.find((item) => String(item && item.id) === String(id));
  if (!entry) {
    return { applicable: true, ok: false, problems: ['номер ' + id + ' не зарегистрирован в REGISTRY.json'], file };
  }
  const subject = String(entry.subject || '').trim();
  const expected = String(title || '').trim();
  if (subject !== expected) {
    return {
      applicable: true,
      ok: false,
      problems: ['REGISTRY.json: subject "' + subject + '" не совпадает с TASK-META.title "' + expected + '"'],
      file,
      entry,
    };
  }
  return { applicable: true, ok: true, problems: [], file, entry };
}
