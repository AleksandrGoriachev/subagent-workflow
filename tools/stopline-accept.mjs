#!/usr/bin/env node
/**
 * 0176: приёмка стоп-линии. Прогоняет ВНЕШНИЕ чеки на чужом HEAD и говорит вердикт.
 *
 * Не верит их зелёным логам: критерии — наши файлы, путь к проекту — только чтение.
 *
 *   node tools/stopline-accept.mjs --root <проект> [--task 0207|0208|0209]
 *
 * Код выхода: 0 — все запрошенные чеки зелёные, 1 — есть красные, 2 — ошибка аргументов.
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const HERE = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/u, '$1'));
const CHECKS = {
  '0207': 't1-regress-gate.mjs',
  '0208': 't2-graph-noloss.mjs',
  '0209': 't3-policy-truth.mjs',
};

if (process.argv[1] && process.argv[1].endsWith('stopline-accept.mjs')) {
  const argv = process.argv.slice(2);
  const value = (flag) => { const index = argv.indexOf(flag); return index >= 0 ? argv[index + 1] : undefined; };
  const root = value('--root');
  if (!root || !fs.existsSync(root)) { console.log('нужен --root <существующий проект>'); process.exit(2); }
  let head = '?';
  try { head = execFileSync('git', ['-C', root, 'rev-parse', '--short', 'HEAD'], { encoding: 'utf8' }).trim(); } catch { /* не git */ }
  const dirty = (() => { try { return execFileSync('git', ['-C', root, 'status', '--porcelain'], { encoding: 'utf8' }).trim().split('\n').filter(Boolean).length; } catch { return -1; } })();
  console.log('проект: ' + path.resolve(root));
  console.log('HEAD: ' + head + ' | изменённых путей: ' + (dirty < 0 ? 'нет git' : dirty));
  const want = value('--task');
  const tasks = want ? [want] : Object.keys(CHECKS);
  let failures = 0;
  for (const task of tasks) {
    const file = CHECKS[task];
    if (!file) { console.log('неизвестная задача: ' + task); failures += 1; continue; }
    const script = path.join(HERE, '..', 'spec', 'checks', 'stopline', file);
    try {
      execFileSync(process.execPath, [script, path.resolve(root)], { stdio: 'inherit' });
      console.log(task + ': OK');
    } catch (error) {
      failures += 1;
      console.log(task + ': FAILED');
    }
  }
  console.log('');
  console.log(failures === 0 ? 'ПРИЁМКА: все запрошенные чеки зелёные' : 'ПРИЁМКА: красных чеков ' + failures);
  process.exit(failures === 0 ? 0 : 1);
}