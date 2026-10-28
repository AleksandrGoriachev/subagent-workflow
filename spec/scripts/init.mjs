#!/usr/bin/env node
/*
 * Разворачивание рабочего пространства: копирует спецификацию и ворота
 * в репозиторий, создаёт конфигурацию, каталог заданий, закреплённый ключ приёмщика.
 *
 * Семантика обновления (2.3.1):
 *   init               — добавить отсутствующие файлы; существующие не трогать,
 *                        VERSION не обновлять (частичное добавление, не обновление);
 *   init --force       — обновить файлы пакета до этой версии; ключ и acceptors.json
 *                        НЕ меняются: обновление не должно ломать подписи записей;
 *   init --rotate-key  — явная ротация ключа (старые записи этим ключом станут
 *                        untrusted — это осознанное действие, а не побочный эффект).
 *
 * 2.6.3 (B2): VERSION пишется ПОСЛЕДНИМ — после конфига, хуков и ключа. Раньше
 * он появлялся раньше, и падение на сломанном конфиге оставляло ложное
 * «уже развёрнуто»: кнопка панели навсегда отвечала already-deployed, а ключа и
 * хуков в проекте не было.
 *
 * 2.6.3 (B1): при --key-out внутри репозитория каталог ключа добавляется в
 * .gitignore проекта. Ключ проекта живёт в <repo>/.wf-keys/, глобальный
 * %USERPROFILE%\.wf-keys не трогается: два развёрнутых проекта — два ключа.
 *
 * Запускать из распакованного пакета:
 *   node scripts/init.mjs --repo <путь к проекту> [--key-id agent-judge]
 *                         [--key-out <каталог ключей>] [--force]
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { generateKeyPair, publicKeyFingerprint } from './sign.mjs';

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

const stats = { copied: 0, skipped: 0 };

function copyTree(src, dst, force) {
  fs.mkdirSync(dst, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    /*
     * acceptors.json — состояние конкретного рабочего пространства, а не шаблон.
     * Если скопировать его из развёрнутого каталога, init увидит «ключ уже закреплён»
     * и не сгенерирует приватный ключ: в новом репозитории останется публичный ключ
     * без пары. Поэтому файл всегда создаётся заново.
     */
    if (entry.isFile() && entry.name === 'acceptors.json') continue;
    /*
     * workflow.config.json — решение проекта (policy/roles/models), а не файл
     * пакета. Перезапись шаблоном молча вернула бы attack=off и стёрла роли,
     * поэтому конфиг обновляем точечно, а не копированием.
     */
    if (entry.isFile() && entry.name === 'workflow.config.json') continue;
    const from = path.join(src, entry.name);
    const to = path.join(dst, entry.name);
    if (entry.isDirectory()) copyTree(from, to, force);
    else if (force || !fs.existsSync(to)) {
      fs.copyFileSync(from, to);
      /*
       * Свежий mtime у скопированного файла — не косметика. На Windows
       * copyFileSync сохраняет время источника, а архив собран с постоянными
       * метками; обновление, которое не меняет размер (2.4.3 -> 2.4.4 в VERSION и
       * TOOL), тогда не видно git'у: stat-кеш считает файл неизменённым, и
       * git status молчит. Так обновление можно закоммитить «успешно», оставив
       * старый TOOL — ровно та ошибка, что была в 2.4.2. Поэтому время файла
       * ставим в «сейчас», и git видит правку.
       */
      const stamp = new Date();
      try {
        fs.utimesSync(to, stamp, stamp);
      } catch {
        /* время не выставилось — это не повод не разворачивать пакет */
      }
      stats.copied += 1;
    } else stats.skipped += 1;
  }
}

const argv = args(process.argv.slice(2));
if (argv.help) {
  console.log('Usage: node init.mjs --repo <dir> [--tasks docs/tasks] [--logs local|commit]');
  console.log('       [--key-id agent-judge] [--key-out <dir>] [--owner <name>]');
  console.log('       [--force]        обновить файлы пакета (ключ не меняется)');
  console.log('       [--rotate-key]   явная ротация ключа: старые записи станут untrusted');
  console.log('       Хуки (2.5.0): локальный git config core.hooksPath docs/subagent-workflow/hooks;');
  console.log('       проверка коммита включается флагом guard.enabled в workflow.config.json.');
  process.exit(0);
}

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repo = path.resolve(String(argv.repo || '.'));
/*
 * Локальная настройка git: core.hooksPath в глобальном конфиге переключил бы
 * хуки во всех репозиториях машины, а init отвечает за одно пространство (D2).
 */
function runGit(args) {
  return spawnSync('git', ['-C', repo, ...args], { encoding: 'utf8' });
}
const tasksDir = String(argv.tasks || 'docs/tasks').replace(/\\/g, '/');
const workflowDir = 'docs/subagent-workflow';
const logs = String(argv.logs || 'local');
const force = Boolean(argv.force);
if (!['local', 'commit'].includes(logs)) { console.error('init: --logs local|commit'); process.exit(1); }

if (!fs.existsSync(path.join(repo, '.git'))) {
  console.warn('init: ' + repo + ' не git-репозиторий — выполните git init, ворота требуют git');
}
const dest = path.join(repo, workflowDir);
const existedBefore = fs.existsSync(dest);
const sameSource = path.resolve(packageRoot) === path.resolve(dest);
if (sameSource) {
  console.log('init: источник совпадает с целью (запуск из развёрнутой копии) — файлы не копируются');
} else {
  copyTree(packageRoot, dest, force);
}
fs.mkdirSync(path.join(repo, tasksDir), { recursive: true });

/*
 * VERSION — номер того, что действительно развёрнуто. Обновляем его только когда
 * файлы пакета обновлены (--force) или копия создаётся впервые: иначе получилось бы
 * «версия новая, содержимое старое» — именно так в ws-school-app оказался каталог
 * 2.2.2 без текста I-29…I-32.
 *
 * 2.6.3: здесь только читаем источник. Сама запись — в конце, после конфига,
 * хуков и ключа (см. «VERSION последним»): пока эти шаги не прошли, файла быть
 * не должно, иначе отказ превращается в неотличимое «уже развёрнуто».
 */
const deployedVersionPath = path.join(dest, 'VERSION');
const versionSource = [
  path.join(packageRoot, '..', 'VERSION'),
  path.join(packageRoot, 'VERSION'),
].find((candidate) => fs.existsSync(candidate) && path.resolve(candidate) !== path.resolve(deployedVersionPath)) || null;
let sourceVersion = null;
if (versionSource) {
  const text = fs.readFileSync(versionSource, 'utf8').trim();
  if (text) sourceVersion = text;
}
let deployedVersion = null;
let versionSkipped = false;

const configFile = path.join(dest, 'workflow.config.json');
const configExisted = fs.existsSync(configFile);
const config = configExisted
  ? JSON.parse(fs.readFileSync(configFile, 'utf8'))
  : JSON.parse(fs.readFileSync(path.join(packageRoot, 'workflow.config.json'), 'utf8'));
config.tasksDir = tasksDir;
config.logs = logs;
fs.writeFileSync(configFile, JSON.stringify(config, null, 2) + '\n');

/*
 * 2.5.0: хуки — часть развёрнутого пространства. git config core.hooksPath
 * ставится ЛОКАЛЬНО (решение D2): глобальный переключил бы хуки во всех
 * репозиториях машины. Повторный init идемпотентен: то же значение не меняется,
 * предупреждение печатается только при реальной замене чужого пути.
 *
 * Сами хуки безвредны, пока guard.enabled !== true: task-guard молча выходит 0.
 * Так включение проверки — один флаг, а не повторное развёртывание.
 */
const hooksRel = path.posix.join(workflowDir, 'hooks');
const hooksDir = path.join(repo, hooksRel);
const hookNames = ['pre-commit', 'commit-msg', 'pre-push'];
const hooksState = { path: hooksRel, installed: false, previous: null, git: false, missing: [] };
if (fs.existsSync(hooksDir)) {
  for (const name of hookNames) {
    const file = path.join(hooksDir, name);
    if (!fs.existsSync(file)) { hooksState.missing.push(name); continue; }
    /*
     * На POSIX git запускает хук только с правом исполнения. Копия с Windows
     * приезжает с режимом 644, поэтому права ставим явно (на Windows chmod
     * ничего не значит, но и не вредит).
     */
    try { fs.chmodSync(file, 0o755); } catch { /* Windows: режим не применим */ }
  }
  hooksState.git = fs.existsSync(path.join(repo, '.git'));
  if (hooksState.git) {
    const previous = runGit(['config', '--get', 'core.hooksPath']);
    hooksState.previous = previous.status === 0 ? String(previous.stdout || '').trim() : null;
    const applied = runGit(['config', 'core.hooksPath', hooksRel]);
    hooksState.installed = applied.status === 0;
    if (!hooksState.installed) {
      console.warn('init: WARN не удалось выставить core.hooksPath: ' + String(applied.stderr || '').trim());
    }
  }
}

const keysFile = path.join(dest, 'acceptors.json');
const keyId = String(argv['key-id'] || 'agent-judge');
const home = process.env.USERPROFILE || process.env.HOME || os.homedir();
const keyOut = path.resolve(String(argv['key-out'] || path.join(home, '.wf-keys')));
let createdKey = null;

/*
 * .gitignore один на все строки init: помощник дописывает строку, если её ещё
 * нет, и ничего не делает при повторе (идемпотентно).
 */
const gitignore = path.join(repo, '.gitignore');
function appendIgnore(comment, line) {
  const text = fs.existsSync(gitignore) ? fs.readFileSync(gitignore, 'utf8') : '';
  if (text.split(/\r?\n/).includes(line)) return false;
  fs.appendFileSync(gitignore, (text && !text.endsWith('\n') ? '\n' : '') + comment + '\n' + line + '\n');
  return true;
}

/*
 * 2.6.3 (B1): ключ проекта лежит в <repo>/.wf-keys/ и не должен попасть в git.
 * Строка ставится ДО создания ключа: даже если init упадёт сразу после
 * makeKeyPair, приватный ключ уже игнорируется. Каталог вне репозитория
 * (например --key-out во временный каталог теста) сюда не относится.
 */
const keyOutRel = path.relative(repo, keyOut);
const keyInRepo = keyOutRel !== '' && !keyOutRel.startsWith('..') && !path.isAbsolute(keyOutRel);
if (keyInRepo) {
  appendIgnore('# subagent-workflow: ключ приёмщика проекта', keyOutRel.split(path.sep).join('/') + '/');
}
let rotatedKey = null;
let keptKey = null;

function makeKeyPair(id) {
  const { privateKeyPem, publicKeyPem } = generateKeyPair();
  fs.mkdirSync(keyOut, { recursive: true });
  const priv = path.join(keyOut, id + '.key.pem');
  const pub = path.join(keyOut, id + '.pub.pem');
  fs.writeFileSync(priv, privateKeyPem, { mode: 0o600 });
  fs.writeFileSync(pub, publicKeyPem, { mode: 0o644 });
  return { keyId: id, privateKey: priv, publicKey: pub, publicKeyPem, privatePem: privateKeyPem };
}

function writeAcceptors(keyIds) {
  fs.writeFileSync(keysFile, JSON.stringify({ acceptors: keyIds }, null, 2) + '\n');
}

if (!fs.existsSync(keysFile)) {
  const pair = makeKeyPair(keyId);
  writeAcceptors([{
    keyId,
    kind: 'agent',
    owner: String(argv.owner || 'acceptor'),
    publicKeyPem: pair.publicKeyPem,
    createdAt: new Date().toISOString(),
    fingerprint: publicKeyFingerprint(pair.publicKeyPem),
  }]);
  createdKey = { keyId, privateKey: pair.privateKey, publicKey: pair.publicKey };
} else if (argv['rotate-key']) {
  const rotateId = argv['rotate-key'] === true ? keyId : String(argv['rotate-key']);
  const parsed = JSON.parse(fs.readFileSync(keysFile, 'utf8'));
  const list = Array.isArray(parsed) ? parsed : (parsed.acceptors || []);
  const pair = makeKeyPair(rotateId);
  const entry = {
    keyId: rotateId,
    kind: String(argv.kind || 'agent'),
    owner: String(argv.owner || 'acceptor'),
    publicKeyPem: pair.publicKeyPem,
    createdAt: new Date().toISOString(),
    fingerprint: publicKeyFingerprint(pair.publicKeyPem),
  };
  const next = list.filter((item) => item.keyId !== rotateId).concat(entry);
  writeAcceptors(next);
  rotatedKey = { keyId: rotateId, privateKey: pair.privateKey, publicKey: pair.publicKey };
  console.warn('init: WARN ключ ' + rotateId + ' перевыпущен — записи, подписанные старым ключом, станут untrusted');
} else {
  keptKey = { keyId: keyId };
}

const ignoreLine = logs === 'commit' ? '!docs/tasks/**/*.log' : 'docs/tasks/**/*.log';
appendIgnore('# subagent-workflow: журналы прогонов', ignoreLine);
/*
 * guard.log — локальный след включения/выключения проверки (I-29), а не история
 * репозитория: журнал не должен попадать в коммиты и в чужой diff.
 */
const guardLogRel = path.posix.join(workflowDir, 'guard.log');
appendIgnore('# subagent-workflow: журнал включения guard', guardLogRel);

/*
 * VERSION последним (2.6.3, B2). Только здесь, после файлов, конфига, хуков и
 * ключа: падение раньше оставляет проект без VERSION, и следующий запуск
 * (в том числе кнопка панели) снова разворачивает его, а не отвечает
 * already-deployed на недоразвёрнутое пространство.
 */
if (sourceVersion) {
  if (force || !existedBefore || !fs.existsSync(deployedVersionPath)) {
    fs.writeFileSync(deployedVersionPath, sourceVersion + '\n');
    deployedVersion = sourceVersion;
  } else {
    versionSkipped = true;
  }
}

console.log('init: рабочее пространство ' + (existedBefore ? 'обновлено' : 'готово'));
console.log('  repo        ' + repo);
console.log('  workflow    ' + workflowDir);
console.log('  tasks       ' + tasksDir);
console.log('  logs        ' + logs);
console.log('  files       скопировано ' + stats.copied + ', не тронуто ' + stats.skipped);
console.log('  config      ' + (configExisted ? 'сохранён (policy/roles/models не тронуты)' : 'создан из шаблона'));
console.log('  config      ' + path.join(workflowDir, 'workflow.config.json'));
if (deployedVersion) console.log('  version     ' + deployedVersion);
if (fs.existsSync(hooksDir)) {
  const state = hooksState.installed
    ? 'локальный core.hooksPath'
    : hooksState.git
      ? 'core.hooksPath НЕ выставлен — проверьте git'
      : 'не git-репозиторий: хуки не включены';
  console.log('  hooks       ' + hooksRel + ' (' + state + ')');
  if (hooksState.previous && hooksState.previous !== hooksRel) {
    console.warn('init: WARN core.hooksPath был "' + hooksState.previous + '" — заменён на "' + hooksRel + '" (локально, глобальный не тронут)');
  }
}
if (versionSkipped) {
  console.warn('init: WARN VERSION не обновлён: файлы существующей копии не тронуты (запустите с --force для обновления)');
}
/* Ключ проекта лежит внутри репозитория, но каталог в .gitignore; глобальный — вне. */
const privateNote = keyInRepo ? '  (каталог в .gitignore проекта)' : '  (вне репозитория!)';
if (createdKey) {
  console.log('  key         ' + createdKey.keyId + ' (создан)');
  console.log('  private     ' + createdKey.privateKey + privateNote);
  console.log('  public      ' + path.join(workflowDir, 'acceptors.json'));
} else if (rotatedKey) {
  console.log('  key         ' + rotatedKey.keyId + ' (перевыпущен)');
  console.log('  private     ' + rotatedKey.privateKey + privateNote);
} else if (keptKey) {
  console.log('  key         ' + keptKey.keyId + ' (закреплён ранее, не менялся)');
}
console.log('');
console.log('Дальше:');
console.log('  node ' + path.posix.join(workflowDir, 'scripts/new-task.mjs') + ' --repo . --id 0001 --title "..." --risk medium');
console.log('  git add ' + tasksDir + '/0001 checks && git commit -m "task 0001: контракт"');
console.log('  node ' + path.posix.join(workflowDir, 'scripts/task-hash.mjs') + ' --task ' + tasksDir + '/0001 --write');
console.log('  node ' + path.posix.join(workflowDir, 'scripts/task-lint.mjs') + ' --task ' + tasksDir + '/0001 --strict');
console.log('  node ' + path.posix.join(workflowDir, 'scripts/task-red.mjs')  + ' --task ' + tasksDir + '/0001 --base HEAD');
console.log('  guard: включите проверку коммитов на панели или флагом guard.enabled в ' + path.posix.join(workflowDir, 'workflow.config.json'));
