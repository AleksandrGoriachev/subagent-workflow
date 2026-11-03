#!/usr/bin/env node
import path from 'node:path';
import {
  parseArgv, readTask, computeLock, verifyLock, writeJson, exists, repoRoot, taskFiles,
  checkContractCommitted, sameLockContract, readJson, loadConfig,
  fail, toPosix, contractSnapshot, protectedManifest, relockAllowed,
} from './lib/common.mjs';
import { policyOf, applyLevel } from './lib/policy.mjs';
import { evaluateAttack } from './lib/attack.mjs';

const argv = parseArgv(process.argv.slice(2));
if (argv.help) {
  console.log('Usage: node task-hash.mjs --task <dir> [--repo <dir>] [--write|--verify|--relock --reason "<текст>"] [--json]');
  console.log('Контракт (task.md, criteria.json, защищённые файлы) должен быть закоммичен до --write.');
  console.log('--relock --reason "<текст>": после доказанного красного разрешена правка границ (allowedPaths,');
  console.log('protectedPaths, redAllowDirty) и покрытия (covers, tags); команды, ожидания и набор критериев');
  console.log('не меняются — для них нужен новый номер задания.');
  process.exit(0);
}

const taskDir = path.resolve(argv.task || argv._[0] || '.');
const repo = path.resolve(argv.repo || repoRoot(taskDir));

try {
  const { files, taskMd, meta, criteria } = readTask(taskDir);
  const contract = checkContractCommitted(repo, taskDir, meta);
  if (!contract.ok) {
    if (argv.json) {
      console.log(JSON.stringify({ ok: false, errors: contract.errors }, null, 2));
    } else {
      console.error('task-hash: контракт задания не зафиксирован в git:');
      for (const error of contract.errors) console.error('  ERROR ' + error);
      console.error('Сначала закоммитьте task.md, criteria.json и защищённые проверки; иначе их можно переписать после выдачи.');
    }
    process.exit(1);
  }

  const current = computeLock(repo, taskDir, meta, taskMd, criteria, contract.contractCommit);

  /*
   * Re-lock (2.6.18, 0050): правка границ и покрытия после доказанного красного
   * без нового номера задания.
   *
   * Разрешено ровно то, что не меняет смысл проверки: allowedPaths,
   * protectedPaths, redAllowDirty в TASK-META и covers/tags у критериев.
   * Команда, ожидание, id/cwd/timeoutMs, число и порядок критериев — отказ: это
   * новый номер задания. criteriaSha256 (блок критериев в task.md) не меняется
   * никогда — если он сдвинулся, re-lock тоже отказ.
   *
   * Красный прогон обязателен и уже доказан: re-lock — не способ обойти
   * "после красного только новый номер", а способ не платить за это 20–30 минут,
   * когда исполнителю не хватило границы allowedPaths (0046→0054).
   */
  if (argv.relock) {
    if (argv.write || argv.verify) fail('--relock не сочетается с --write/--verify: это отдельный режим');
    const reason = typeof argv.reason === 'string' ? argv.reason.trim() : '';
    if (reason === '') fail('--relock требует --reason "<почему контракт правится после красного>"');
    if (!exists(files.red)) fail('--relock разрешён только после красного прогона: нет ' + files.red);
    const red = readJson(files.red);
    if (red.redProven !== true) {
      fail('--relock разрешён только при доказанном красном: в red.json redProven=' + JSON.stringify(red.redProven) + ', нужен новый прогон task-red');
    }
    if (!exists(files.lock)) fail('--relock: нет ' + files.lock + ' — сначала task-hash --write до красного');
    const previous = readJson(files.lock);
    if (!previous || typeof previous !== 'object' || Array.isArray(previous)) fail('--relock: criteria.lock не объект');
    if (!previous.contract || typeof previous.contract !== 'object' || Array.isArray(previous.contract)) {
      fail('--relock: в criteria.lock нет снимка контракта (contract) — замок записан версией до 2.6.18; '
        + 'без снимка перезамок неотличим от подмены критериев, нужен новый номер задания');
    }
    if (previous.criteriaSha256 !== current.criteriaSha256) {
      fail('--relock: смысл критериев изменился (criteriaSha256 ' + previous.criteriaSha256 + ' → ' + current.criteriaSha256
        + '): блок критериев в task.md после красного не правится — это новый номер задания');
    }
    const nextContract = contractSnapshot(meta, criteria.criteria);
    const verdict = relockAllowed(previous.contract, nextContract);
    if (!verdict.ok) {
      if (argv.json) console.log(JSON.stringify({ ok: false, errors: [verdict.reason], changed: verdict.changed }, null, 2));
      else console.error('task-hash: ' + verdict.reason);
      process.exit(1);
    }
    /*
     * Манифест protected не пересчитывается: хеши защищённых файлов остаются
     * теми, что заперты до красного, — иначе re-lock стал бы способом добавить
     * в замок новый «защищённый» файл или тихо его снять. Меняется только
     * политика манифеста: движок (docs/subagent-workflow/**) вне замка, если
     * задание не объявило locksEngine, — иначе деплой пакета краснит чужой замок.
     */
    const previousProtected = Array.isArray(previous.protected) ? previous.protected : [];
    const previousHashMap = new Map(
      previousProtected
        .filter((entry) => entry && typeof entry.path === 'string')
        .map((entry) => [toPosix(entry.path), entry.sha256]),
    );
    const keptPaths = protectedManifest([...previousHashMap.keys()], { locksEngine: meta.locksEngine === true });
    const protectedKept = keptPaths.map((file) => ({ path: file, sha256: previousHashMap.get(file) }));
    const relock = {
      at: new Date().toISOString(),
      by: String(
        argv.by
        || process.env.DSH_SESSION_ID
        || process.env.TASK_ACTOR_SESSION
        || process.env.WF_ACTOR_SESSION
        || 'unknown',
      ),
      reason,
      before: {
        criteriaJsonSha256: previous.criteriaJsonSha256 === undefined ? null : previous.criteriaJsonSha256,
        taskFileSha256: previous.taskFileSha256 === undefined ? null : previous.taskFileSha256,
      },
      after: {
        criteriaJsonSha256: current.criteriaJsonSha256,
        taskFileSha256: current.taskFileSha256,
      },
    };
    const relocked = {
      ...previous,
      taskFileSha256: current.taskFileSha256,
      criteriaJsonSha256: current.criteriaJsonSha256,
      contractCommit: current.contractCommit,
      protected: protectedKept,
      contract: nextContract,
      relock,
    };
    writeJson(files.lock, relocked);
    const dropped = previousProtected.length - protectedKept.length;
    if (argv.json) {
      console.log(JSON.stringify({ ok: true, relocked: files.lock, changed: verdict.changed, lock: relocked }, null, 2));
    } else {
      console.log('task-hash: re-lock принят (' + meta.id + ')');
      console.log('  reason    ' + reason);
      console.log('  changed   ' + (verdict.changed.length ? verdict.changed.join(', ') : 'контракт без изменений'));
      console.log('  criteria  ' + relocked.criteriaSha256 + ' (не изменился)');
      console.log('  contract  ' + relocked.contractCommit);
      console.log('  protected ' + relocked.protected.length + ' файл(ов)');
      if (dropped > 0) console.log('  engine    ' + dropped + ' файл(ов) движка вне замка (locksEngine=false)');
      console.log('  lock      ' + files.lock);
      console.log('Дальше: task-red (смысл критериев тот же, хеши контракта новые), затем task-verify.');
    }
    process.exit(0);
  }

  if (argv.verify) {
    const check = verifyLock(repo, taskDir, meta, taskMd, criteria);
    if (argv.json) console.log(JSON.stringify({ ok: check.ok, errors: check.errors, current }, null, 2));
    else {
      console.log('task-hash: ' + (check.ok ? 'lock совпадает' : 'lock НЕ совпадает'));
      for (const e of check.errors) console.log('  ERROR ' + e);
    }
    process.exit(check.ok ? 0 : 1);
  }

  if (argv.write) {
    /*
     * После красного прогона критерии и проверки заморожены. Перезамок с другим
     * содержимым — попытка подменить проверки под результат, а не правка задания.
     */
    if (exists(files.red)) {
      const red = readJson(files.red);
      const previous = exists(files.lock) ? readJson(files.lock) : null;
      if (red.redProven && previous && !sameLockContract(previous, current)) {
        const errors = ['контракт изменился после красного прогона; критерии и проверки заморожены'];
        if (argv.json) console.log(JSON.stringify({ ok: false, errors }, null, 2));
        else {
          console.error('task-hash: ' + errors[0]);
          console.error('Нужна новая версия задания: новый каталог/ID, новый красный прогон. Перезапись criteria.lock после красного запрещена.');
        }
        process.exit(1);
      }
    }
    /*
     * Атака спецификации (2.2.0): блокирующие находки закрываются до замка, иначе
     * контракт замерзает с известной дырой. Уровень строгости — policy.attack.
     */
    const config = loadConfig(repo);
    const policy = policyOf(config);
    const attackFile = path.join(taskDir, 'attack.json');
    const attackErrors = [];
    const attackWarnings = [];
    if (exists(attackFile)) {
      const check = evaluateAttack(readJson(attackFile), { meta, config });
      const applied = applyLevel(policy.attack, check.issues);
      const family = applyLevel(policy.roles.modelFamily, check.familyIssues);
      attackErrors.push(...applied.errors, ...family.errors);
      attackWarnings.push(...applied.warnings, ...family.warnings);
    } else if (policy.attack === 'fail' && meta.risk !== 'low') {
      attackErrors.push('нет attack.json: атака спецификации не проводилась (policy.attack=fail)');
    }
    if (attackErrors.length) {
      if (argv.json) console.log(JSON.stringify({ ok: false, errors: attackErrors, warnings: attackWarnings }, null, 2));
      else {
        console.error('task-hash: атака спецификации не пропускает замок:');
        for (const error of attackErrors) console.error('  ERROR ' + error);
        console.error('Проведите атаку (task-attack --prompt), устраните blocking-находки и повторите --write.');
      }
      process.exit(1);
    }
    for (const warning of attackWarnings) console.error('task-hash: WARN ' + warning);
    writeJson(files.lock, current);
    if (argv.json) console.log(JSON.stringify({ ok: true, written: files.lock, lock: current }, null, 2));
    else {
      console.log('task-hash: записан ' + files.lock);
      console.log('  contract  ' + current.contractCommit);
      console.log('  criteria  ' + current.criteriaSha256);
      console.log('  manifest  ' + current.criteriaJsonSha256);
      console.log('  protected ' + current.protected.length + ' файл(ов)');
    }
    process.exit(0);
  }

  const check = exists(files.lock) ? verifyLock(repo, taskDir, meta, taskMd, criteria) : { ok: false, errors: ['lock отсутствует'] };
  if (argv.json) {
    console.log(JSON.stringify({ task: meta.id, lockMatches: check.ok, errors: check.errors, current }, null, 2));
  } else {
    console.log('task-hash: ' + meta.id);
    console.log('  contract  ' + current.contractCommit);
    console.log('  criteria  ' + current.criteriaSha256);
    console.log('  manifest  ' + current.criteriaJsonSha256);
    console.log('  protected ' + current.protected.length + ' файл(ов)');
    console.log('  lock      ' + (check.ok ? 'совпадает' : 'НЕ совпадает: ' + check.errors.join('; ')));
  }
  process.exit(check.ok ? 0 : 1);
} catch (err) {
  if (argv.json) console.log(JSON.stringify({ ok: false, errors: [err.message] }, null, 2));
  else console.error('task-hash: ' + err.message);
  process.exit(err.exitCode || 1);
}
