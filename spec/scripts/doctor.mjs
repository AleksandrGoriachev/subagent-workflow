#!/usr/bin/env node
/*
 * Проверка готовности рабочего пространства и харнесса.
 * Ничего не меняет: только читает и запускает безопасные команды.
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { findRepoRoot, loadConfig, exists, readJson } from './lib/common.mjs';
import { detectActor, assessIndependence } from './actor.mjs';
import { loadAcceptors } from './sign.mjs';
import { policyOf, familyOf } from './lib/policy.mjs';

function args(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith('--')) { out[a.slice(2)] = next; i += 1; }
      else out[a.slice(2)] = true;
    } else out._.push(a);
  }
  return out;
}

const argv = args(process.argv.slice(2));
const repo = path.resolve(String(argv.repo || process.cwd()));
const checks = [];
function check(name, ok, detail, severity = 'fail') { checks.push({ name, ok, detail: detail || '', severity }); }

/*
 * Сколько заданий объявили risk: high. Ключ человека нужен только для них
 * (SPEC §11, I-18), поэтому совет про human-* не должен звучать в проекте,
 * где high-задач нет: иначе он читается как «не хватает внешнего приёмщика»
 * и уводит в поиск людей вместо работы.
 */
function countHighRiskTasks(tasksDir) {
  let count = 0;
  const walk = (dir) => {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) { walk(full); continue; }
      if (entry.name !== 'task.md') continue;
      try {
        if (/"risk"\s*:\s*"high"/.test(fs.readFileSync(full, 'utf8'))) count += 1;
      } catch {
        /* нечитаемый task.md не повод падать в докторе */
      }
    }
  };
  walk(tasksDir);
  return count;
}

const major = Number(String(process.versions.node).split('.')[0]);
check('Node.js >= 20', major >= 20, 'сейчас ' + process.versions.node);

const gitVersion = spawnSync('git', ['--version'], { encoding: 'utf8' });
check('git доступен', gitVersion.status === 0, (gitVersion.stdout || '').trim());

const root = findRepoRoot(repo);
check('git-репозиторий найден', Boolean(root), root || 'нет .git: выполните git init');
let config = null;
if (root) {
  config = loadConfig(root);
  check('workflow.config.json', config.loaded, config.file);
  /*
   * 2.6.0: битый блок actor.sources закрывает ворота, а не трактуется как
   * «источник не настроен». Иначе неизвестный вид (kind: "vendor") молча
   * выпал бы из цепочки, и честный проект получил бы отказ «без причины».
   */
  const sourceErrors = Array.isArray(config.actor.errors) ? config.actor.errors : [];
  if (sourceErrors.length > 0) check('источники актора в конфиге', false, sourceErrors.join('; '));
  const keysPath = path.join(root, config.keysFile);
  check('acceptors.json', exists(keysPath), keysPath);
  if (exists(keysPath)) {
    try {
      const list = loadAcceptors(keysPath);
      const bad = list.filter((key) => !String(key.keyId).startsWith(key.kind + '-'));
      check('ключи: kind совпадает с префиксом', bad.length === 0, bad.map((key) => key.keyId).join(', '));
      const highTasks = countHighRiskTasks(path.join(root, String(config.tasksDir || 'docs/tasks')));
      check('ключи: human-* для high-risk', !highTasks || list.some((key) => key.kind === 'human'),
        highTasks
          ? 'задач risk: high: ' + highTasks + ' — без ключа human-* они не принимаются'
          : 'задач risk: high нет — ключ human-* не нужен',
        'warn');
    } catch (err) {
      check('acceptors.json читается', false, err.message);
    }
  }
  for (const file of ['templates/task.md', 'templates/criteria.json', 'scripts/task-accept.mjs', 'scripts/task-attack.mjs']) {
    check('есть ' + file, exists(path.join(root, 'docs/subagent-workflow', file)));
  }

  /*
   * Политика и роли — часть конфигурации, поэтому доктор их печатает: иначе
   * непонятно, что именно включено в этом репозитории.
   */
  const policy = policyOf(config);
  check('политика ворот', true, 'decisions=' + policy.decisions + ', coverage=' + policy.coverage + ', attack=' + policy.attack + ', modelFamily=' + policy.roles.modelFamily);
  for (const [role, spec] of Object.entries(config.roles || {})) {
    if (!spec || typeof spec !== 'object') continue;
    const model = String(spec.model || '');
    if (!model) { check('роль ' + role, false, 'нет model', 'warn'); continue; }
    const family = familyOf(config, model);
    check('роль ' + role, true, model + ' / ' + (family || 'семейство не объявлено') + (spec.mustDifferFromIssuer ? ', должна отличаться: ' + spec.mustDifferFromIssuer : ''));
  }
}

/*
 * Актор читается с конфигом: настроенный источник (runner, ci, manual) обязан
 * быть виден так же, как DSH. Без конфига честный проект вне DSH получал FAIL,
 * хотя всё настроил (дефект, ради которого выпущена 2.6.0).
 */
const actor = detectActor(process.env, config ? config.actor : {});
const independence = assessIndependence({ actor, issuedBy: null, executorSession: null, risk: 'medium' });
check('актор виден окружению', actor.attestedBy === 'env',
  (actor.source || 'нет источника') + ' (' + (actor.sourceKind || 'none') + ') / ' + (actor.session || 'нет сессии'));
check('medium возможен в этой сессии', independence.ok, independence.errors.join('; '));

if (argv.json) console.log(JSON.stringify({ repo, checks }, null, 2));
else {
  for (const item of checks) {
    const mark = item.ok ? 'PASS' : item.severity === 'warn' ? 'WARN' : 'FAIL';
    console.log(mark.padEnd(6) + item.name + (item.detail ? '  — ' + item.detail : ''));
  }
  const failed = checks.filter((item) => !item.ok && item.severity !== 'warn').length;
  const warned = checks.filter((item) => !item.ok && item.severity === 'warn').length;
  console.log('');
  console.log(failed ? 'DOCTOR: ' + failed + ' проблем' : 'DOCTOR OK' + (warned ? ' (предупреждений: ' + warned + ')' : ''));
}
process.exit(checks.some((item) => !item.ok && item.severity !== 'warn') ? 1 : 0);
