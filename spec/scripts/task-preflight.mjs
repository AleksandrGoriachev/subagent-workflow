#!/usr/bin/env node
/*
 * 0092 (WC-20): контракт до красного — mustPass должны быть зелёными на базе.
 *
 * Usage: node task-preflight.mjs --task <dir> [--repo <dir>] [--json]
 * Дешёвые mustPass идут первыми; дорогие не запускаются, если дешёвая упала.
 * Exit 0 — контракт согласован с базой; exit 1 — mustPass красный, красный прогон
 * докажет ошибку контракта, а не поведение.
 */
import path from 'node:path';
import { parseArgv, readTask, repoRoot, reportFatal } from './lib/common.mjs';
import { preflightMustPass } from './lib/preflight.mjs';

const argv = parseArgv(process.argv.slice(2));
if (argv.help) {
  console.log('Usage: node task-preflight.mjs --task <dir> [--repo <dir>] [--json]');
  console.log('Гоняет только mustPass-критерии на текущем дереве (база): дешёвые первыми, дорогие — после них.');
  process.exit(0);
}
const taskDir = path.resolve(argv.task || argv._[0] || '.');
const repo = path.resolve(argv.repo || repoRoot(taskDir));
try {
  const { criteria } = readTask(taskDir);
  const report = await preflightMustPass({
    repo,
    criteria,
    log: (line) => { if (argv.json !== true) console.log(line); },
  });
  if (argv.json === true) {
    console.log(JSON.stringify({ repo, task: path.basename(taskDir), ...report }, null, 2));
  } else if (report.empty) {
    console.log('PREFLIGHT: mustPass не объявлены — проверять нечего');
  } else {
    console.log('ИТОГ preflight: ' + (report.ok ? 'mustPass зелёные на базе' : 'mustPass красные на базе — контракт сломан')
      + (report.skipped.length ? ', пропущено дорогих: ' + report.skipped.join(',') : ''));
  }
  process.exit(report.ok ? 0 : 1);
} catch (error) {
  reportFatal('task-preflight', error);
}
