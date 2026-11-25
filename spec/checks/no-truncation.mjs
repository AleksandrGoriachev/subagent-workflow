#!/usr/bin/env node
/*
 * 0148 (2.6.112): защита от усечения больших файлов документации.
 *
 * Повод: перезапись CHANGELOG.md по неполному чтению (tools.read без limit отдаёт
 * не весь файл) вырезала 1222 строки истории, и это заметил только git diff.
 * Шаг selftest сравнивает число строк spec/SPEC.md и CHANGELOG.md с HEAD:
 * уменьшение больше порога — отказ. WF_ALLOW_TRUNCATION=1 разрешает осознанное
 * сокращение.
 *
 * c1: временный репозиторий — усечение ловится, порог и env уважаются;
 * c2: текущий репозиторий проходит.
 *
 * Вне пакета — SKIP (конвенция deployed-copy).
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSyncPipeFree } from '../scripts/lib/common.mjs';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PKG = path.resolve(HERE, '..', '..');
if (!fs.existsSync(path.join(PKG, 'spec'))) {
  console.log('SKIP: проверка пакета вне пакета');
  process.exit(0);
}

/* Файлы, историю которых нельзя терять молча. */
export const WATCHED = ['spec/SPEC.md', 'CHANGELOG.md'];
/* Порог: обычная редактура укладывается, потеря истории — нет. */
export const THRESHOLD = 20;

function run(cmd, args, cwd) {
  const r = spawnSyncPipeFree(cmd, args, { cwd, encoding: 'utf8', timeout: 300000 });
  return { code: r.status, out: String(r.stdout || ''), err: String(r.stderr || '') };
}

function countLines(text) {
  const trimmed = String(text || '');
  if (trimmed === '') return 0;
  return trimmed.split('\n').length;
}

/**
 * Проверить, что watched-файлы не потеряли строк относительно HEAD.
 * @returns {{ ok: boolean, problems: string[], checked: number }}
 */
export function checkRepo(root) {
  const repo = String(root);
  const problems = [];
  let checked = 0;
  if (String(process.env.WF_ALLOW_TRUNCATION || '') === '1') {
    return { ok: true, problems: [], checked: 0 };
  }
  for (const rel of WATCHED) {
    const file = path.join(repo, rel);
    if (!fs.existsSync(file)) continue;
    const shown = run('git', ['-C', repo, 'show', 'HEAD:' + rel], repo);
    if (shown.code !== 0 || shown.out === '') continue;
    const before = countLines(shown.out);
    const after = countLines(fs.readFileSync(file, 'utf8'));
    checked += 1;
    if (before - after > THRESHOLD) {
      problems.push(rel + ': строк стало ' + after + ' вместо ' + before
        + ' (потеря ' + (before - after) + ' > ' + THRESHOLD + '); похоже на перезапись по неполному чтению.'
        + ' Осознанное сокращение — WF_ALLOW_TRUNCATION=1');
    }
  }
  return { ok: problems.length === 0, problems, checked };
}

const table = {
  /* c1: усечение ловится; порог и WF_ALLOW_TRUNCATION=1 уважаются. */
  c1() {
    const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-notrunc-'));
    try {
      run('git', ['init', '-q'], repo);
      run('git', ['config', 'user.email', 'p@l'], repo);
      run('git', ['config', 'user.name', 'p'], repo);
      fs.mkdirSync(path.join(repo, 'spec'), { recursive: true });
      const longBody = Array.from({ length: 100 }, (_, i) => 'строка ' + (i + 1)).join('\n') + '\n';
      fs.writeFileSync(path.join(repo, 'spec', 'SPEC.md'), longBody);
      fs.writeFileSync(path.join(repo, 'CHANGELOG.md'), longBody);
      run('git', ['add', '-A'], repo);
      run('git', ['commit', '-q', '-m', 'init'], repo);

      const clean = checkRepo(repo);
      if (!clean.ok) throw new Error('чистое дерево не прошло: ' + clean.problems.join('; '));
      if (clean.checked !== 2) throw new Error('проверено файлов ' + clean.checked + ', ожидалось 2');

      /* Обычная редактура: минус 5 строк — молчим. */
      fs.writeFileSync(path.join(repo, 'CHANGELOG.md'), longBody.split('\n').slice(5).join('\n'));
      const small = checkRepo(repo);
      if (!small.ok) throw new Error('редактура на 5 строк признана усечением: ' + small.problems.join('; '));

      /* Усечение: 100 → 10 строк — отказ. */
      fs.writeFileSync(path.join(repo, 'spec', 'SPEC.md'), longBody.split('\n').slice(0, 10).join('\n'));
      const cut = checkRepo(repo);
      if (cut.ok) throw new Error('усечение SPEC.md не поймано');
      if (!cut.problems.some((p) => p.includes('spec/SPEC.md'))) throw new Error('отказ не называет файл: ' + cut.problems.join('; '));

      /* Осознанное сокращение: env снимает отказ. */
      process.env.WF_ALLOW_TRUNCATION = '1';
      try {
        const allowed = checkRepo(repo);
        if (!allowed.ok) throw new Error('WF_ALLOW_TRUNCATION=1 не снял отказ: ' + allowed.problems.join('; '));
      } finally {
        delete process.env.WF_ALLOW_TRUNCATION;
      }
      console.log('NOTRUNC OK c1');
    } finally {
      fs.rmSync(repo, { recursive: true, force: true });
    }
  },
  /* c2: текущий репозиторий проходит. */
  c2() {
    const result = checkRepo(PKG);
    if (!result.ok) throw new Error('репозиторий не прошёл: ' + result.problems.join('; '));
    if (result.checked < 1) throw new Error('ни один файл не проверен (git недоступен?)');
    console.log('NOTRUNC OK c2');
  },
};

const isCli = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (isCli) {
  const which = process.argv[2];
  if (!table[which]) {
    console.log('usage: node spec/checks/no-truncation.mjs c1|c2');
    process.exit(2);
  }
  try {
    table[which]();
  } catch (error) {
    console.log('NOTRUNC FAIL ' + which + ': ' + (error && error.message ? error.message : error));
    process.exit(1);
  }
}
