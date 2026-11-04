#!/usr/bin/env node
import path from 'node:path';
import {
  parseArgv, readTask, verifyLock, repoRoot, diffPaths, matchesAny, relPosix,
  runCommand, runCriteria, evaluateExpectation, isManual, stableResults, writeJson, writeText,
  formatGateRow, formatGateSummary, computeWorktreeDigest, readDiffText, scanSecrets, exists, readJson,
  checkContractCommitted, computeCoverage, loadConfig, evaluateEffects,
  gateRecord, gateCriteriaOf, gateJournalFile, appendGateRecord, lockOrderHint, reportFatal,
} from './lib/common.mjs';
import { policyOf, applyLevel } from './lib/policy.mjs';

const NL = String.fromCharCode(10);
const argv = parseArgv(process.argv.slice(2));
if (argv.help) {
  console.log('Usage: node task-verify.mjs --task <dir> [--repo <dir>] [--json] [--allow-manual] [--allow-missing-red]');
  console.log('--allow-missing-red допустим только для risk=low и записывается в артефакты.');
  process.exit(0);
}

const taskDir = path.resolve(argv.task || argv._[0] || '.');
const repo = path.resolve(argv.repo || repoRoot(taskDir));
/* Ключ приёмщика не должен попадать в код задачи, который мы запускаем. */
delete process.env.TASK_ACCEPT_KEY;

function fail(message) { reportFatal('task-verify', message, { json: Boolean(argv.json) }); process.exit(1); }

function printSummary(title, rows) {
  console.log(title);
  for (const r of rows) {
    console.log(formatGateRow(r));
    if (!r.passed && r.reasons && r.reasons.length) for (const reason of r.reasons) console.log('        ' + reason);
  }
  console.log(formatGateSummary(rows));
}

try {
  const { files, taskMd, meta, criteria } = readTask(taskDir);
  const lockCheck = verifyLock(repo, taskDir, meta, taskMd, criteria);
  if (!lockCheck.ok) {
    for (const e of lockCheck.errors) console.error('task-verify: lock: ' + e);
    /* 0060 (WC-41): причина отказа видна в stdout, а не только в stderr. */
    if (argv.json) console.log(JSON.stringify({ ok: false, errors: lockCheck.errors.map((e) => 'lock: ' + e) }, null, 2));
    else for (const e of lockCheck.errors) console.log('task-verify: lock: ' + e);
    /* 0060 (WC-40): сдвиг contractCommit объясняется порядком коммитов. */
    const hint = lockOrderHint(lockCheck);
    if (hint) {
      console.error(hint);
      if (!argv.json) console.log(hint);
    }
    process.exit(1);
  }
  const headSha = lockCheck.expected.contractCommit;
  const taskRel = relPosix(repo, taskDir);
  const bypasses = { allowMissingRed: false, allowManual: false };
  let red = null;

  if (exists(files.red)) {
    red = readJson(files.red);
    /* 0058 (WC-35): task-red пишет текущий формат 5, исторические артефакты — 4; остальные номера отвергаем. */
    if (red.version !== 4 && red.version !== 5) {
      fail('red.json: версия ' + red.version + ' неизвестна — принимаются версии 4 (исторические записи) и 5 (текущий формат); перезапустите task-red');
    }
    if (!red.redProven) fail('red.json: redProven=false — красный не доказан');
    if (red.redExpectation && red.redExpectation.ok !== true) fail('red.json: красный не совпал с redExpect');
    if (red.baseSha !== headSha) fail('HEAD изменился после красного прогона (' + red.baseSha + ' -> ' + headSha + '); коммит исполнителя запрещён, перезапустите task-red');
    if (red.contractCommit !== lockCheck.expected.contractCommit) fail('red.json относится к другому контракту');
    if (red.criteriaJsonSha256 !== lockCheck.expected.criteriaJsonSha256) fail('criteria.json изменился после красного прогона');
  } else if (meta.risk !== 'low') {
    fail('нет red.json — для risk=' + meta.risk + ' красный обязателен; обхода для medium/high нет');
  } else if (!argv['allow-missing-red']) {
    fail('нет red.json — для risk=low укажите --allow-missing-red; обход будет записан в verify.json и acceptance.json');
  } else {
    bypasses.allowMissingRed = true;
  }

  const allowedDiff = [
    ...(Array.isArray(meta.allowedPaths) ? meta.allowedPaths : []),
    ...(Array.isArray(meta.protectedPaths) ? meta.protectedPaths : []),
    taskRel + '/**',
  ];
  const changedBefore = diffPaths(repo, headSha);
  const outsideBefore = changedBefore.filter((p) => !matchesAny(p, allowedDiff));
  if (outsideBefore.length) {
    console.error('task-verify: изменения вне разрешённых путей:');
    for (const p of outsideBefore) console.error('  ' + p);
    console.error('Разрешено: ' + allowedDiff.join(', '));
    reportFatal('task-verify', 'изменения вне разрешённых путей: ' + outsideBefore.join(', '), { stderr: false, json: Boolean(argv.json) });
    process.exit(1);
  }

  const env = { TASK_ID: String(meta.id), TASK_DIR: taskDir, REPO_ROOT: repo, TASK_RUN: 'verify', NO_COLOR: '1' };
  const log = [];
  const results = [];
  const logLine = (s) => { log.push(s); };
  logLine('# task-verify ' + meta.id);
  logLine('# head ' + headSha);
  logLine('# contract ' + lockCheck.expected.contractCommit);
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
    writeText(files.verifyLog, log.join(NL));
    reportFatal('task-verify', 'setup завершился ошибкой; см. ' + files.verifyLog, { json: Boolean(argv.json) });
    process.exit(1);
  }

  /*
   * 0045 (WC-12): критерии идут пулом (runCriteria), а не суммой длительностей;
   * порядок строк, лог, счёт manual и вердикт прежние. setup/teardown остаются
   * последовательными и стоят вокруг пула.
   */
  const pooled = await runCriteria(criteria.criteria, { cwd: repo, env, timeoutMs: 120000 });
  const pooledById = new Map(pooled.map((r) => [r.id, r]));
  let manualSkipped = 0;
  for (const c of criteria.criteria) {
    const id = String(c.id);
    if (isManual(c)) { manualSkipped += 1; logLine('## ' + id + ': MANUAL (пропущен)'); continue; }
    const r = pooledById.get(id);
    if (!r) continue;
    const ev = evaluateExpectation(c.expect, r);
    results.push({ id, command: c.command, exitCode: r.exitCode, durationMs: r.durationMs, passed: ev.passed, timedOut: r.timedOut, reasons: ev.reasons, stdout: r.stdout, stderr: r.stderr });
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

  /*
   * Границы и секреты проверяются ещё раз ПОСЛЕ критериев: setup, тест или
   * teardown может создать файл вне allowlist. Раньше такой файл попадал в
   * кандидатный коммит, хотя в changedPaths его не было.
   */
  const changed = diffPaths(repo, headSha);
  const outside = changed.filter((p) => !matchesAny(p, allowedDiff));
  const contractAfter = checkContractCommitted(repo, taskDir, meta);
  const diffText = readDiffText(repo, headSha);
  const secrets = scanSecrets(diffText);
  const violations = [];
  for (const p of outside) violations.push('файл вне allowedPaths: ' + p);
  for (const e of contractAfter.errors) violations.push('контракт: ' + e);
  for (const s of secrets) violations.push('похоже на секрет (' + s.name + ') строка ' + s.line);

  /*
   * Покрытие (2.1.0): зелёный критерий ничего не говорит о файлах, для которых
   * критерия нет. Каждый изменённый файл кода обязан попасть под covers одного
   * из критериев; документация и артефакты задания исключены.
   */
  const coverage = computeCoverage(meta, criteria, changed, taskRel);
  const config = loadConfig(repo);
  const policy = policyOf(config);
  const coverageIssues = [];
  if (coverage.declared === 0 && meta.risk !== 'low') {
    coverageIssues.push('ни один критерий не объявляет covers: изменённый код не сопоставлен с проверками');
  }
  for (const p of coverage.uncovered) coverageIssues.push('изменённый файл не покрыт ни одним критерием: ' + p);
  const coverageApplied = applyLevel(policy.coverage, coverageIssues);
  violations.push(...coverageApplied.errors);
  const coverageWarnings = coverageApplied.warnings;

  /*
   * Эффект (I-31, 2.3.1): прогон сам проверяет, что у критерия с влиянием на
   * пользователя есть измеряемый эффект, и записывает его в verify.json — иначе
   * доказательство эффекта видно только в момент lint.
   */
  const effectCheck = evaluateEffects(meta, criteria);
  const effectApplied = applyLevel(policy.decisions, effectCheck.issues);
  violations.push(...effectApplied.errors);
  const effectWarnings = effectApplied.warnings;
  for (const warning of effectWarnings) coverageWarnings.push('effect: ' + warning);

  const failed = results.filter((r) => !r.passed);
  if (manualSkipped > 0 && argv['allow-manual']) bypasses.allowManual = true;
  const executedOrManual = results.length > 0 || (manualSkipped > 0 && Boolean(argv['allow-manual']));
  const allPassed = failed.length === 0 && executedOrManual
    && (manualSkipped === 0 || Boolean(argv['allow-manual']))
    && violations.length === 0;
  const worktreeDigest = computeWorktreeDigest(repo, taskDir, meta);

  for (const violation of violations) logLine('VIOLATION ' + violation);
  for (const warning of coverageWarnings) logLine('WARN ' + warning);

  const output = {
    version: 4,
    kind: 'verify',
    acceptanceNonce: process.env.TASK_ACCEPT_NONCE || null,
    runKind: process.env.TASK_ACCEPT_RUN || 'self',
    task: String(meta.id),
    createdAt: new Date().toISOString(),
    headSha,
    contractCommit: lockCheck.expected.contractCommit,
    criteriaSha256: lockCheck.expected.criteriaSha256,
    criteriaJsonSha256: lockCheck.expected.criteriaJsonSha256,
    taskFileSha256: lockCheck.expected.taskFileSha256,
    changedPaths: changed,
    coverage: { ...coverage, mode: policy.coverage, warnings: coverageWarnings },
    effects: {
      required: effectCheck.required,
      checked: effectCheck.checked,
      mode: policy.decisions,
      declared: effectCheck.effects,
      links: effectCheck.links,
      ok: effectCheck.consistencyIssues.length === 0,
    },
    results: stableResults(results),
    executed: results.length,
    failed: failed.length,
    manualSkipped,
    allPassed,
    violations,
    bypasses,
    red: red
      ? {
          baseSha: red.baseSha,
          contractCommit: red.contractCommit,
          criteriaJsonSha256: red.criteriaJsonSha256,
          failed: red.failed,
          failedIds: red.failedIds,
          redExpectation: red.redExpectation || null,
          bypasses: red.bypasses || {},
          log: red.log,
        }
      : null,
    worktreeDigest,
    log: path.basename(files.verifyLog),
  };
  writeJson(files.verify, output);
  writeText(files.verifyLog, log.join(NL));

  /*
   * 0051: журнал вердиктов — одна строка на прогон, с причинами отказа каждого
   * критерия. Digest дерева журнал не задевает: каталог задания исключён из
   * computeWorktreeDigest. Сбой журнала не валит ворота: WARN, код возврата прежний.
   */
  const journal = appendGateRecord(gateJournalFile(taskDir), gateRecord({
    kind: 'verify',
    task: String(meta.id),
    head: headSha,
    criteria: gateCriteriaOf(results),
    verdict: allPassed ? 'passed' : 'failed',
    bypasses,
    exitSummary: 'exit=' + (allPassed ? 0 : 1) + '; failed=' + failed.length + '/' + results.length
      + (violations.length ? '; violations=' + violations.length : ''),
  }));
  if (!journal.ok) console.log('WARN журнал ворот: ' + journal.error);

  if (argv.json) {
    console.log(JSON.stringify(output, null, 2));
  } else {
    printSummary('task-verify: ' + meta.id, results);
    console.log('');
    if (violations.length) {
      console.log('Нарушения после прогона:');
      for (const v of violations) console.log('  ' + v);
    }
    if (allPassed) console.log('Все проверки зелёные. Digest дерева: ' + worktreeDigest);
    else if (failed.length) console.log('Провалено ' + failed.length + ' из ' + results.length + ' проверок.');
    else if (violations.length) console.log('Проверки прошли, но ворота границ/секретов/контракта не пройдены.');
    else if (manualSkipped) console.log('Есть manual-проверки (' + manualSkipped + '), нужен --allow-manual или ручная приёмка.');
    else console.log('Нет исполняемых проверок.');
    console.log('Артефакты: ' + files.verify + ', ' + files.verifyLog);
  }
  process.exit(allPassed ? 0 : 1);
} catch (err) {
  if (argv.json) console.log(JSON.stringify({ ok: false, errors: [err.message] }, null, 2));
  else reportFatal('task-verify', err.message);
  process.exit(err.exitCode || 1);
}
