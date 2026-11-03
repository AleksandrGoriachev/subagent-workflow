#!/usr/bin/env node
/*
 * Проверка готовности рабочего пространства и харнесса.
 * Ничего не меняет: только читает и запускает безопасные команды.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { findRepoRoot, loadConfig, exists, readJson } from './lib/common.mjs';
import { detectActor, assessIndependence } from './actor.mjs';
import { loadAcceptors, publicKeyFingerprint } from './sign.mjs';
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
/*
 * 2.6.16 (0042): панель спавнит проверки в процессе DSH-хоста, где нет
 * DSH_SESSION_ID. Маркер контекста ставит plugin/lib/checks.js. Без него
 * вердикт прежний: доктор, запущенный руками, по-прежнему честно краснеет.
 */
const PANEL_CONTEXT = String(process.env.WF_CHECK_CONTEXT || '').trim().toLowerCase() === 'panel';
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

/*
 * 0036: заранее видно, каким закреплённым ключом приёмка невозможна. Приватный
 * ключ живёт в двух штатных каталогах: <repo>/.wf-keys (ключ проекта,
 * init --key-out .wf-keys) и ~/.wf-keys (ключ приёмщика по умолчанию, init без
 * --key-out). Сравнение — по отпечатку SPKI, а не по имени файла: файл с нужным
 * именем и чужим ключом даёт отказ уже на подписи, и обещать его как
 * подписываемый было бы ложью.
 */
const PRIVATE_KEY_NAME = /\.key\.pem$/i;

function readPrivateKeys(dirs) {
  const keys = [];
  const badFiles = [];
  const seen = new Set();
  for (const dir of dirs) {
    const resolved = path.resolve(dir);
    if (seen.has(resolved)) continue;
    seen.add(resolved);
    let entries;
    try { entries = fs.readdirSync(resolved, { withFileTypes: true }); } catch { continue; }
    for (const entry of entries) {
      if (!entry.isFile() || !PRIVATE_KEY_NAME.test(entry.name)) continue;
      const file = path.join(resolved, entry.name);
      const keyId = entry.name.replace(PRIVATE_KEY_NAME, '');
      try {
        /* createPrivateKey первым: публичный PEM в файле *.key.pem — не ключ подписи. */
        const publicKey = crypto.createPublicKey(crypto.createPrivateKey(fs.readFileSync(file, 'utf8')));
        const publicKeyPem = publicKey.export({ type: 'spki', format: 'pem' }).toString();
        keys.push({ file, keyId, fingerprint: publicKeyFingerprint(publicKeyPem) });
      } catch {
        badFiles.push(file);
      }
    }
  }
  return { keys, badFiles };
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

      /*
       * 0036: доктор обязан заранее сказать, каким закреплённым ключом приёмка
       * невозможна, — иначе это выясняется уже на подписи, после красного
       * прогона. Приватный ключ ищется только там, где его кладёт сам пакет
       * (init: <repo>/.wf-keys или ~/.wf-keys); путь --key в task-accept
       * произвольный, поэтому «каталогов нет вовсе» — не повод поднимать
       * тревогу: ключи могут лежать вне штатных мест.
       * Сравнение — по отпечатку, а не по имени файла: ключ с нужным именем и
       * чужим содержимым отклоняется на подписи, и обещать его как
       * подписываемый нельзя.
       */
      const home = process.env.USERPROFILE || process.env.HOME || os.homedir();
      const keyDirs = [];
      for (const dir of [path.join(root, '.wf-keys'), path.join(home, '.wf-keys')]) {
        if (!keyDirs.some((known) => path.resolve(known) === path.resolve(dir))) keyDirs.push(dir);
      }
      const keyDirsExist = keyDirs.some((dir) => { try { return fs.statSync(dir).isDirectory(); } catch { return false; } });
      const { keys: privateKeys, badFiles } = readPrivateKeys(keyDirs);
      const pins = list.filter((key) => !key.revokedAt);
      const unreadablePins = [];
      const signable = [];
      const unusable = [];
      for (const pin of pins) {
        let fingerprint;
        try { fingerprint = publicKeyFingerprint(pin.publicKeyPem); }
        catch { unreadablePins.push(pin.keyId); continue; }
        const byFingerprint = privateKeys.find((key) => key.fingerprint === fingerprint);
        if (byFingerprint) { signable.push({ pin, key: byFingerprint }); continue; }
        const byName = privateKeys.find((key) => key.keyId === pin.keyId);
        unusable.push({ pin, key: byName || null });
      }
      const mismatched = unusable.filter((item) => item.key);
      const absent = unusable.filter((item) => !item.key).map((item) => item.pin);
      if (unreadablePins.length > 0) {
        check('ключи: публичный ключ читается', false,
          'не читается: ' + unreadablePins.join(', ') + ' — подпись по такому пину не проверить', 'warn');
      }
      if (signable.length + unusable.length > 0) {
        if (unusable.length === 0) {
          check('ключи: приватный для закреплённого', true,
            'приватные ключи на месте: ' + signable.map((item) => item.pin.keyId).join(', '));
        } else if (signable.length === 0 && absent.length === unusable.length && keyDirsExist) {
          check('ключи: приватный для закреплённого', false,
            'ни один закреплённый ключ не имеет приватного: искал ' + keyDirs.join(', ')
              + ' — подписывать нечем, приёмка невозможна (закреплены: ' + absent.map((pin) => pin.keyId).join(', ') + ')');
        } else if (signable.length === 0 && !keyDirsExist) {
          check('ключи: приватный для закреплённого', true,
            'штатных каталогов ключей нет (' + keyDirs.join(', ') + '): ключи могут лежать вне их — подпись проверит task-accept');
        } else {
          /*
           * 0037: «подписывать можно: никаким из штатных каталогов» — противоречие:
           * список назван, но пуст. Если пригодного ключа нет, доктор говорит прямо,
           * что закреплённым ключом подписывать нечем, и называет единственный
           * рабочий путь — явную передачу ключа в --key. Три состояния различаются:
           * есть пригодный (здесь ветка signable > 0), нет вовсе (FAIL выше),
           * нужного отпечатка нет (WARN, exit 0).
           */
          const stillUnusable = unusable.map((item) => item.pin.keyId).join(', ');
          const wrongKey = mismatched.length > 0
            ? '; отпечаток ' + mismatched.map((item) => path.basename(item.key.file)).join(', ')
              + ' не совпадает с закреплённым — таким ключом подпись отклонят'
            : '';
          const detail = signable.length > 0
            ? 'без приватного ключа: ' + stillUnusable
              + ' — подписывать можно: ' + signable.map((item) => item.pin.keyId).join(', ') + wrongKey
            : 'без приватного ключа: ' + stillUnusable
              + ' — закреплённым ключом подписывать нечем: приватного с нужным отпечатком нет;'
              + ' ключ можно передать явно в --key' + wrongKey;
          check('ключи: приватный для закреплённого', false, detail, 'warn');
        }
      }
      const usedFiles = new Set([...signable, ...mismatched].map((item) => item.key.file));
      const orphanKeys = privateKeys.filter((key) => !usedFiles.has(key.file));
      if (orphanKeys.length > 0) {
        check('ключи: лишний приватный', false,
          'приватный ключ не соответствует ни одному закреплённому: ' + orphanKeys.map((key) => path.basename(key.file)).join(', ')
            + ' — подписывать им нечего', 'warn');
      }
      if (badFiles.length > 0) {
        check('ключи: приватный ключ читается', false,
          'файл не читается как приватный ключ: ' + badFiles.map((file) => path.basename(file)).join(', '), 'warn');
      }
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
const actorVisible = actor.attestedBy === 'env';
/*
 * 2.6.16 (0042): в контексте панели отсутствие сессии — свойство процесса, а не
 * дефект воркспейса. Та же проверка остаётся WARN с прямым объяснением и не
 * валит выход; вне панели (маркера нет) это по-прежнему FAIL.
 */
check('актор виден окружению', actorVisible,
  (actor.source || 'нет источника') + ' (' + (actor.sourceKind || 'none') + ') / ' + (actor.session || 'нет сессии')
    + (PANEL_CONTEXT && !actorVisible
      ? ' — проверка запущена из панели: в процессе панели сессии агента нет'
      : ''),
  PANEL_CONTEXT && !actorVisible ? 'warn' : 'fail');
/*
 * 2.6.2: «актор не виден» без рецепта читается как поломка движка, хотя лечится
 * настройкой. Строка WARN только подсказывает и не меняет вердикт: FAIL выше и
 * отказ medium остаются на месте. Два штатных пути — источник в actor.sources
 * (обёртка проекта, вид runner) и плагин сессии OpenCode V2: старого shell.env
 * там нет, id сессии приходит из tool.execute.before и попадает в окружение
 * shell через shell.create.before как DSH_SESSION_ID.
 */
if (actor.attestedBy !== 'env') {
  check('актор: как дать сессию из окружения', false,
    'задайте источник в actor.sources (например WF_ACTOR_SESSION, вид runner) или в IDE (opencode V2) '
      + 'проверьте плагин сессии ~/.config/opencode/plugins/wf-session.ts и перезапустите приложение',
    'warn');
}
check('medium возможен в этой сессии', independence.ok,
  (PANEL_CONTEXT && !independence.ok ? 'проверка запущена из панели: ' : '') + independence.errors.join('; '),
  PANEL_CONTEXT && !independence.ok ? 'warn' : 'fail');

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
