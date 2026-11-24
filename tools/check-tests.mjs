#!/usr/bin/env node
/*
 * 0112 (2.6.99): выбор проверки по изменённым файлам.
 *
 *   node tools/check-tests.mjs [--dry-run] [--repo <корень>]
 *
 * Режимы:
 *  - full     — менялся код плагина (plugin/lib|test|tools): полный набор плагина;
 *  - affected — менялся движок (spec/**, tools/**): selftest + тесты, чьи
 *               зависимости затронуты (spec/scripts/tests-for.mjs);
 *  - selftest — изменений в коде нет (только docs/артефакты): selftest.
 *
 * Полный набор не пропускается там, где менялся код плагина: качество не
 * снижается, сокращается только простой движковых правок.
 */
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PKG = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function git(repo, args) {
  return spawnSync('git', args, { cwd: repo, encoding: 'utf8' });
}

/** Какие пути считаем изменёнными (незакоммиченные + неотслеживаемые). */
export function changedPaths(repo) {
  const out = new Set();
  const status = git(repo || PKG, ['status', '--porcelain', '-z']);
  if (status.status === 0) {
    for (const item of String(status.stdout || '').split('\0')) {
      if (!item) continue;
      const raw = item.length > 3 ? item.slice(3) : item;
      if (raw) out.add(raw.split('\\').join('/'));
    }
  }
  return [...out].sort();
}

/** Решение по списку путей: full | affected | selftest. */
export function decide(changed) {
  const list = (Array.isArray(changed) ? changed : [])
    .map((p) => String(p).split('\\').join('/'))
    .filter((p) => p !== '' && !p.startsWith('docs/') && !p.startsWith('.dsh/') && !p.startsWith('dist/'));
  if (list.length === 0) return { mode: 'selftest', changed: [], reason: 'изменений в коде нет' };
  const plugin = list.filter((p) => /^plugin\/(lib|test|tools)\//u.test(p));
  if (plugin.length > 0) return { mode: 'full', changed: list, reason: 'изменён код плагина: ' + plugin.slice(0, 3).join(', ') };
  return { mode: 'affected', changed: list, reason: 'изменён движок или инструменты' };
}

/** Тесты, зависящие от перечисленных путей (по одному запуску tests-for). */
export function affectedTests(changed, repo) {
  const base = path.resolve(repo || PKG);
  const selected = new Set();
  for (const rel of changed) {
    if (!(rel.startsWith('spec/') || rel.startsWith('tools/'))) continue;
    const run = spawnSync(process.execPath, [path.join(base, 'spec/scripts/tests-for.mjs'), rel], { cwd: base, encoding: 'utf8' });
    if (run.status !== 0) continue;
    const line = String(run.stdout || '').trim();
    const match = /^node --test (.+)$/u.exec(line);
    if (!match) continue;
    for (const file of match[1].split(' ')) if (file) selected.add(file);
  }
  return [...selected].sort();
}

/*
 * 0130 (2.6.107): у ребёнка есть таймаут. Зависший selftest/тесты иначе держат
 * весь прогон и оставляют пустой вывод; по таймауту ребёнок снимается, и это
 * названо отдельно (timedOut), а не выдаётся за падение проверки.
 */
const CHILD_TIMEOUT_MS = Number(process.env.WF_CHECK_TESTS_TIMEOUT_MS) || 900000;

/* Вывод ребёнка — в файл, а не в пайп: песочница не даёт именованных каналов. */
export function runChildToFile(child) {
  return new Promise((resolve) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-ct-'));
    const file = path.join(dir, 'out');
    const fd = fs.openSync(file, 'w');
    const started = Date.now();
    const limit = Number(child.timeoutMs) > 0 ? Number(child.timeoutMs) : CHILD_TIMEOUT_MS;
    let timedOut = false;
    const finish = (code) => {
      let output = '';
      try { fs.closeSync(fd); } catch { /* ignore */ }
      try { output = fs.readFileSync(file, 'utf8'); } catch { /* ignore */ }
      try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
      resolve({ code: timedOut ? 124 : (Number.isInteger(code) ? code : 1), output, durationMs: Date.now() - started, timedOut, timeoutMs: limit });
    };
    let proc;
    try {
      proc = spawn(process.execPath, child.args, { cwd: child.cwd || PKG, stdio: ['ignore', fd, fd], windowsHide: true });
    } catch {
      finish(127);
      return;
    }
    const timer = setTimeout(() => {
      timedOut = true;
      try { proc.kill('SIGKILL'); } catch { /* ignore */ }
    }, limit);
    proc.on('error', () => { clearTimeout(timer); finish(127); });
    proc.on('close', (code) => { clearTimeout(timer); finish(code === null ? 1 : code); });
  });
}

/*
 * 0128 (2.6.106): selftest и отобранные тесты идут ОДНОВРЕМЕННО, а не по очереди.
 * Раньше проверка платила суммой: selftest (~45–80 с) + затронутые тесты (~80–200 с).
 * impl подменяем: проверка spec/checks/check-tests-parallel.mjs подтверждает
 * перекрытие без реального прогона.
 */
export async function runChildren(children, impl) {
  const runner = typeof impl === 'function' ? impl : runChildToFile;
  const started = Date.now();
  const results = await Promise.all((Array.isArray(children) ? children : []).map(async (child) => {
    const result = await runner(child);
    return { name: String(child.name || ''), ...result };
  }));
  return { results, durationMs: Date.now() - started };
}

async function main() {
  const argv = process.argv.slice(2);
  const dryRun = argv.includes('--dry-run');
  const repoIndex = argv.indexOf('--repo');
  const repo = repoIndex >= 0 ? path.resolve(argv[repoIndex + 1] || PKG) : PKG;
  const decision = decide(changedPaths(repo));
  const tests = decision.mode === 'affected' ? affectedTests(decision.changed, repo) : [];
  const children = [];
  if (decision.mode === 'full') {
    children.push({ name: 'full', args: [path.join(PKG, 'plugin/tools/test.mjs')] });
  } else {
    children.push({ name: 'selftest', args: [path.join(PKG, 'spec/selftest.mjs')] });
    if (tests.length > 0) children.push({ name: 'tests', args: ['--test', ...tests.map((file) => path.join(PKG, file))] });
  }
  if (dryRun) {
    console.log(JSON.stringify({ mode: decision.mode, reason: decision.reason, changed: decision.changed, tests, parallel: children.length > 1, children: children.map((child) => child.name) }, null, 2));
    return 0;
  }
  const run = await runChildren(children);
  let failed = false;
  for (const result of run.results) {
    if (result.output) process.stdout.write(result.output);
    if (result.code !== 0) {
      failed = true;
      const why = result.timedOut
        ? 'снят по таймауту ' + Math.round(Number(result.timeoutMs || 0) / 1000) + ' с'
        : 'упал (exit=' + result.code + ')';
      process.stdout.write('check-tests: ' + result.name + ' ' + why + ', ' + result.durationMs + ' ms' + String.fromCharCode(10));
    }
  }
  return failed ? 1 : 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().then((code) => process.exit(code)).catch((error) => {
    console.error('check-tests: ' + (error && error.message ? error.message : error));
    process.exit(1);
  });
}
