#!/usr/bin/env node
/**
 * 0188: линт контрактов стоп-линии — чтобы критерии не были формальными.
 *
 * Причина: 0207 (B1: task-regress.mjs в allowedPaths без критерия) и 0210 (G1:
 * C3/C4 читали регексы, lib/index.js не проверялся) — два круга rework из-за
 * наших же критериев. Линт ловит это ДО отправки контракта:
 *
 *  1) каждый изменяемый файл из allowedPaths упомянут хотя бы одним чеком;
 *  2) каждая команда критерия ссылается на существующий файл чека;
 *  3) у каждого критерия есть id/команда, id уникальны;
 *  4) redExpect.mustFail содержит все критерии, которых ещё нет (по команде).
 *
 *   node tools/contract-lint.mjs --pack docs/stopline-tasks/<id> [--root <чужой проект>]
 */
import fs from 'node:fs';
import path from 'node:path';

const CODE_EXT = /\.(mjs|js|json|ps1|md)$/u;

export function lintPack(packDir, projectRoot, taskId) {
  const taskFile = taskId ? taskId + '-task.md' : fs.readdirSync(packDir).find((n) => n.endsWith('-task.md'));
  const critFile = taskId ? taskId + '-criteria.json' : fs.readdirSync(packDir).find((n) => n.endsWith('-criteria.json'));
  const problems = [];
  if (!taskFile || !critFile) return ['в пакете нет task.md или criteria.json'];

  const md = fs.readFileSync(path.join(packDir, taskFile), 'utf8');
  const metaText = (md.match(/<!-- TASK-META\n([\s\S]*?)\n-->/u) || [])[1];
  let meta;
  try { meta = JSON.parse(metaText); } catch { return ['TASK-META не разбирается']; }
  const criteria = JSON.parse(fs.readFileSync(path.join(packDir, critFile), 'utf8'));

  const ids = criteria.criteria.map((c) => c.id);
  if (new Set(ids).size !== ids.length) problems.push('id критериев не уникальны');
  for (const criterion of criteria.criteria) {
    if (!criterion.id || !criterion.command) problems.push('критерий без id/command: ' + JSON.stringify(criterion).slice(0, 60));
  }

  /* 2) команда ссылается на существующий чек */
  const checkFiles = new Map();
  const ownChecks = new Set();
  for (const criterion of criteria.criteria) {
    const m = /node\s+(checks\/[^\s]+)/u.exec(String(criterion.command || ''));
    if (!m) continue;
    const rel = m[1].replace(/\\/gu, '/');
    ownChecks.add(rel);
    if (projectRoot) {
      const abs = path.join(projectRoot, rel);
      checkFiles.set(rel, fs.existsSync(abs));
      if (!fs.existsSync(abs)) problems.push(criterion.id + ': чек не существует в проекте: ' + rel);
    }
  }

  /* 1) покрытие allowedPaths: каждый код-файл упомянут хотя бы одним чеком */
  const allowed = Array.isArray(meta.allowedPaths) ? meta.allowedPaths : [];
  const checkTexts = [];
  for (const [rel, exists] of checkFiles) {
    if (!exists || !projectRoot) continue;
    try { checkTexts.push(fs.readFileSync(path.join(projectRoot, rel), 'utf8')); } catch { /* нет файла */ }
  }
  if (checkTexts.length > 0) {
    for (const rel of allowed) {
      if (!CODE_EXT.test(rel)) continue;
      if (rel.startsWith('docs/')) continue;
      const base = path.basename(rel);
      const mentioned = checkTexts.some((text) => text.includes(rel) || text.includes(base))
        || String(md).includes(rel) || String(md).includes(base);
      if (!mentioned && !ownChecks.has(rel)) problems.push('файл в allowedPaths не упомянут ни одним чеком: ' + rel);
    }
  }

  /* 4) redExpect: mustFail покрывает критерии, чьих чеков ещё нет */
  const mustFail = (criteria.redExpect && criteria.redExpect.mustFail) || [];
  for (const criterion of criteria.criteria) {
    const m = /node\s+(checks\/[^\s]+)/u.exec(String(criterion.command || ''));
    if (!m || !projectRoot) continue;
    const exists = fs.existsSync(path.join(projectRoot, m[1]));
    if (!exists && !mustFail.includes(criterion.id)) problems.push('нет чека, но ' + criterion.id + ' не в mustFail');
  }

  return problems;
}

if (process.argv[1] && process.argv[1].endsWith('contract-lint.mjs')) {
  const argv = process.argv.slice(2);
  const value = (flag) => { const i = argv.indexOf(flag); return i >= 0 ? argv[i + 1] : undefined; };
  const pack = value('--pack');
  const taskId = value('--id');
  const root = value('--root');
  if (!pack || !fs.existsSync(pack)) { console.log('нужен --pack <каталог пакета>'); process.exit(2); }
  const problems = lintPack(path.resolve(pack), root ? path.resolve(root) : null, taskId);
  if (problems.length === 0) { console.log('contract-lint: OK'); process.exit(0); }
  console.log('contract-lint: проблем ' + problems.length);
  for (const problem of problems) console.log('- ' + problem);
  process.exit(1);
}