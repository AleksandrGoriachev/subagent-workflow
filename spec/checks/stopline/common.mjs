/**
 * Общий каркас внешних чеков стоп-линии (T1–T3).
 * Чеки живут в НАШЕМ репозитории и только читают чужой проект.
 */
import fs from 'node:fs';
import path from 'node:path';

export function read(root, rel) {
  const file = path.join(String(root), rel);
  try { return fs.readFileSync(file, 'utf8'); } catch { return null; }
}

export function exists(root, rel) {
  return fs.existsSync(path.join(String(root), rel));
}

export function report(id, checks) {
  const failed = checks.filter((item) => item.ok !== true);
  for (const item of checks) console.log((item.ok ? 'PASS ' : 'FAIL ') + id + ': ' + item.name + (item.ok ? '' : ' — ' + item.detail));
  const ok = failed.length === 0;
  console.log(id + ': ' + (ok ? 'OK' : 'FAILED (' + failed.length + ')'));
  return ok ? 0 : 1;
}