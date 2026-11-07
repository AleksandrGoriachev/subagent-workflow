#!/usr/bin/env node
import path from 'node:path';
import { preflightMustPass } from './lib/preflight.mjs';
import {
  parseArgv, readTask, verifyLock, repoRoot, git, dirtyPaths, matchesAny, relPosix,
  runCommand, runCriteria, evaluateExpectation, isManual, stableResults, truncate, writeJson, writeText,
  formatGateRow, formatGateSummary, evaluateRedExpectation, gateRecord, gateCriteriaOf, gateJournalFile, appendGateRecord,
  detectCheckDefect, matchRedReason, redReasonWindow, lockOrderHint, reportFatal,
} from './lib/common.mjs';

const NL = String.fromCharCode(10);
const argv = parseArgv(process.argv.slice(2));
if (argv.help) {
  console.log('Usage: node task-red.mjs --task <dir> [--repo <dir>] [--base <ref>] [--json] [--allow-dirty] [--allow-base-mismatch] [--skip-preflight]');
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
    console.log(formatGateRow(r));
    if (!r.passed && r.reasons && r.reasons.length) for (const reason of r.reasons) console.log('        ' + reason);
  }
  console.log(formatGateSummary(rows));
}

/*
 * 0064 (WC-47): подсказка о сдвиге HEAD называет фактические пути, чтобы агент
 * увидел свою причину. Запуск идёт тем же pipe-free git(), что и остальные
 * чтения; verifyLock остаётся чистым — diff считает вызывающий.
 */
function changedSinceContract(contractCommit) {
  if (!contractCommit) return [];
  const r = git(repo, ['diff', '--name-only', String(contractCommit), 'HEAD']);
  if (r.exitCode !== 0) return [];
  return r.stdout.split(/\r?\n/u).map((line) => line.trim()).filter(Boolean);
}

try {
  const { files, taskMd, meta, criteria } = readTask(taskDir);
  const lockCheck = verifyLock(repo, taskDir, meta, taskMd, criteria);
  if (!lockCheck.ok) {
    for (const e of lockCheck.errors) console.error('task-red: lock: ' + e);
    /* 0060 (WC-41): причина отказа видна в stdout, а не только в stderr. */
    if (argv.json) console.log(JSON.stringify({ ok: false, errors: lockCheck.errors.map((e) => 'lock: ' + e) }, null, 2));
    else for (const e of lockCheck.errors) console.log('task-red: lock: ' + e);
    /* 0060 (WC-40): сдвиг contractCommit объясняется порядком коммитов; 0064 (WC-47): с путями. */
    const hint = lockOrderHint(lockCheck, changedSinceContract(lockCheck.expected && lockCheck.expected.contractCommit));
    if (hint) {
      console.error(hint);
      if (!argv.json) console.log(hint);
    }
    process.exit(1);
  }

  const baseRef = String(argv.base || meta.base || 'HEAD');
  const base = git(repo, ['rev-parse', '--verify', baseRef + '^{commit}']);
  if (base.exitCode !== 0) {
    reportFatal('task-red', 'не разрешается base: ' + baseRef, { json: Boolean(argv.json) });
    process.exit(1);
  }
  const baseSha = base.stdout.trim();
  const head = git(repo, ['rev-parse', 'HEAD']);
  const headSha = head.exitCode === 0 ? head.stdout.trim() : '';
  if (lockCheck.expected.contractCommit !== headSha) {
    console.error('task-red: контракт закоммичен в ' + lockCheck.expected.contractCommit + ', а HEAD ' + headSha + '.');
    console.error('Красный прогон идёт только на контрактном коммите; после правки контракта перезапустите task-hash --write.');
    reportFatal('task-red', 'контракт закоммичен в ' + lockCheck.expected.contractCommit + ', а HEAD ' + headSha + '.', { stderr: false, json: Boolean(argv.json) });
    const hint = lockOrderHint(
      { errors: ['contractCommit: ожидалось ' + lockCheck.expected.contractCommit + ', сейчас ' + headSha] },
      changedSinceContract(lockCheck.expected.contractCommit),
    );
    if (hint) {
      console.error(hint);
      if (!argv.json) console.log(hint);
    }
    process.exit(1);
  }
  if (baseSha !== headSha && !argv['allow-base-mismatch']) {
    console.error('task-red: base (' + baseSha.slice(0, 12) + ') не совпадает с HEAD (' + headSha.slice(0, 12) + ').');
    console.error('Красный прогон должен идти на базовом коде: checkout base или --base HEAD. Для осознанного исключения — --allow-base-mismatch.');
    reportFatal('task-red', 'base (' + baseSha.slice(0, 12) + ') не совпадает с HEAD (' + headSha.slice(0, 12) + ').', { stderr: false, json: Boolean(argv.json) });
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
    reportFatal('task-red', 'high-risk задача не может использовать обход (--allow-dirty / --allow-base-mismatch).', { json: Boolean(argv.json) });
    process.exit(1);
  }
  if (unexpected.length && !argv['allow-dirty']) {
    console.error('task-red: рабочее дерево грязное вне разрешённых путей:');
    for (const p of unexpected) console.error('  ' + p);
    console.error('Красный прогон должен идти на закоммиченном контракте; допустимы только артефакты задания.');
    reportFatal('task-red', 'рабочее дерево грязное вне разрешённых путей: ' + unexpected.join(', '), { stderr: false, json: Boolean(argv.json) });
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
    reportFatal('task-red', 'setup завершился ошибкой; см. ' + files.redLog, { json: Boolean(argv.json) });
    process.exit(1);
  }

  /*
   * 0092 (WC-20): контракт до красного. mustPass по определению зелёные на базе;
   * если нет — красный прогон докажет ошибку контракта, а не поведение, и время
   * потрачено зря. Дешёвые mustPass идут первыми, дорогие не запускаются после
   * первого провала дешёвой.
   */
  if (argv['skip-preflight'] !== true) {
    const preflight = await preflightMustPass({ repo, criteria, env, log: (line) => logLine(line) });
    if (!preflight.empty) {
      console.log('preflight mustPass: ' + (preflight.ok ? 'зелёные на базе' : 'КРАСНЫЕ на базе')
        + (preflight.skipped.length ? ' (пропущено дорогих: ' + preflight.skipped.join(',') + ')' : ''));
    }
    if (!preflight.ok) {
      writeText(files.redLog, log.join(NL));
      if (argv.json === true) {
        console.log(JSON.stringify({ ok: false, code: 'contract-broken', preflight }, null, 2));
      } else {
        console.log('task-red: контракт сломан: mustPass не зелёный на базе — red не запускается.');
        console.log('Что сделать: починить контракт (mustPass должны проходить ДО работы) или --skip-preflight, если это осознанно.');
      }
      process.exit(1);
    }
  }

  /*
   * 0045 (WC-12): критерии идут пулом (runCriteria), а не суммой длительностей;
   * порядок строк, лог и вердикт прежние. setup/teardown остаются
   * последовательными и стоят вокруг пула.
   */
  const pooled = await runCriteria(criteria.criteria, {
    cwd: repo,
    env,
    timeoutMs: 120000,
    timeoutMultiplier: Number(argv['timeout-multiplier']) || 1,
  });
  const pooledById = new Map(pooled.map((r) => [r.id, r]));
  for (const c of criteria.criteria) {
    const id = String(c.id);
    if (isManual(c)) {
      logLine('## ' + id + ': MANUAL (пропущен)');
      continue;
    }
    const r = pooledById.get(id);
    if (!r) continue;
    const ev = evaluateExpectation(c.expect, r);
    const passed = ev.passed;
    /* 0057 (WC-35): дефект проверки фиксируется в results сразу — артефакт, а не догадка при печати. */
    const checkDefect = detectCheckDefect({ passed, stdout: r.stdout, stderr: r.stderr });
    results.push({ id, command: c.command, exitCode: r.exitCode, durationMs: r.durationMs, passed, timedOut: r.timedOut, reasons: ev.reasons, stdout: r.stdout, stderr: r.stderr, checkDefect });
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
   * F-6 (2.6.4) + 0057 (WC-35): причина красного — подстрока stdout+stderr, но
   * только в вердиктной зоне: последних redReasonWindow непустых строках вывода.
   * 0052 от structure: причина печатается в конце, поэтому совпадение в начале
   * вывода часто чужая, замаскированная причина. Одного «упал не по ожидаемой
   * причине» мало: непонятно, что пришло на самом деле, и разбирательство идёт
   * по red.log вручную. Печатаем ожидаемую причину, причину промаха окна, первые
   * строки stdout+stderr критерия и путь к red.log. Случай «критерий зелёный»
   * печатается тоже: задание ждало падения, и вывод — единственное доказательство
   * того, чего оно не дождалось.
   */
  const reasonWindow = redReasonWindow(criteria.redExpect);
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
    const match = matchRedReason(text, reason, reasonWindow);
    if (!result.passed && match.ok) continue;
    reasonDiagnostics.push({ id, reason, passed: result.passed, match, stdout: firstLines(result.stdout), stderr: firstLines(result.stderr) });
  }
  const redProven = redExpectation.ok;

  const output = {
    /* 0057 (WC-35): версия 5 — results несут checkDefect, redExpectation — дефекты и окно. */
    version: 5,
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

  /*
   * 0051: журнал вердиктов — одна строка на прогон, с причинами отказа каждого
   * критерия. Сбой журнала не валит ворота: WARN в stdout, код возврата прежний.
   */
  const journal = appendGateRecord(gateJournalFile(taskDir), gateRecord({
    kind: 'red',
    task: String(meta.id),
    head: headSha,
    criteria: gateCriteriaOf(results),
    verdict: redProven ? 'red-proven' : 'red-not-proven',
    bypasses,
    exitSummary: 'exit=' + (redProven ? 0 : 1) + '; failed=' + failed.length + '/' + executed,
  }));
  if (!journal.ok) console.log('WARN журнал ворот: ' + journal.error);

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
    if (redExpectation.checkDefects.length) {
      console.log('');
      console.log('Дефекты проверки (отказ самой проверки, а не проверяемого кода):');
      for (const defect of redExpectation.checkDefects) {
        console.log('  ' + defect.id + ': ' + defect.name + ': ' + defect.line);
      }
      console.log('  Красный не доказан: устраните ошибку в проверке, а не в реализации.');
    }
    if (reasonDiagnostics.length) {
      console.log('');
      console.log('Причины красного (вердиктная зона — последние ' + reasonWindow + ' непустых строк stdout+stderr):');
      for (const item of reasonDiagnostics) {
        if (item.passed) {
          console.log('  ' + item.id + ': ожидаемая причина не найдена в выводе: "' + item.reason + '"');
          console.log('  ' + item.id + ': критерий зелёный — падения не было');
        } else if (item.match.found) {
          console.log('  ' + item.id + ': причина «' + item.reason + '» найдена в строке ' + item.match.line
            + ' из ' + item.match.total + ' непустых — вне вердиктной зоны (окно ' + reasonWindow + ' непустых строк)');
          console.log('  ' + item.id + ': критерий упал, но причина напечатана выше зоны; reasonWindow расширяют осознанно, а не «чтобы прошло»');
        } else {
          console.log('  ' + item.id + ': ожидаемая причина не найдена в выводе: "' + item.reason + '"');
          console.log('  ' + item.id + ': критерий упал, но по другой причине');
        }
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
  else reportFatal('task-red', err.message);
  process.exit(err.exitCode || 1);
}
