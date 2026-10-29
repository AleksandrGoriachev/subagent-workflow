#!/usr/bin/env node
import path from 'node:path';
import {
  parseArgv, readTask, verifyLock, repoRoot, git, dirtyPaths, matchesAny, relPosix,
  runCommand, evaluateExpectation, isManual, stableResults, truncate, writeJson, writeText,
  formatMs, evaluateRedExpectation,
} from './lib/common.mjs';

const NL = String.fromCharCode(10);
const argv = parseArgv(process.argv.slice(2));
if (argv.help) {
  console.log('Usage: node task-red.mjs --task <dir> [--repo <dir>] [--base <ref>] [--json] [--allow-dirty] [--allow-base-mismatch]');
  process.exit(0);
}

const taskDir = path.resolve(argv.task || argv._[0] || '.');
const repo = path.resolve(argv.repo || repoRoot(taskDir));
/* Ключ приёмщика не должен попадать в код задачи, который мы запускаем. */
delete process.env.TASK_ACCEPT_KEY;

function firstLines(text, max = 5) {
  const lines = String(text).replaceAll(String.fromCharCode(13), '').split(NL);
  if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
  return { head: lines.slice(0, max), rest: Math.max(0, lines.length - max) };
}

function printSummary(title, rows) {
  console.log(title);
  for (const r of rows) {
    console.log('  ' + (r.passed ? 'PASS' : 'FAIL') + '  ' + r.id + '  ' + formatMs(r.durationMs));
    if (!r.passed && r.reasons && r.reasons.length) for (const reason of r.reasons) console.log('        ' + reason);
  }
}

try {
  const { files, taskMd, meta, criteria } = readTask(taskDir);
  const lockCheck = verifyLock(repo, taskDir, meta, taskMd, criteria);
  if (!lockCheck.ok) {
    for (const e of lockCheck.errors) console.error('task-red: lock: ' + e);
    process.exit(1);
  }

  const baseRef = String(argv.base || meta.base || 'HEAD');
  const base = git(repo, ['rev-parse', '--verify', baseRef + '^{commit}']);
  if (base.exitCode !== 0) {
    console.error('task-red: не разрешается base: ' + baseRef);
    process.exit(1);
  }
  const baseSha = base.stdout.trim();
  const head = git(repo, ['rev-parse', 'HEAD']);
  const headSha = head.exitCode === 0 ? head.stdout.trim() : '';
  if (lockCheck.expected.contractCommit !== headSha) {
    console.error('task-red: контракт закоммичен в ' + lockCheck.expected.contractCommit + ', а HEAD ' + headSha + '.');
    console.error('Красный прогон идёт только на контрактном коммите; после правки контракта перезапустите task-hash --write.');
    process.exit(1);
  }
  if (baseSha !== headSha && !argv['allow-base-mismatch']) {
    console.error('task-red: base (' + baseSha.slice(0, 12) + ') не совпадает с HEAD (' + headSha.slice(0, 12) + ').');
    console.error('Красный прогон должен идти на базовом коде: checkout base или --base HEAD. Для осознанного исключения — --allow-base-mismatch.');
    process.exit(1);
  }

  const taskRel = relPosix(repo, taskDir);
  const dirty = dirtyPaths(repo);
  const allowedDirty = [
    taskRel + '/**',
    ...(Array.isArray(meta.redAllowDirty) ? meta.redAllowDirty : []),
  ];
  const unexpected = dirty.filter((p) => !matchesAny(p, allowedDirty));
  const bypasses = {
    allowDirty: Boolean(argv['allow-dirty'] && unexpected.length > 0),
    allowBaseMismatch: Boolean(argv['allow-base-mismatch'] && baseSha !== headSha),
  };
  if (Object.values(bypasses).some(Boolean) && meta.risk === 'high') {
    console.error('task-red: high-risk задача не может использовать обход (--allow-dirty / --allow-base-mismatch).');
    process.exit(1);
  }
  if (unexpected.length && !argv['allow-dirty']) {
    console.error('task-red: рабочее дерево грязное вне разрешённых путей:');
    for (const p of unexpected) console.error('  ' + p);
    console.error('Красный прогон должен идти на закоммиченном контракте; допустимы только артефакты задания.');
    process.exit(1);
  }

  const env = { TASK_ID: String(meta.id), TASK_DIR: taskDir, REPO_ROOT: repo, TASK_RUN: 'red', NO_COLOR: '1' };
  const log = [];
  const results = [];
  const logLine = (s) => { log.push(s); };

  logLine('# task-red ' + meta.id);
  logLine('# base ' + baseRef + ' -> ' + baseSha);
  logLine('# head ' + headSha);
  logLine('# created ' + new Date().toISOString());
  logLine('');

  let setupFailed = false;
  for (const cmd of criteria.setup) {
    const r = await runCommand(cmd, { cwd: repo, env, timeoutMs: 300000 });
    logLine('## setup: ' + cmd);
    logLine('exit=' + r.exitCode + ' duration=' + r.durationMs + 'ms');
    logLine(r.stdout);
    if (r.stderr) logLine('[stderr]' + NL + r.stderr);
    logLine('');
    if (r.exitCode !== 0) { setupFailed = true; break; }
  }
  if (setupFailed) {
    writeText(files.redLog, log.join(NL));
    console.error('task-red: setup завершился ошибкой; см. ' + files.redLog);
    process.exit(1);
  }

  for (const c of criteria.criteria) {
    const id = String(c.id);
    if (isManual(c)) {
      logLine('## ' + id + ': MANUAL (пропущен)');
      continue;
    }
    const cwd = c.cwd ? path.resolve(repo, c.cwd) : repo;
    const timeoutMs = (c.timeoutMs || 120000) * (Number(argv['timeout-multiplier']) || 1);
    const r = await runCommand(c.command, { cwd, env, timeoutMs });
    const ev = evaluateExpectation(c.expect, r);
    const passed = ev.passed;
    results.push({ id, command: c.command, exitCode: r.exitCode, durationMs: r.durationMs, passed, timedOut: r.timedOut, reasons: ev.reasons, stdout: r.stdout, stderr: r.stderr });
    logLine('## ' + id + ': ' + c.command);
    logLine('exit=' + r.exitCode + ' duration=' + r.durationMs + 'ms timedOut=' + r.timedOut);
    logLine(r.stdout);
    if (r.stderr) logLine('[stderr]' + NL + r.stderr);
    logLine('');
  }

  for (const cmd of criteria.teardown) {
    const r = await runCommand(cmd, { cwd: repo, env, timeoutMs: 300000 });
    logLine('## teardown: ' + cmd);
    logLine('exit=' + r.exitCode);
    if (r.stdout) logLine(r.stdout);
    if (r.stderr) logLine('[stderr]' + NL + r.stderr);
    logLine('');
  }

  const executed = results.length;
  const failed = results.filter((r) => !r.passed);
  const allGreen = executed > 0 && failed.length === 0;
  const redExpectation = evaluateRedExpectation(criteria.redExpect, results);
  if (meta.risk !== 'low' && !redExpectation.configured) {
    redExpectation.errors.push('нет redExpect: для risk=' + meta.risk + ' объявите mustFail/mustPass');
    redExpectation.ok = false;
  }
  /*
   * F-6 (2.6.4): причина красного — дословная подстрока stdout+stderr. Одного
   * «упал не по ожидаемой причине» мало: непонятно, что пришло на самом деле,
   * и разбирательство идёт по red.log вручную. Печатаем ожидаемую причину,
   * первые строки stdout+stderr критерия и путь к red.log. Случай «критерий
   * зелёный» печатается тоже: задание ждало падения, и вывод — единственное
   * доказательство того, чего оно не дождалось.
   */
  const declaredReasons = criteria.redExpect && typeof criteria.redExpect.reasons === 'object' && criteria.redExpect.reasons !== null
    ? criteria.redExpect.reasons
    : {};
  const declaredMustFail = criteria.redExpect && Array.isArray(criteria.redExpect.mustFail)
    ? criteria.redExpect.mustFail.map(String)
    : [];
  const reasonDiagnostics = [];
  for (const id of declaredMustFail) {
    const reason = declaredReasons[id];
    if (typeof reason !== 'string' || reason === '') continue;
    const result = results.find((r) => r.id === id);
    if (!result) continue;
    const text = String(result.stdout || '') + NL + String(result.stderr || '');
    if (!result.passed && text.includes(reason)) continue;
    reasonDiagnostics.push({ id, reason, passed: result.passed, stdout: firstLines(result.stdout), stderr: firstLines(result.stderr) });
  }
  const redProven = redExpectation.ok;

  const output = {
    version: 4,
    kind: 'red',
    task: String(meta.id),
    createdAt: new Date().toISOString(),
    base: baseRef,
    baseSha,
    headSha,
    contractCommit: lockCheck.expected.contractCommit,
    criteriaSha256: lockCheck.expected.criteriaSha256,
    criteriaJsonSha256: lockCheck.expected.criteriaJsonSha256,
    dirtyPaths: dirty,
    results: stableResults(results),
    executed,
    failed: failed.length,
    failedIds: failed.map((r) => r.id),
    allGreen,
    redProven,
    redExpectation,
    bypasses,
    log: path.basename(files.redLog),
  };
  writeJson(files.red, output);
  writeText(files.redLog, log.join(NL));

  if (argv.json) {
    console.log(JSON.stringify(output, null, 2));
  } else {
    printSummary('task-red: ' + meta.id + ' (base ' + baseSha.slice(0, 12) + ')', results);
    console.log('');
    if (redProven) console.log('Красный доказан: ' + failed.length + ' из ' + executed + ' проверок падают по ожиданию задания.');
    else if (redExpectation.errors.length) {
      console.log('Красный НЕ доказан:');
      for (const error of redExpectation.errors) console.log('  ' + error);
    } else if (executed === 0) console.log('Красный НЕ доказан: нет исполняемых проверок (все manual?).');
    else console.log('Красный НЕ доказан: все ' + executed + ' проверок уже зелёные. Задача или проверка сформулированы неверно.');
    if (reasonDiagnostics.length) {
      console.log('');
      console.log('Причины красного (дословная подстрока stdout+stderr):');
      for (const item of reasonDiagnostics) {
        console.log('  ' + item.id + ': ожидаемая причина не найдена в выводе: "' + item.reason + '"');
        console.log('  ' + item.id + ': ' + (item.passed ? 'критерий зелёный — падения не было' : 'критерий упал, но по другой причине'));
        for (const [stream, part] of [['stdout', item.stdout], ['stderr', item.stderr]]) {
          if (part.head.length === 0) continue;
          console.log('  ' + item.id + ': первые строки ' + stream + ':');
          for (const line of part.head) console.log('    ' + line);
          if (part.rest > 0) console.log('    …[' + part.rest + ' строк]');
        }
      }
      console.log('  Полный вывод критериев: ' + files.redLog);
    }
    console.log('Артефакты: ' + files.red + ', ' + files.redLog);
  }
  process.exit(redProven ? 0 : 1);
} catch (err) {
  if (argv.json) console.log(JSON.stringify({ ok: false, errors: [err.message] }, null, 2));
  else console.error('task-red: ' + err.message);
  process.exit(err.exitCode || 1);
}
