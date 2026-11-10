/**
 * 0136 (P0): схема фактов для исполнителя ограничений.
 * Спецификация: docs/DATA-MODEL-SPEC-v0.2.md.
 *
 * Принципы: факт неизменяем; цепь хешей (prev = sha256 предыдущей строки);
 * один файл на задачу; писатель — владелец задачи. Чтение — чистая функция.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

/** Виды фактов из §2 спецификации. */
export const FACT_KINDS = ['genesis', 'task', 'contract', 'run', 'diff', 'evidence', 'judgment', 'accept', 'release', 'ruleset', 'action'];

/** Обязательные поля по видам. Отсутствие поля — запись не строится (принцип 5). */
export const REQUIRED_FIELDS = {
  genesis: ['task', 'contract_hash', 'at', 'writer'],
  task: ['id', 'contract_hash', 'risk', 'writer', 'at'],
  contract: ['task', 'hash', 'criteria', 'writer', 'at'],
  run: ['id', 'task', 'commit', 'ruleset_hash', 'command', 'writer'],
  diff: ['task', 'run', 'commit', 'paths', 'diff_hash', 'writer'],
  evidence: ['task', 'run', 'kind', 'gate', 'artifact_hash', 'exit', 'writer'],
  judgment: ['task', 'run', 'artifact_hash', 'by', 'role', 'model', 'verdict', 'writer'],
  accept: ['task', 'run', 'contract_hash', 'diff_hash', 'ruleset_hash', 'evidence_manifest_hash', 'by', 'at'],
  release: ['version', 'tag', 'asset', 'size', 'smoke_hash', 'receipt_hash'],
  ruleset: ['version', 'anchors_hash', 'presets_hash', 'seal', 'policy', 'signature'],
  action: ['task', 'run', 'cmd', 'paths', 'writer', 'at'],
};

/** Нормализация пути (C3): NTFS без учёта регистра, слеши прямые, ./ и ведущий / снят. */
export function normalizePath(value) {
  return String(value || '').replace(/\\/gu, '/').replace(/^\.\//u, '').replace(/^\/+/u, '').toLowerCase();
}

export function sha256Text(text) {
  return crypto.createHash('sha256').update(String(text), 'utf8').digest('hex');
}

export function lineHash(line) {
  return sha256Text(typeof line === 'string' ? line : JSON.stringify(line));
}

/** Проверить одну запись: вид известен и обязательные поля на месте. */
export function validateFact(row) {
  if (!row || typeof row !== 'object' || Array.isArray(row)) return { ok: false, problem: 'запись не объект' };
  if (!FACT_KINDS.includes(row.kind)) return { ok: false, problem: 'неизвестный kind: ' + String(row.kind || '') };
  const missing = REQUIRED_FIELDS[row.kind].filter((field) => row[field] === undefined || row[field] === null || row[field] === '');
  if (missing.length > 0) return { ok: false, problem: row.kind + ': нет полей ' + missing.join(', ') };
  return { ok: true, problem: null };
}

/**
 * Проверить цепь файла фактов (C7): генезис в корне, у каждой строки prev = хеш
 * предыдущей СТРОКИ. Это гарантия порядка, а не правдивости (правдивость — доверенный
 * источник, см. принцип 5 спецификации).
 */
export function verifyFactChain(lines) {
  const problems = [];
  if (lines.length === 0) return { ok: false, problems: ['файл пуст: нет генезиса'] };
  if (lines[0].kind !== 'genesis') problems.push('первая запись не genesis: ' + String(lines[0].kind || '?'));
  for (let index = 1; index < lines.length; index += 1) {
    const expected = lineHash(lines[index - 1].line);
    if (lines[index].prev !== expected) {
      problems.push('строка ' + (index + 1) + ': prev не сходится (' + String(lines[index].prev).slice(0, 12) + '… != ' + expected.slice(0, 12) + '…)');
    }
  }
  return { ok: problems.length === 0, problems };
}

/** Прочитать файл фактов задачи: строки + проверка формы и цепи. */
export function readFactFile(file) {
  if (!fs.existsSync(file)) return { ok: false, rows: [], problems: ['нет файла фактов: ' + file] };
  const problems = [];
  const rows = [];
  const rawLines = fs.readFileSync(file, 'utf8').split('\n').filter((line) => line.trim() !== '');
  for (const line of rawLines) {
    let parsed;
    try { parsed = JSON.parse(line); } catch { problems.push('строка не JSON: ' + line.slice(0, 80)); continue; }
    const form = validateFact(parsed);
    if (!form.ok) problems.push(form.problem);
    rows.push({ ...parsed, line });
  }
  const chain = verifyFactChain(rows);
  return { ok: problems.length === 0 && chain.ok, rows, problems: problems.concat(chain.problems) };
}

/** Мини-глоб для запрещённых путей: * — в пределах сегмента, ** — любые символы. */
function globToRegExp(pattern) {
  let re = '';
  for (let index = 0; index < pattern.length; index += 1) {
    const c = pattern[index];
    if (c === '*') {
      if (pattern[index + 1] === '*') { re += '[\\s\\S]*'; index += 1; }
      else re += '[^/]*';
    } else if (c === '?') {
      re += '[^/]';
    } else {
      re += c.replace(/[.+^${}()|[\]\\]/gu, '\\$&');
    }
  }
  return new RegExp('^' + re + '$');
}

/**
 * C3: попадает ли путь под запрещённый шаблон? Оба нормализуются (регистр, слеши),
 * чтобы NTFS без учёта регистра и прямые/обратные слеши не обходили правило.
 */
export function pathMatches(file, patterns) {
  const normalized = normalizePath(file);
  return (Array.isArray(patterns) ? patterns : []).some((pattern) => globToRegExp(normalizePath(pattern)).test(normalized));
}

/** Синоним для читаемости в ограничении C3. */
export function pathForbidden(file, patterns) {
  return pathMatches(file, patterns);
}

/** Файл фактов задачи: docs/subagent-workflow/facts/<task>.jsonl (короткие имена, Windows 260). */
export function factFileOf(workspace, taskId) {
  return path.join(String(workspace), 'docs', 'subagent-workflow', 'facts', String(taskId).replace(/[^0-9a-zA-Z._-]+/gu, '_') + '.jsonl');
}

/** Дописать факт в цепь (единственный писатель файла — владелец задачи). */
export function appendFact(file, row) {
  const form = validateFact(row);
  if (!form.ok) throw new Error('факт не проходит схему: ' + form.problem);
  const existing = fs.existsSync(file) ? fs.readFileSync(file, 'utf8').split('\n').filter((line) => line.trim() !== '') : [];
  if (existing.length === 0 && row.kind !== 'genesis') throw new Error('первая запись обязана быть genesis');
  const prev = existing.length === 0 ? null : lineHash(existing[existing.length - 1]);
  const line = JSON.stringify(prev === null ? row : { ...row, prev });
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, line + '\n');
  return line;
}