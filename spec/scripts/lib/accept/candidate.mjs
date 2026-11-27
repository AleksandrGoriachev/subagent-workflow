/*
 * 0184: кандидатный коммит приёмки — вынесен из task-accept.mjs.
 * Право исполнения, журнал accept и сборка кандидата из рабочих путей.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runSync, quoteArg, exists, gateJournalFile } from '../common.mjs';
import { fail } from './progress.mjs';

/*
 * Право исполнения — свойство поставки, а не настройка рабочей машины (2.5.2).
 *
 * `git add` берёт режим файла из рабочего дерева, а Windows его не хранит:
 * файл, помеченный 100755 в индексе, после `git add` снова становится 100644,
 * и принятое дерево расходится с проверенным. Поэтому режим читается из
 * РЕАЛЬНОГО индекса (`git ls-files -s` без GIT_INDEX_FILE) и переносится в
 * индекс кандидата тем же `--chmod=+x`. Содержимое кандидата не меняется —
 * только режим; путь, не помеченный в индексе исполняемым, остаётся 100644.
 */
export function restoreExecutableModes(repoRoot, candidateEnv) {
  const real = runSync('git ls-files -s -z', { cwd: repoRoot, unsetEnv: ['GIT_INDEX_FILE'] });
  if (real.exitCode !== 0) fail('git ls-files -s (индекс репозитория): ' + real.stderr.trim());
  const executable = [];
  for (const entry of real.stdout.split('\0')) {
    const parsed = entry.match(/^(\d{6}) [0-9a-f]+ \d+\t(.+)$/s);
    if (parsed && parsed[1] === '100755') executable.push(parsed[2]);
  }
  if (executable.length === 0) return;
  const candidate = runSync('git ls-files -s -z', { cwd: repoRoot, env: candidateEnv });
  if (candidate.exitCode !== 0) fail('git ls-files -s (кандидат): ' + candidate.stderr.trim());
  const inCandidate = new Set();
  for (const entry of candidate.stdout.split('\0')) {
    const parsed = entry.match(/^\d{6} [0-9a-f]+ \d+\t(.+)$/s);
    if (parsed) inCandidate.add(parsed[1]);
  }
  const targets = executable.filter((file) => inCandidate.has(file));
  if (targets.length === 0) return;
  /* Порциями: список аргументов не должен упираться в предел командной строки. */
  for (let i = 0; i < targets.length; i += 50) {
    const batch = targets.slice(i, i + 50);
    const chmod = runSync('git update-index --chmod=+x -- ' + batch.map(quoteArg).join(' '), { cwd: repoRoot, env: candidateEnv });
    if (chmod.exitCode !== 0) fail('git update-index --chmod=+x: ' + chmod.stderr.trim());
  }
}

/** Есть ли в журнале строка accept по заданию (доказательство внутри кандидата). */
export function gateHasAccept(taskDir, taskId) {
  try {
    const file = gateJournalFile(taskDir);
    if (!exists(file)) return false;
    return fs.readFileSync(file, 'utf8').split('\n').some((line) => {
      if (!line.trim()) return false;
      try {
        const row = JSON.parse(line);
        return row && row.kind === 'accept' && String(row.task) === String(taskId) && String(row.verdict) !== 'void';
      } catch {
        return false;
      }
    });
  } catch {
    return false;
  }
}

export function createCandidate(repoRoot, filesToAdd, message, pathsToRemove = []) {
  const indexPath = path.join(os.tmpdir(), 'task-accept-' + process.pid + '-' + Date.now() + '.index');
  const env = {
    ...process.env,
    GIT_INDEX_FILE: indexPath,
    GIT_AUTHOR_NAME: process.env.GIT_AUTHOR_NAME || 'task-accept',
    GIT_AUTHOR_EMAIL: process.env.GIT_AUTHOR_EMAIL || 'task-accept@local',
    GIT_COMMITTER_NAME: process.env.GIT_COMMITTER_NAME || 'task-accept',
    GIT_COMMITTER_EMAIL: process.env.GIT_COMMITTER_EMAIL || 'task-accept@local',
  };
  delete env.TASK_ACCEPT_KEY;
  delete env.TASK_SIGN_KEY;
  try {
    const read = runSync('git read-tree HEAD', { cwd: repoRoot, env });
    if (read.exitCode !== 0) fail('git read-tree: ' + read.stderr.trim());
    /*
     * 0011 (F-1): кандидат не наследует ранее закоммиченную запись приёмки.
     * read-tree берёт дерево HEAD целиком, поэтому metadata-коммит с
     * acceptance.json попадал в кандидата и task-check-acceptance отказывал
     * «acceptance.json входит в кандидатный коммит». Путь приходит снаружи:
     * удаляется только запись текущего задания, записи других остаются частью
     * дерева. Если записи в индексе нет, --ignore-unmatch делает команду
     * успешной.
     */
    if (pathsToRemove.length > 0) {
      const remove = runSync('git rm --cached --ignore-unmatch -q -- ' + pathsToRemove.map(quoteArg).join(' '), { cwd: repoRoot, env });
      if (remove.exitCode !== 0) fail('git rm --cached: ' + remove.stderr.trim());
    }
    if (filesToAdd.length > 0) {
      const add = runSync('git add -A -- ' + filesToAdd.map(quoteArg).join(' '), { cwd: repoRoot, env });
      if (add.exitCode !== 0) fail('git add: ' + add.stderr.trim());
    }
    restoreExecutableModes(repoRoot, env);
    const treeRes = runSync('git write-tree', { cwd: repoRoot, env });
    if (treeRes.exitCode !== 0) fail('git write-tree: ' + treeRes.stderr.trim());
    const tree = treeRes.stdout.trim();
    const commitRes = runSync('git commit-tree ' + quoteArg(tree) + ' -p HEAD -m ' + quoteArg(message), { cwd: repoRoot, env });
    if (commitRes.exitCode !== 0) fail('git commit-tree: ' + commitRes.stderr.trim());
    return { commit: commitRes.stdout.trim(), tree };
  } finally {
    try { fs.rmSync(indexPath, { force: true }); } catch { /* ignore */ }
  }
}

