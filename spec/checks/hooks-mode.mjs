#!/usr/bin/env node
/*
 * Право исполнения хуков — часть поставки, а не настройка раннера.
 *
 * Урок 2.5.1: spec/hooks/* лежали в git с режимом 100644. Linux молча
 * игнорирует неисполняемый хук, поэтому на ubuntu-latest два push-кейса
 * падали («хуки не активны»), а шаг `chmod +x spec/hooks/*` в CI это
 * скрывал: локально без него проверки красные, в CI зелёные. Сломанная
 * проверка хуже отсутствующей — она создаёт видимость покрытия.
 *
 * Здесь проверяется само свойство: режим в индексе (его и получает checkout
 * на Linux) и то, что CI больше не чинит права под тестами. Файл защищён
 * замком задания, поэтому ослабление проверки видно в записи приёмки.
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const HOOKS = ['pre-commit', 'commit-msg', 'pre-push'];
const CI = path.join(ROOT, '.github', 'workflows', 'ci.yml');
let failed = 0;

const fail = (message) => { failed += 1; console.log('FAIL ' + message); };
const pass = (message) => console.log('PASS ' + message);

function git(args) {
  const result = spawnSync('git', args, { cwd: ROOT, encoding: 'utf8' });
  return { code: result.status, out: String(result.stdout || ''), err: String(result.stderr || '') };
}

/* Режим в индексе — это то, что получит checkout на POSIX-машине. */
const listed = git(['ls-files', '-s', '--', 'spec/hooks']);
if (listed.code !== 0) {
  fail('git ls-files -s spec/hooks: ' + (listed.err.trim() || 'exit=' + listed.code));
} else {
  const modes = new Map();
  for (const line of listed.out.split(/\r?\n/)) {
    const parsed = line.match(/^(\d{6}) [0-9a-f]+ \d+\t(.+)$/);
    if (parsed) modes.set(parsed[2], parsed[1]);
  }
  for (const hook of HOOKS) {
    const rel = 'spec/hooks/' + hook;
    if (!modes.has(rel)) { fail(rel + ': нет в индексе'); continue; }
    const mode = modes.get(rel);
    if (mode !== '100755') fail(rel + ': режим ' + mode + ', ожидалось 100755 (git update-index --chmod=+x)');
    else pass(rel + ': 100755');
  }
}

/* CI обязан проверять режим, а не подменять его chmod-ом. */
let ci = '';
try { ci = fs.readFileSync(CI, 'utf8'); } catch { ci = ''; }
if (ci === '') {
  fail('нет .github/workflows/ci.yml');
} else {
  if (/chmod\s+\+x\s+spec\/hooks/.test(ci)) fail('CI чинит права хуков (chmod +x spec/hooks): дефект режима замаскирован — шаг убрать');
  else pass('CI не чинит права хуков');
  if (!/node\s+spec\/checks\/hooks-mode\.mjs/.test(ci)) fail('в CI нет шага node spec/checks/hooks-mode.mjs: регрессию режима никто не поймает');
  else pass('CI запускает проверку режима хуков');
}

if (failed > 0) {
  console.log('');
  console.log('HOOKS MODE FAIL: ' + failed);
  process.exit(1);
}
console.log('');
console.log('HOOKS MODE OK');
