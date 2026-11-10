#!/usr/bin/env node
/**
 * 0115 (W5): вход в чужой воркспейс — только по разрешению заказчика.
 *
 * Зачем машинная проверка: правило «не лезть в другой воркспейс» звучит как
 * договорённость, а нарушалось оно чтением файлов и запуском чужих проверок.
 * Журнал сессии хранит каждый вызов инструмента, поэтому доступ видно задним
 * числом — и видно, было ли разрешение.
 *
 * Что проверяется: вызовы инструментов прямого доступа (pwsh, read, write, edit,
 * glob, grep), в аргументах которых есть путь за пределами текущего воркспейса.
 * Разрешением считается файл coordination/permits/<slug>.md с датой проверяемого
 * дня или словом «постоянно».
 *
 * Ограничение честно: run_code исполняет произвольный код, и путь может быть
 * собран внутри программы. Такие обращения проверка не ловит — для них остаётся
 * требование записывать прогон в permit явно.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';

export const DIRECT_TOOLS = new Set(['pwsh', 'read', 'write', 'edit', 'glob', 'grep']);
/* run_code исполняет вызовы инструментов внутри программы: путь виден только текстом. */
export const CODE_TOOLS = new Set(['run_code']);
const MAGIC = Buffer.from([0x28, 0xb5, 0x2f, 0xfd]);

/** Ключ каталога сессий DSH для воркспейса. */
export function sessionKey(root) {
  /* DSH: 'C:\\Users\\x' -> '--C-Users-x--' (двоеточие убирается, разделители — дефисы). */
  return '--' + String(root).replace(/^([A-Za-z]):/u, '$1').replace(/[\\/]/gu, '-') + '--';
}

/** Чтение журнала: кадры zstd склеены в один файл. */
export function decodeJournal(file) {
  const buf = fs.readFileSync(file);
  const offsets = [];
  for (let i = 0; i + 4 <= buf.length; i += 1) {
    if (buf[i] === MAGIC[0] && buf[i + 1] === MAGIC[1] && buf[i + 2] === MAGIC[2] && buf[i + 3] === MAGIC[3]) offsets.push(i);
  }
  let text = '';
  for (let i = 0; i < offsets.length; i += 1) {
    const start = offsets[i];
    const end = i + 1 < offsets.length ? offsets[i + 1] : buf.length;
    try {
      text += zlib.zstdDecompressSync(buf.subarray(start, end)).toString('utf8');
    } catch { /* обрезанный кадр пропускаем: остальные читаются */ }
  }
  return text.split(String.fromCharCode(10)).filter(Boolean);
}

/** Чужие корни: из docs/foreign-roots.json или переданные явно. */
export function loadForeignRoots(root, options = {}) {
  /*
   * 0132: запуск из каталога движка молча давал SKIP — файл конфигурации ищется
   * в docs воркспейса, а не рядом с репозиторием. Это делало проверку
   * обходимой: достаточно запустить её не из того каталога. Теперь ищем рядом
   * с репозиторием (../docs) до того, как объявить SKIP.
   */
  if (Array.isArray(options.roots)) return options.roots;
  const candidates = [
    path.join(String(root), 'docs', 'foreign-roots.json'),
    path.resolve(String(root), '..', 'docs', 'foreign-roots.json'),
  ];
  const file = candidates.find((candidate) => fs.existsSync(candidate)) || candidates[0];
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/u, ''));
    const list = Array.isArray(parsed) ? parsed : parsed.roots;
    return (Array.isArray(list) ? list : []).map((item) => String(item)).filter(Boolean);
  } catch {
    return [];
  }
}

function slugOf(foreignRoot) {
  return path.basename(String(foreignRoot)).toLowerCase().replace(/[^a-z0-9.-]+/gu, '-');
}

/** Есть ли разрешение на дату: файл содержит день (YYYY-MM-DD) или «постоянно». */
export function hasPermit(workspaceRoot, foreignRoot, day, options = {}) {
  const dir = options.permitsDir || path.join(String(workspaceRoot), 'coordination', 'permits');
  if (!fs.existsSync(dir)) return false;
  const slug = slugOf(foreignRoot);
  for (const name of fs.readdirSync(dir)) {
    if (!name.toLowerCase().includes(slug) || !name.endsWith('.md')) continue;
    const text = fs.readFileSync(path.join(dir, name), 'utf8');
    if (text.includes(day) || /постоянн/iu.test(text)) return true;
  }
  return false;
}

/** Признак реальной файловой операции рядом с путём (для run_code). */
export function looksLikeFileOperation(args, at) {
  const window = args.slice(Math.max(0, at - 240), Math.min(args.length, at + 240));
  return /(file_path|cwd|workdir|readfile|writefile|execsync|spawn|import\(|git -c|cd '|select-string -path|get-childitem -path|get-content|set-content|new-item|remove-item)/u.test(window);
}

/** Нормализация для сравнения путей. */
function normalize(value) {
  /* Аргументы run_code хранят код со своим экранированием: сначала схлопываем \\\\, потом делим. */
  return String(value).split('\\\\').join('\\').replace(/\\/gu, '/').toLowerCase();
}

/**
 * Поиск обращений: возвращает [{ session, seq, tool, root, snippet }].
 * @param {string[]} lines — строки журнала
 */
export function scanLines(lines, foreignRoots, options = {}) {
  const roots = (Array.isArray(foreignRoots) ? foreignRoots : []).map((item) => ({ raw: String(item), norm: normalize(item) })).filter((item) => item.norm.length > 3);
  const found = [];
  for (const line of lines) {
    let entry;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }
    if (!entry || entry.type !== 'tool/call' || !entry.data) continue;
    const tool = String(entry.data.name || '');
    const viaCode = CODE_TOOLS.has(tool);
    if (!DIRECT_TOOLS.has(tool) && !viaCode) continue;
    const args = normalize(entry.data.arguments || '');
    if (args === '') continue;
    for (const root of roots) {
      /*
       * Ложное срабатывание: ключ каталога сессий содержит имя чужого проекта
       * («--C-Users-...-dsh-project-graph--»), но это не обращение к дереву.
       * Поэтому путь считается найденным только если перед ним не дефис и не буква.
       */
      let at = args.indexOf(root.norm);
      let genuine = false;
      while (at >= 0) {
        const before = at > 0 ? args[at - 1] : '';
        if (before === '' || !/[-A-Za-z0-9_]/u.test(before)) { genuine = true; break; }
        at = args.indexOf(root.norm, at + 1);
      }
      if (!genuine) continue;
      /*
       * Для run_code нужен признак настоящей операции с файлами: иначе письмо или
       * сохранённая память, где путь просто упомянут, выглядели бы доступом.
       */
      if (viaCode && !looksLikeFileOperation(args, at)) continue;
      found.push({
        session: options.session || '',
        viaCode,
        seq: entry.seq,
        at: entry.time ? new Date(entry.time).toISOString() : null,
        tool,
        root: root.raw,
        snippet: String(entry.data.arguments || '').slice(0, 160),
      });
    }
  }
  return found;
}

/** Один воркспейс: журналы его сессий + разрешения. */
export function checkWorkspace(root, options = {}) {
  /* 0132: конфиг может лежать рядом с репозиторием (../docs) — тогда и журналы
   * берём из воркспейса-родителя, а не из каталога движка. */
  const startedAt = path.resolve(String(root));
  const parentRoot = path.resolve(startedAt, '..');
  const ownConfig = path.join(startedAt, 'docs', 'foreign-roots.json');
  const parentConfig = path.join(parentRoot, 'docs', 'foreign-roots.json');
  const workspace = !fs.existsSync(ownConfig) && fs.existsSync(parentConfig) ? parentRoot : startedAt;
  const roots = loadForeignRoots(startedAt, options);
  if (roots.length === 0) return { ok: true, skipped: true, reason: 'нет docs/foreign-roots.json — чужие корни не объявлены', hits: [], problems: [] };
  const key = sessionKey(workspace);
  const dir = path.join(options.sessionsDir || path.join(os.homedir(), '.dsh', 'sessions'), key);
  if (!fs.existsSync(dir)) return { ok: true, skipped: true, reason: 'нет журналов для воркспейса', hits: [], problems: [] };
  const sessions = fs.readdirSync(dir)
    .map((name) => ({ name, file: path.join(dir, name, 'session.v4.jsonl.zstd') }))
    .filter((item) => fs.existsSync(item.file))
    .map((item) => ({ ...item, mtime: fs.statSync(item.file).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime)
    .slice(0, Number(options.sessionLimit) > 0 ? Number(options.sessionLimit) : 5);
  const hits = [];
  const since = options.since ? String(options.since) : new Date().toISOString().slice(0, 10);
  for (const session of sessions) {
    const lines = decodeJournal(session.file);
    for (const hit of scanLines(lines, roots, { session: session.name })) {
      /* Гейт смотрит вперёд: старые обращения не блокируют сегодняшнюю работу. */
      if (hit.at && hit.at.slice(0, 10) < since) continue;
      hits.push(hit);
    }
  }
  const problems = [];
  const byRoot = new Map();
  for (const hit of hits) {
    const day = hit.at ? hit.at.slice(0, 10) : new Date().toISOString().slice(0, 10);
    if (hasPermit(workspace, hit.root, day, options)) continue;
    const list = byRoot.get(hit.root) || [];
    list.push(hit);
    byRoot.set(hit.root, list);
  }
  for (const [foreign, list] of byRoot) {
    const direct = list.filter((hit) => hit.viaCode !== true).length;
    const viaCode = list.length - direct;
    problems.push(foreign + ': обращений без разрешения — ' + list.length
      + ' (напрямую ' + direct + ', через run_code ' + viaCode + '; например ' + list[0].tool + ' в сессии ' + list[0].session + ')');
  }
  return { ok: problems.length === 0, hits, problems, sessions: sessions.length, roots };
}

if (process.argv[1] && import.meta.url === new URL('file://' + path.resolve(process.argv[1]).split(path.sep).join('/')).href) {
  const argv = process.argv.slice(2);
  const value = (flag) => { const index = argv.indexOf(flag); return index >= 0 ? argv[index + 1] : undefined; };
  const result = checkWorkspace(value('--root') || process.cwd(), { sessionLimit: value('--limit'), since: value('--since') });
  if (result.skipped) console.log('foreign-workspace: SKIP — ' + result.reason);
  for (const problem of result.problems || []) console.log('FOREIGN ERROR ' + problem);
  if (!result.skipped && result.ok) console.log('foreign-workspace: OK — обращений без разрешения нет (сессий проверено ' + result.sessions + ')');
  if (!result.ok) process.exitCode = 1;
}
