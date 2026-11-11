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
  /* 0189: приёмка по КОДУ, а не по тексту: клон на указанный коммит, чеки на клоне. */
  const at = value('--at');
  let target = path.resolve(root);
  let tempClone = null;
  if (at) {
    const { execFileSync } = await import('node:child_process');
    tempClone = path.join(process.env.TEMP || '/tmp', 'wf-accept-' + Date.now());
    execFileSync('git', ['clone', '--quiet', '--no-hardlinks', root, tempClone], { stdio: 'ignore' });
    execFileSync('git', ['-C', tempClone, 'checkout', '--quiet', at], { stdio: 'ignore' });
    const nm = path.join(root, 'node_modules');
    if (fs.existsSync(nm)) {
      try { execFileSync('cmd', ['/c', 'mklink', '/J', path.join(tempClone, 'node_modules'), nm], { stdio: 'ignore' }); } catch { /* без junction */ }
    }
    target = tempClone;
    console.log('приёмка на клоне: ' + tempClone + ' @ ' + at);
  }
  console.log('проект: ' + path.resolve(root) + (at ? ' | на коммите ' + at : ''));
  console.log('HEAD: ' + head + ' | изменённых путей: ' + (dirty < 0 ? 'нет git' : dirty));
  const want = value('--task');
  const tasks = want ? [want] : Object.keys(CHECKS);
  let failures = 0;
  for (const task of tasks) {
    const file = CHECKS[task];
    if (!file) { console.log('неизвестная задача: ' + task); failures += 1; continue; }
    const script = path.join(HERE, '..', 'spec', 'checks', 'stopline', file);
    try {
      execFileSync(process.execPath, [script, target], { stdio: 'inherit' });
      console.log(task + ': OK');
    } catch (error) {
      failures += 1;
      console.log(task + ': FAILED');
    }
  }
  console.log('');
  console.log(failures === 0 ? 'ПРИЁМКА: все запрошенные чеки зелёные' : 'ПРИЁМКА: красных чеков ' + failures);
  if (tempClone) { try { fs.rmSync(tempClone, { recursive: true, force: true }); } catch { /* останется */ } }
  process.exit(failures === 0 ? 0 : 1);
}