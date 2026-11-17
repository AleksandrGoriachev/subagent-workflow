#!/usr/bin/env node
/**
 * 0181 + 0.2: независимая проверка ящика обмена.
 *
 * Плагин structure доставляет письма сам, но его журнал вручения (exchange-seen.json)
 * может отставать: 11.11 письма 51/52 не были отмечены вовсе, пока сессия была занята.
 * Этот инструмент не полагается на плагин: он сам читает каталог писем и журнал
 * вручений, показывает НЕДОСТАВЛЕННЫЕ письма и может отметить их.
 *
 * 0.2 (по следам хендовера 18.11):
 *   - ЛИЧНАЯ память прочтения хранится ПО КОРНЮ каталога, а не в общем журнале плагина:
 *     <пакет>/.tmp/exchange-seen/<sha256(корень)[:16]>.json (или --memory-dir).
 *     Два каталога обмена больше не делят одну отметку и не затирают друг друга.
 *   - Точечная отметка: --mark <письмо> (можно несколько через пробел или запятую).
 *     Без имён --mark отмечает всё, что сейчас показано, и поднимает watermark.
 *   - Журнал плагина читается как ДОПОЛНИТЕЛЬНЫЙ источник отметок (что уже просмотрено
 *     сканером), но доказательством вручения не считается: он может отставать.
 *
 *   node tools/exchange-inbox.mjs [--dir <каталог>] [--memory-dir <каталог>]
 *                                 [--seen <журнал плагина>] [--mark [<письмо>...]]
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

export const DEFAULT_DIR = 'C:/Users/Goryachev/Documents/deepseek-harness/coordination/threads/exchange';
export const DEFAULT_LEGACY = path.join(os.homedir(), '.dsh', 'project-graph', 'runs', 'exchange-seen.json');
/*
 * Память по умолчанию лежит в развёрнутой копии движка: <пакет>/.tmp/exchange-seen.
 * Почему не ~/.dsh: песочница DSH (workspace-write) запрещает запись в домашний каталог,
 * а состояние чтения принадлежит этой копии инструмента. .tmp исключён из архива
 * (tools/pack.mjs) и из git (.gitignore), поэтому память не уезжает в релиз.
 * Переопределяется ключом --memory-dir или переменной WF_EXCHANGE_MEMORY_DIR.
 */
const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const DEFAULT_MEMORY_DIR = process.env.WF_EXCHANGE_MEMORY_DIR || path.join(PACKAGE_ROOT, '.tmp', 'exchange-seen');

const norm = (value) => path.resolve(String(value)).replace(/\\/gu, '/').toLowerCase();

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

function insideDir(dirNorm, keyNorm) {
  return keyNorm === dirNorm || keyNorm.startsWith(dirNorm + '/');
}

/*
 * Память прочтения — файл на КОРЕНЬ каталога обмена. Имя файла — хеш нормализованного
 * пути, поэтому каталоги с одинаковым basename (exchange у разных сторон) не смешиваются.
 */
export function memoryFile(dir, memoryDir = DEFAULT_MEMORY_DIR) {
  const slug = crypto.createHash('sha256').update(norm(dir)).digest('hex').slice(0, 16);
  return path.join(memoryDir, slug + '.json');
}

export function letterNames(dir) {
  return fs.readdirSync(dir).filter((name) => name.endsWith('.md')).sort();
}

/*
 * Состояние прочтения: своя память + журнал плагина.
 * watermark = последняя отметка (своя или плагина); письмо старше watermark считается
 * историей, а не пропуском. Письмо, отмеченное по имени в любом журнале, считается
 * прочитанным всегда — именно это делает точечную отметку возможной.
 */
export function loadSeen(dir, options = {}) {
  const memoryDir = options.memoryDir || DEFAULT_MEMORY_DIR;
  const legacyFile = options.legacyFile === undefined ? DEFAULT_LEGACY : options.legacyFile;
  const memoryPath = memoryFile(dir, memoryDir);
  const saved = readJson(memoryPath);
  const own = saved && saved.letters && typeof saved.letters === 'object' ? { ...saved.letters } : {};
  const savedWatermark = saved && Number.isFinite(Number(saved.watermark)) ? Number(saved.watermark) : 0;

  const legacy = {};
  let legacyWatermark = 0;
  const journal = legacyFile ? readJson(legacyFile) : null;
  if (journal && typeof journal === 'object') {
    const dirNorm = norm(dir);
    for (const [key, value] of Object.entries(journal)) {
      if (!insideDir(dirNorm, norm(key))) continue;
      const ms = Number(value);
      if (!Number.isFinite(ms)) continue;
      legacy[path.basename(String(key))] = ms;
      if (ms > legacyWatermark) legacyWatermark = ms;
    }
  }

  return {
    memoryPath,
    own,
    legacy,
    seen: { ...legacy, ...own },
    watermark: Math.max(savedWatermark, legacyWatermark),
  };
}

export function unreadLetters(dir, options = {}) {
  const state = loadSeen(dir, options);
  const rows = [];
  for (const name of letterNames(dir)) {
    if (state.seen[name] !== undefined) continue;
    const file = path.join(dir, name);
    const stat = fs.statSync(file);
    if (state.watermark > 0 && stat.mtimeMs <= state.watermark) continue;
    const text = fs.readFileSync(file, 'utf8');
    const header = (field) => {
      const m = new RegExp('^' + field + ':\\s*(.+)$', 'mu').exec(text);
      return m ? m[1].trim() : '';
    };
    rows.push({
      name,
      from: header('From'),
      to: header('To'),
      status: header('Status'),
      subject: header('Subject'),
      mtime: stat.mtime,
      mtimeMs: stat.mtimeMs,
    });
  }
  return rows.sort((a, b) => a.mtimeMs - b.mtimeMs);
}

/*
 * Отметить письма прочитанными. Имена — basename из каталога обмена.
 * --mark без имён (пакетная отметка) дополнительно поднимает watermark: всё, что было
 * в каталоге на момент отметки, считается историей, и файл памяти не растёт списком.
 */
export function markLetters(dir, names, options = {}) {
  const state = loadSeen(dir, options);
  const existing = new Set(letterNames(dir));
  const result = { marked: [], already: [], missing: [], memoryPath: state.memoryPath };
  for (const raw of names) {
    const name = String(raw).trim();
    if (!name) continue;
    if (!existing.has(name)) {
      result.missing.push(name);
      continue;
    }
    if (state.seen[name] !== undefined) {
      result.already.push(name);
      continue;
    }
    state.own[name] = Date.now();
    result.marked.push(name);
  }

  let watermark = state.watermark;
  if (options.advanceWatermark && result.marked.length > 0) {
    const newest = Math.max(...letterNames(dir).map((name) => fs.statSync(path.join(dir, name)).mtimeMs));
    watermark = Math.max(watermark, newest);
  }

  if (result.marked.length > 0) {
    fs.mkdirSync(path.dirname(state.memoryPath), { recursive: true });
    const document = {
      version: 2,
      root: path.resolve(dir),
      watermark,
      letters: state.own,
      updatedAt: new Date().toISOString(),
    };
    fs.writeFileSync(state.memoryPath, JSON.stringify(document, null, 1) + '\n');
  }
  return result;
}

function printUsage(log) {
  log([
    'node tools/exchange-inbox.mjs [--dir <каталог>] [--memory-dir <каталог>]',
    '                              [--seen <журнал плагина>] [--mark [<письмо>...]]',
    '',
    'Без ключей читает каталог обмена по умолчанию и печатает непрочитанные письма.',
    '  --mark <письмо>  отметить конкретное письмо (можно несколько через пробел или запятую)',
    '  --mark           отметить все показанные письма и поднять watermark',
    '  --memory-dir     куда писать память прочтения (по умолчанию <пакет>/.tmp/exchange-seen)',
    '  --seen           журнал плагина как дополнительный источник отметок',
    '',
    'Коды выхода: 0 — непрочитанных нет; 1 — есть (или не найдены названные письма); 2 — ошибка аргументов.',
  ].join('\n'));
}

/*
 * CLI вынесен в функцию: тест проверяет коды выхода и вывод, не порождая процессов
 * (в песочнице DSH spawn с pipe запрещён, а поведение должно проверяться исполнением).
 */
export function cli(argv, io = {}) {
  const log = io.log || console.log;
  const error = io.error || console.error;
  if (argv.includes('--help') || argv.includes('-h')) {
    printUsage(log);
    return 0;
  }

  const options = {};
  let dir = DEFAULT_DIR;
  let mark = null;

  try {
    for (let index = 0; index < argv.length; index += 1) {
      const arg = argv[index];
      if (arg === '--dir') {
        dir = argv[++index];
        if (!dir) throw new Error('--dir требует значение');
      } else if (arg === '--memory-dir') {
        options.memoryDir = argv[++index];
        if (!options.memoryDir) throw new Error('--memory-dir требует значение');
      } else if (arg === '--seen') {
        options.legacyFile = argv[++index];
        if (!options.legacyFile) throw new Error('--seen требует значение');
      } else if (arg === '--mark') {
        mark = [];
        while (index + 1 < argv.length && !argv[index + 1].startsWith('--')) {
          for (const part of argv[++index].split(',')) {
            const name = part.trim();
            if (name) mark.push(name);
          }
        }
      } else {
        throw new Error('неизвестный аргумент: ' + arg);
      }
    }
    if (!fs.existsSync(dir)) throw new Error('каталог обмена не найден: ' + dir);
  } catch (problem) {
    error('exchange-inbox: ' + (problem && problem.message ? problem.message : problem));
    printUsage(error);
    return 2;
  }

  const letters = unreadLetters(dir, options);
  log('ящик: ' + path.resolve(dir));
  log('память: ' + memoryFile(dir, options.memoryDir || DEFAULT_MEMORY_DIR));
  if (letters.length === 0) {
    log('непрочитанных писем нет');
  } else {
    log('непрочитанных писем: ' + letters.length);
    for (const letter of letters) {
      log('- ' + letter.mtime.toISOString().slice(11, 16) + ' | ' + letter.from + ' → ' + letter.to + ' | ' + letter.status + ' | ' + letter.subject.slice(0, 80));
      log('  ' + letter.name);
    }
  }

  let failed = false;
  if (mark !== null) {
    const names = mark.length > 0 ? mark : letters.map((letter) => letter.name);
    const batch = mark.length === 0;
    const result = markLetters(dir, names, { ...options, advanceWatermark: batch });
    if (result.marked.length > 0) log('отмечено: ' + result.marked.length + ' (' + result.marked.join(', ') + ')');
    if (result.already.length > 0) log('уже отмечено: ' + result.already.length);
    if (result.missing.length > 0) {
      log('не найдено в каталоге: ' + result.missing.join(', '));
      failed = true;
    }
    const rest = unreadLetters(dir, options);
    log('осталось непрочитанных: ' + rest.length);
    if (rest.length > 0) failed = true;
  } else if (letters.length > 0) {
    failed = true;
  }

  return failed ? 1 : 0;
}

const isMain = process.argv[1] && process.argv[1].endsWith('exchange-inbox.mjs');
if (isMain) process.exit(cli(process.argv.slice(2)));