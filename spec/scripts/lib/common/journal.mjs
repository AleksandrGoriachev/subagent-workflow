/*
 * Журнал ворот: gates.jsonl, цепь, строки вердиктов.
 *
 * 0181: часть spec/scripts/lib/common.mjs; публичный вход — common.mjs.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { exists, sha256 } from './fsio.mjs';
export const GATE_JOURNAL = 'gates.jsonl';

export function gateJournalFile(taskDir) {
  return path.join(taskDir, GATE_JOURNAL);
}

/* Смещение журнала: +03:00, как в red.json/verify.json этого пакета. */
export const GATE_OFFSET_MINUTES = 180;

export function padGateTime(value, width = 2) {
  return String(value).padStart(width, '0');
}

export function formatGateTime(date) {
  const shifted = new Date(date.getTime() + GATE_OFFSET_MINUTES * 60000);
  return shifted.getUTCFullYear() + '-' + padGateTime(shifted.getUTCMonth() + 1) + '-' + padGateTime(shifted.getUTCDate())
    + 'T' + padGateTime(shifted.getUTCHours()) + ':' + padGateTime(shifted.getUTCMinutes()) + ':' + padGateTime(shifted.getUTCSeconds())
    + '.' + padGateTime(shifted.getUTCMilliseconds(), 3) + '+03:00';
}

/**
 * Время записи журнала. Строка с явным смещением (Z или ±hh:mm) сохраняется
 * дословно: её мог передать вызывающий, и переписывать чужие часы не наше дело.
 * Всё остальное (Date, число, строка без смещения, мусор) приводится к ISO со
 * смещением +03:00; отсутствие времени — «сейчас».
 */
export function gateAt(value) {
  const text = typeof value === 'string' ? value.trim() : '';
  if (text !== '' && /(?:Z|[+-]\d{2}:\d{2})$/u.test(text) && !Number.isNaN(Date.parse(text))) return text;
  if (text !== '') {
    const parsed = Date.parse(text);
    return Number.isNaN(parsed) ? text : formatGateTime(new Date(parsed));
  }
  if (value instanceof Date && !Number.isNaN(value.getTime())) return formatGateTime(value);
  if (typeof value === 'number' && Number.isFinite(value)) return formatGateTime(new Date(value));
  return formatGateTime(new Date());
}

export function gateNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/**
 * Один критерий в записи: id, exitCode, durationMs, passed и причины отказа.
 * Причины — то, что нельзя восстановить по git log; пустой список не пишется,
 * чтобы успешный критерий не выглядел как «причина была, но потерялась».
 */
export function normalizeGateCriterion(criterion) {
  const source = criterion && typeof criterion === 'object' && !Array.isArray(criterion) ? criterion : {};
  const out = {
    id: source.id === undefined || source.id === null ? '' : String(source.id),
    exitCode: gateNumber(source.exitCode),
    durationMs: gateNumber(source.durationMs),
    passed: source.passed === true,
  };
  const reasons = Array.isArray(source.reasons)
    ? source.reasons.map((reason) => String(reason)).filter((reason) => reason !== '')
    : [];
  if (reasons.length > 0) out.reasons = reasons;
  return out;
}

/** Строки результатов ворот ({ id, exitCode, durationMs, passed, reasons }) → критерии записи. */
export function gateCriteriaOf(results) {
  return (Array.isArray(results) ? results : []).map((result) => normalizeGateCriterion(result));
}

/**
 * Нормализованная запись журнала вердиктов:
 * { at, kind, task, head, criteria, verdict, bypasses?, exitSummary? }.
 * Функция чистая: ничего не читает и не пишет, поэтому ею же пользуется проверка.
 */
export function gateRecord(record) {
  const source = record && typeof record === 'object' && !Array.isArray(record) ? record : {};
  const entry = {
    at: gateAt(source.at),
    kind: source.kind === undefined || source.kind === null ? '' : String(source.kind),
    task: source.task === undefined || source.task === null ? '' : String(source.task),
    head: source.head === undefined || source.head === null ? null : String(source.head),
    criteria: Array.isArray(source.criteria) ? source.criteria.map((item) => normalizeGateCriterion(item)) : [],
    verdict: source.verdict === undefined || source.verdict === null ? null : String(source.verdict),
  };
  if (source.bypasses && typeof source.bypasses === 'object' && !Array.isArray(source.bypasses)) entry.bypasses = source.bypasses;
  if (source.exitSummary !== undefined && source.exitSummary !== null) entry.exitSummary = source.exitSummary;
  return entry;
}

/** sha256 строки; для пустого/отсутствующего журнала — нули. */
export function sha256Text(text) {
  return crypto.createHash('sha256').update(String(text), 'utf8').digest('hex');
}

/** Хвост цепочки: хеш последней непустой строки журнала или 64 нуля. */
export function chainTip(file) {
  const target = path.resolve(String(file));
  const zeros = '0'.repeat(64);
  try {
    if (!exists(target)) return zeros;
    const text = fs.readFileSync(target, 'utf8');
    const lines = text.split(String.fromCharCode(10)).filter((line) => line.trim() !== '');
    if (lines.length === 0) return zeros;
    return sha256Text(lines[lines.length - 1]);
  } catch {
    return zeros;
  }
}

/** Проверка цепочки журнала: [{ ok, problems }]. */
export function verifyChain(file) {
  const target = path.resolve(String(file));
  const problems = [];
  let raw;
  try {
    raw = exists(target) ? fs.readFileSync(target, 'utf8') : '';
  } catch (error) {
    return { ok: false, problems: ['журнал не читается: ' + String(error && error.message ? error.message : error)] };
  }
  const lines = raw.split(String.fromCharCode(10)).filter((line) => line.trim() !== '');
  const zeros = '0'.repeat(64);
  let start = -1;
  for (let index = 0; index < lines.length; index += 1) {
    try {
      const probe = JSON.parse(lines[index]);
      if (probe && probe.prev !== undefined && probe.prev !== null) { start = index; break; }
    } catch { /* строка вне цепочки */ }
  }
  if (start === -1) return { ok: true, problems: [], lines: lines.length, legacy: true };
  /* Вершина из .tip: ловит правку или обрезку последней строки. */
  try {
    const tipFile = target + '.tip';
    if (exists(tipFile)) {
      const declared = fs.readFileSync(tipFile, 'utf8').trim();
      const actual = sha256Text(lines[lines.length - 1] + String.fromCharCode(10));
      if (declared !== actual) problems.push('вершина цепочки не совпадает: последняя строка журнала изменена или журнал обрезан');
    }
  } catch { /* нет вершины — проверим саму цепочку */ }
  let expected = null;
  for (let index = start; index < lines.length; index += 1) {
    let entry;
    try {
      entry = JSON.parse(lines[index]);
    } catch {
      problems.push('строка ' + (index + 1) + ': не JSON');
      expected = sha256Text(lines[index]);
      continue;
    }
    const prev = entry.prev === undefined || entry.prev === null ? null : String(entry.prev);
    if (index === start) expected = prev;
    if (prev === null) problems.push('строка ' + (index + 1) + ': нет prev — запись вне цепочки');
    else if (prev !== expected) problems.push('строка ' + (index + 1) + ': цепочка разорвана (prev не совпадает)');
    expected = sha256Text(lines[index]);
  }
  return { ok: problems.length === 0, problems, lines: lines.length, legacy: false };
}

/**
 * Append-only запись одной строки JSONL. Каталог и файл создаются при первом
 * прогоне, прежние строки не читаются и не переписываются. Ошибка записи НЕ
 * бросает: возвращается { ok: false, error }, чтобы ворота напечатали WARN и
 * сохранили свой код возврата.
 */
export function appendGateRecord(file, record) {
  try {
    const target = path.resolve(String(file));
    const entry = gateRecord(record);
    /*
     * 0109 (WC-75): журнал ворот — хеш-цепочка. Каждая строка несёт prev —
     * sha256 предыдущей строки, поэтому удаление или правка записи ломает
     * цепочку и обнаруживается проверкой journal-integrity. Без этого строка
     * accept исчезала бесследно (замер 09.11 на 0171–0177 у structure).
     */
    entry.prev = chainTip(target);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    /*
     * Файл, дописанный не нами и оборванный без перевода строки, склеил бы две
     * записи в одну. Добавляем только разделитель — содержимое не трогаем.
     */
    let prefix = '';
    if (exists(target)) {
      const size = fs.statSync(target).size;
      if (size > 0) {
        const fd = fs.openSync(target, 'r');
        try {
          const last = Buffer.alloc(1);
          fs.readSync(fd, last, 0, 1, size - 1);
          if (last[0] !== 0x0a) prefix = String.fromCharCode(10);
        } finally {
          fs.closeSync(fd);
        }
      }
    }
    const line = prefix + JSON.stringify(entry) + String.fromCharCode(10);
    fs.appendFileSync(target, line, 'utf8');
    /*
     * 0109: вершина цепочки пишется рядом с журналом. Без неё последняя строка
     * не защищена: правку вердикта в ней цепочка не замечает (у неё нет
     * последователя). Файл .tip фиксирует хеш последней строки, поэтому правка
     * хвоста или обрезка журнала обнаруживаются.
     */
    try {
      const tipLine = JSON.stringify(entry) + String.fromCharCode(10);
      fs.writeFileSync(target + '.tip', sha256Text(tipLine) + String.fromCharCode(10), 'utf8');
    } catch { /* вершина — удобство проверки, не условие записи */ }
    return { ok: true, file: target, kind: entry.kind, at: entry.at, bytes: Buffer.byteLength(line, 'utf8') };
  } catch (error) {
    return { ok: false, error: error && error.message ? String(error.message) : String(error) };
  }
}


export function gateRowParts(row) {
  const source = row && typeof row === 'object' && !Array.isArray(row) ? row : {};
  const exitCode = Number(source.exitCode);
  const durationMs = Number(source.durationMs);
  return {
    id: source.id === undefined || source.id === null ? '' : String(source.id),
    code: Number.isFinite(exitCode) ? String(exitCode) : '—',
    ms: Number.isFinite(durationMs) ? String(Math.round(durationMs)) : '—',
    passed: source.passed === true,
  };
}

export function formatGateRow(row) {
  const parts = gateRowParts(row);
  return (parts.passed ? 'PASS' : 'FAIL') + '  ' + parts.id + '  exit ' + parts.code + '  ' + parts.ms + ' ms';
}

/* Итог одной строкой: «Итог: C1 exit 0 530 ms; C2 exit 3 1200 ms». */
export function formatGateSummary(rows) {
  const list = Array.isArray(rows) ? rows : [];
  if (list.length === 0) return 'Итог: исполняемых проверок нет';
  return 'Итог: ' + list.map((row) => {
    const parts = gateRowParts(row);
    return parts.id + ' exit ' + parts.code + ' ' + parts.ms + ' ms';
  }).join('; ');
}

export function isManual(criterion) {
  return criterion.manual === true || (Array.isArray(criterion.tags) && criterion.tags.includes('manual'));
}

/*
 * Решения задания (2.1.0). Семантическое решение — это выбор, который нельзя
 * проверить командой: «что считается доставкой», «что видит пользователь».
 * Такое решение обязано либо опираться на исполняемый критерий, либо быть
 * подтверждено человеком; иначе оно записывается как assumed и закрывает выпуск.
 */
