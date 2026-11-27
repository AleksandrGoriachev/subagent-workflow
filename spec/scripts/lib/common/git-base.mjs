/*
 * Базовый git: вызов, HEAD, файлы коммита, корень репозитория.
 *
 * 0181: часть spec/scripts/lib/common.mjs; публичный вход — common.mjs.
 */
import path from 'node:path';
import { toPosix, exists, quoteArg } from './fsio.mjs';
import { runSync } from './proc.mjs';
export function git(repo, args, opts = {}) {
  const cmd = 'git ' + args.map(quoteArg).join(' ');
  return runSync(cmd, { ...opts, cwd: repo });
}

export function headCommit(repo) {
  const r = git(repo, ['rev-parse', '--verify', 'HEAD']);
  return r.exitCode === 0 ? r.stdout.trim() : null;
}

export function filesAtCommit(repo, rev) {
  const result = filesAtCommitDetailed(repo, rev);
  return result.ok ? result.files : null;
}

/**
 * 0124 (2.6.105): тот же список, но с причиной отказа. Пустой ответ git и «файла
 * нет» — разные вещи: на 0123 транзиентный пустой ls-tree дал 354 строки
 * «файл контракта не закоммичен» при закоммиченных файлах, и прогон пришлось
 * повторять. Теперь вызывающий отличает сбой чтения от отсутствия файла.
 */
export function filesAtCommitDetailed(repo, rev) {
  const r = git(repo, ['ls-tree', '-r', '--name-only', '-z', rev]);
  if (r.exitCode !== 0) {
    return {
      ok: false,
      error: 'git ls-tree ' + String(rev).slice(0, 12) + ': exit ' + r.exitCode
        + ' ' + String(r.stderr || '').trim().slice(0, 160),
    };
  }
  return { ok: true, files: r.stdout.split('\0').filter(Boolean).map(toPosix).sort() };
}

/**
 * Контракт задания — task.md, criteria.json и защищённые файлы — обязан быть закоммичен
 * до красного прогона. Иначе исполнитель может переписать проверки и перезамкнуть их
 * (README, раздел «Замок»).
 */

export function findRepoRoot(start) {
  let dir = path.resolve(start);
  for (;;) {
    if (exists(path.join(dir, '.git'))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

export function repoRoot(start) {
  const root = findRepoRoot(start);
  if (root) return root;
  const res = git(start, ['rev-parse', '--show-toplevel']);
  return res.exitCode === 0 ? res.stdout.trim() : path.resolve(start);
}

