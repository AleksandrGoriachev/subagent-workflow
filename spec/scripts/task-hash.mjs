#!/usr/bin/env node
import path from 'node:path';
import {
  parseArgv, readTask, computeLock, verifyLock, writeJson, exists, repoRoot, taskFiles,
  checkContractCommitted, sameLockContract, readJson,
} from './lib/common.mjs';

const argv = parseArgv(process.argv.slice(2));
if (argv.help) {
  console.log('Usage: node task-hash.mjs --task <dir> [--repo <dir>] [--write|--verify] [--json]');
  console.log('Контракт (task.md, criteria.json, защищённые файлы) должен быть закоммичен до --write.');
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
