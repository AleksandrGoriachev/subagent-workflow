/*
 * Версия инструмента и константы: TOOL, TASK_ARTIFACTS, путь к VERSION.
 *
 * 0181: часть spec/scripts/lib/common.mjs; публичный вход — common.mjs.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
/*
 * 0116 (2.6.101): версия инструмента берётся из VERSION, а не литералом.
 * Литерал заставлял bump версии править common.mjs, который импортируют почти
 * все тесты, и релизная проверка раздувалась до почти полного набора.
 * Кандидаты: репозиторий (spec/scripts/lib → ../../../VERSION) и развёрнутая
 * копия (docs/subagent-workflow/scripts/lib → ../../VERSION).
 */
export const HERE = path.dirname(fileURLToPath(import.meta.url));

export function engineVersion() {
  /* 0181: модуль живёт на уровень глубже (lib/common), поэтому кандидаты на
   * один уровень выше: пакет — ../../../../VERSION, развёрнутая копия —
   * ../../../VERSION (docs/subagent-workflow/VERSION). */
  const candidates = [path.resolve(HERE, '../../../../VERSION'), path.resolve(HERE, '../../../VERSION')];
  for (const candidate of candidates) {
    try {
      const version = fs.readFileSync(candidate, 'utf8').trim();
      if (/^\d+\.\d+\.\d+$/u.test(version)) return version;
    } catch {
      /* кандидата нет — пробуем следующий */
    }
  }
  return '';
}

export const TOOL = 'subagent-workflow/' + (engineVersion() || '0.0.0');
export const TASK_ARTIFACTS = new Set([
  'task.md', 'criteria.json', 'criteria.lock', 'red.json', 'red.log',
  'verify.json', 'verify.executor.json', 'verify.log', 'acceptance.json', 'report.md', 'report.json',
]);

