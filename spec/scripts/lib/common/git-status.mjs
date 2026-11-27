/*
 * Состояние дерева: porcelain, stash, чужие правки, дрейф HEAD.
 *
 * 0181: часть spec/scripts/lib/common.mjs; публичный вход — common.mjs.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fail } from './cli.mjs';
import { toPosix, fromPosix, relPosix, exists, readText } from './fsio.mjs';
import { git, headCommit } from './git-base.mjs';
import { matchesAny } from './glob.mjs';
export function decodeGitQuoted(body) {
  /*
   * git status --porcelain цитирует пути C-строками: кавычки, обратные слэши и
   * восьмеричные байты UTF-8 (\321\216 → «ю»). Собираем байты и декодируем
   * один раз: побайтовый String.fromCharCode дал бы mojibake и путь не совпал
   * бы с keep.
   */
  const bytes = [];
  const simple = { a: 7, b: 8, t: 9, n: 10, v: 11, f: 12, r: 13, '"': 34, '\\': 92 };
  for (let i = 0; i < body.length; i += 1) {
    const ch = body[i];
    if (ch !== '\\') {
      for (const byte of Buffer.from(ch, 'utf8')) bytes.push(byte);
      continue;
    }
    const next = body[i + 1];
    if (next === undefined) { bytes.push(92); break; }
    i += 1;
    if (Object.prototype.hasOwnProperty.call(simple, next)) { bytes.push(simple[next]); continue; }
    if (/[0-7]/u.test(next)) {
      let oct = next;
      while (oct.length < 3 && /[0-7]/u.test(body[i + 1] || '')) { i += 1; oct += body[i]; }
      bytes.push(parseInt(oct, 8));
      continue;
    }
    for (const byte of Buffer.from(next, 'utf8')) bytes.push(byte);
  }
  return Buffer.from(bytes).toString('utf8');
}

/** Путь в кавычках начиная с text[start] === '"': значение и позиция после кавычки. */
export function readQuotedPath(text, start) {
  let i = start + 1;
  let body = '';
  while (i < text.length) {
    const ch = text[i];
    if (ch === '\\') { body += ch + (text[i + 1] || ''); i += 2; continue; }
    if (ch === '"') return { value: decodeGitQuoted(body), end: i + 1 };
    body += ch;
    i += 1;
  }
  return { value: decodeGitQuoted(body), end: i };
}

/**
 * 0135 (2.6.109): разбор строк git status --porcelain -uall (v1).
 * Возвращает [{ code, path, index, worktree }], где code — двухбуквенный XY,
 * path — конечный путь (у переименования/копии — новый), index/worktree — буквы
 * X и Y по отдельности. Кавычки git и old -> new разбираются здесь же: снаружи
 * пути уже обычные строки.
 */
export function parsePorcelainStatus(text) {
  const entries = [];
  for (const line of String(text).split(/\r?\n/u)) {
    if (line.length < 4 || line[2] !== ' ') continue;
    const code = line.slice(0, 2);
    const index = code[0];
    const worktree = code[1];
    const rest = line.slice(3);
    let finalPath = rest;
    if (index === 'R' || index === 'C') {
      let after = '';
      if (rest.startsWith('"')) {
        const old = readQuotedPath(rest, 0);
        after = rest.slice(old.end);
        if (after.startsWith(' -> ')) after = after.slice(4);
      } else {
        const arrow = rest.indexOf(' -> ');
        after = arrow === -1 ? rest : rest.slice(arrow + 4);
      }
      finalPath = after.startsWith('"') ? readQuotedPath(after, 0).value : after;
    } else if (rest.startsWith('"')) {
      finalPath = readQuotedPath(rest, 0).value;
    }
    entries.push({ code, path: finalPath, index, worktree });
  }
  return entries;
}

export function pathSet(value) {
  const out = new Set();
  if (value === undefined || value === null) return out;
  for (const item of typeof value === 'string' ? [value] : [...value]) {
    const p = toPosix(String(item));
    if (p !== '') out.add(p);
  }
  return out;
}

/**
 * 0135 (2.6.109): пути отслеживаемых незакоммиченных правок вне набора keep
 * (и вне ignored), которые уничтожит git reset --hard.
 * untracked (??) и удалённые в рабочем дереве ( D) в потери не входят:
 * первых reset --hard не трогает, вторые восстанавливает из HEAD.
 */
export function extrasAtRisk(entries, options = {}) {
  const opts = options && typeof options === 'object' ? options : {};
  const keep = pathSet(opts.keep);
  const ignored = pathSet(opts.ignored);
  const extras = [];
  for (const entry of Array.isArray(entries) ? entries : []) {
    if (!entry || typeof entry !== 'object') continue;
    const code = String(entry.code || '');
    if (code === '??' || code === '!!') continue;
    /*
     * Только чистое удаление в рабочем дереве ( D): reset --hard восстановит
     * файл из HEAD, работы не потеряет. MD/RD несут правку в индексе — их
     * reset --hard выбросит, поэтому они остаются потерей.
     */
    if (code === ' D') continue;
    const p = toPosix(String(entry.path || ''));
    if (p === '' || keep.has(p) || ignored.has(p)) continue;
    extras.push(p);
  }
  return [...new Set(extras)].sort();
}

/** 0135 (2.6.109): снимок git stash list --format=%gd %s; стэши читаются, не меняются. */
export function stashSnapshot(repo) {
  const r = git(repo, ['stash', 'list', '--format=%gd %s']);
  if (r.exitCode !== 0) return [];
  return r.stdout.split(/\r?\n/u).map((line) => line.replace(/[ \t]+$/u, '')).filter((line) => line !== '');
}

/**
 * 0135 (2.6.109): один снимок дерева для записи приёмки:
 * headBefore (HEAD на входе, можно передать), head (HEAD сейчас), trackedChanges
 * (число отслеживаемых незакоммиченных правок), extras (что уничтожит reset --hard)
 * и stashes. Только чтение.
 */
export function worktreeSnapshot(repo, options = {}) {
  const opts = options && typeof options === 'object' ? options : {};
  const headBefore = typeof opts.headBefore === 'string' && opts.headBefore !== '' ? opts.headBefore : headCommit(repo);
  const status = git(repo, ['status', '--porcelain', '-uall']);
  if (status.exitCode !== 0) fail('worktreeSnapshot: git status: ' + status.stderr.trim());
  const entries = parsePorcelainStatus(status.stdout);
  const trackedChanges = entries.filter((entry) => entry.code !== '??' && entry.code !== '!!').length;
  return {
    headBefore,
    head: headCommit(repo),
    trackedChanges,
    extras: extrasAtRisk(entries, { keep: opts.keep, ignored: opts.ignored }),
    stashes: stashSnapshot(repo),
  };
}

/**
 * 0135 (2.6.109): подсказка «Финализация» отдельной строкой называет роль —
 * координатор (архитектор/релиз-инженер), не приёмщик, — и предупреждает рядом с
 * git reset --hard, что он уничтожит незакоммиченные отслеживаемые правки вне
 * кандидата. Случай из INCIDENT-GIT-REBASE-ANSWER: приёмщик прочитал шаги как свои
 * и выполнил reset → cherry-pick → stash.
 */
export function finalizationLines(options = {}) {
  const opts = options && typeof options === 'object' ? options : {};
  const candidate = String(opts.candidate || '');
  const acceptanceRel = String(opts.acceptanceRel || '');
  const gateRel = String(opts.gateRel || '');
  const checkScriptRel = String(opts.checkScriptRel || '');
  const match = /(?:^|\/)tasks\/([^/]+)\//u.exec(acceptanceRel);
  const taskId = String(opts.taskId || (match ? match[1] : ''));
  return [
    'Финализация — выполняет координатор (архитектор/релиз-инженер); приёмщик git не двигает, шаги ниже — не его обязанность.',
    '  git reset --hard ' + candidate + '   # рабочее дерево уже равно кандидату; ВНИМАНИЕ: reset --hard уничтожит незакоммиченные отслеживаемые правки вне кандидата',
    '  git add ' + acceptanceRel + ' ' + gateRel,
    '  git commit -m "task ' + taskId + ': приёмка (metadata)"',
    '  # gates.jsonl несёт строку accept: без git add её выбросит reset --hard',
    'Проверка записи: node ' + checkScriptRel + ' --file ' + acceptanceRel + ' --repo .',
  ];
}

export function dirtyPaths(repo) {
  const set = new Set();
  for (const args of [
    ['diff', '--name-only', '-z'],
    ['diff', '--cached', '--name-only', '-z'],
    ['ls-files', '--others', '--exclude-standard', '-z'],
  ]) {
    const r = git(repo, args);
    if (r.exitCode !== 0) continue;
    for (const p of r.stdout.split('\0')) if (p) set.add(toPosix(p));
  }
  return [...set].sort();
}

/**
 * 0114 (2.6.100): только свои изменения. Исполнитель не коммитит — любой коммит
 * после контракта чужой, поэтому границы проверяются по незакоммиченным путям,
 * а артефакты чужих заданий и рантайм-каталог .dsh не считаются изменениями.
 */
export function ownChanges(paths, taskRel, patterns = []) {
  const own = String(taskRel || '').split('\\').join('/').replace(/\/+$/u, '') + '/';
  const list = [];
  for (const raw of Array.isArray(paths) ? paths : []) {
    const p = toPosix(String(raw));
    if (p === '' || p.startsWith('.dsh/')) continue;
    if (p.startsWith('docs/tasks/')) {
      /*
       * 0145 (2.6.111): чужой каталог задания не свой, ЕСЛИ путь не объявлен в
       * контракте явно. Задача, которой разрешено исправить артефакт другой
       * задачи (allowedPaths), обязана провести его через кандидата; иначе
       * приёмка упирается в accept-foreign-worktree, а артефакт коммитится мимо
       * кандидата. Список объявленных путей приходит снаружи (meta.allowedPaths).
       */
      if (!p.startsWith(own) && !matchesAny(p, Array.isArray(patterns) ? patterns : [])) continue;
    }
    list.push(p);
  }
  return [...new Set(list)].sort();
}

export function diffPaths(repo, base) {
  const set = new Set();
  const r = git(repo, ['diff', '--name-only', '-z', base, '--']);
  if (r.exitCode === 0) for (const p of r.stdout.split('\0')) if (p) set.add(toPosix(p));
  const untracked = git(repo, ['ls-files', '--others', '--exclude-standard', '-z']);
  if (untracked.exitCode === 0) for (const p of untracked.stdout.split('\0')) if (p) set.add(toPosix(p));
  return [...set].sort();
}

/**
 * 0110 (2.6.98): сдвиг HEAD чужими коммитами.
 *
 * Контракт заперт на contractCommit; если после него в репозиторий коммитили
 * другие задачи (релизы, соседние задания), равенство HEAD больше не держим —
 * но только пока контрактные хеши совпали (это проверяет verifyLock) и чужие
 * коммиты не задели пути этого задания. Иначе — отказ с названными путями.
 */
export function headDrift(repo, contractCommit, meta, taskDir) {
  const head = headCommit(repo);
  if (!head) return { drift: false, ok: false, errors: ['в репозитории нет HEAD'] };
  if (!contractCommit) return { drift: false, ok: false, errors: ['нет contractCommit в замке'] };
  if (head === contractCommit) return { drift: false, ok: true, from: contractCommit, to: head, foreignCommits: 0, paths: [] };
  const anc = git(repo, ['merge-base', '--is-ancestor', contractCommit, head]);
  if (anc.exitCode !== 0) return { drift: true, ok: false, errors: ['contractCommit ' + String(contractCommit).slice(0, 12) + ' не предок HEAD ' + head.slice(0, 12)] };
  const committed = git(repo, ['diff', '--name-only', '-z', contractCommit, head, '--']);
  const paths = committed.exitCode === 0 ? committed.stdout.split('\0').filter(Boolean).map(toPosix) : [];
  const countRaw = git(repo, ['rev-list', '--count', contractCommit + '..' + head]);
  const foreignCommits = countRaw.exitCode === 0 ? Number(countRaw.stdout.trim()) || 0 : 0;
  const taskRel = relPosix(repo, taskDir);
  /*
   * 0114 (2.6.100): чужой коммит в allowedPaths не блокирует — код исполнитель
   * не коммитит, кандидата создаёт task-accept, значит коммит чужой. Блокирует
   * только правка собственного каталога задания (контракт).
   */
  const own = [taskRel + '/**'];
  const overlap = paths.filter((p) => matchesAny(p, own));
  if (overlap.length) {
    return { drift: true, ok: false, errors: ['коммиты после контракта задели пути задания: ' + overlap.join(', ')], from: contractCommit, to: head, foreignCommits, paths };
  }
  return { drift: true, ok: true, from: contractCommit, to: head, foreignCommits, paths };
}

export function readDiffText(repo, base) {
  const parts = [];
  const a = git(repo, ['diff', '--no-color', base, '--']);
  if (a.exitCode === 0) parts.push(a.stdout);
  const b = git(repo, ['diff', '--no-color', '--cached', '--']);
  if (b.exitCode === 0) parts.push(b.stdout);
  /*
   * Полный текст добавляем только неотслеживаемым файлам: у изменённых он уже есть
   * в диффе выше. Иначе скан секретов читает предсуществующие строки изменённого
   * файла и валит задачу за то, чего работа не касалась (1.4.2).
   */
  const untracked = new Set(
    (git(repo, ['ls-files', '--others', '--exclude-standard', '-z']).stdout || '')
      .split('\0')
      .filter(Boolean)
      .map(toPosix),
  );
  for (const rel of dirtyPaths(repo)) {
    if (!untracked.has(rel)) continue;
    if (rel.startsWith('docs/tasks/')) continue;
    const abs = path.join(repo, fromPosix(rel));
    if (exists(abs) && fs.statSync(abs).isFile()) {
      try { parts.push('+++ ' + rel + '\n' + readText(abs)); } catch { /* ignore binary */ }
    }
  }
  return parts.join('\n');
}

