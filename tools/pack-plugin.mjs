#!/usr/bin/env node
/*
 * Сборка устанавливаемого tarball плагина для панели Structure.
 *
 * npm pack кладёт в dist/ версионированный файл <имя>-<версия>.tgz. Рядом
 * появляется байт-в-байт копия со стабильным именем dsh-workflow-console.tgz —
 * именно её указывает workflowInstallSpec
 * (releases/latest/download/dsh-workflow-console.tgz). Для обоих пишется .sha256.
 *
 * Манифест не правится: files, dsh.bundle.patch, dsh.client.platform и
 * engines.dsh берутся из plugin/package.json как есть.
 *
 * 0.7.0: на время сборки в plugin/vendor/ кладётся спека пакета (spec/ →
 * vendor/spec) и её версия (VERSION → vendor/VERSION). Панель запускает
 * vendor/spec/scripts/init.mjs, а init берёт версию из vendor/VERSION
 * (packageRoot/../VERSION) — установка не требует сети. После pack, в том числе
 * при ошибке, vendor убирается: в репозитории не остаётся копии спеки.
 *
 * --plan — показать версию и имена ассетов, ничего не собирая и не записывая
 * (эту ветку использует spec/checks/acceptance-schema.mjs).
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import zlib from 'node:zlib';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PLUGIN = path.join(ROOT, 'plugin');
const DIST = path.join(ROOT, 'dist');
const MANIFEST = path.join(PLUGIN, 'package.json');
const PLAN = process.argv.includes('--plan');
/* Источник вложенной спеки: то, что уезжает в архив пакета. */
const SPEC = path.join(ROOT, 'spec');
const SPEC_VERSION = path.join(ROOT, 'VERSION');
const VENDOR = path.join(PLUGIN, 'vendor');
const VENDOR_SPEC = path.join(VENDOR, 'spec');
const VENDOR_VERSION = path.join(VENDOR, 'VERSION');
/* Файл, по которому видно, что спека действительно попала в tarball. */
const VENDOR_MARKER = 'vendor/spec/scripts/init.mjs';

function die(message) {
  console.error('pack-plugin: ' + message);
  process.exit(1);
}

/*
 * Спека копируется как есть, чтобы init в проекте получил ровно тот движок,
 * что уехал в архив. Мусор рабочего дерева (логи, .DS_Store) не копируется:
 * собранный tarball не должен зависеть от того, что лежало рядом со спекой.
 */
const SKIP_NAMES = new Set(['.DS_Store']);

function copyTree(src, dst) {
  fs.mkdirSync(dst, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    if (SKIP_NAMES.has(entry.name) || /\.log$/i.test(entry.name)) continue;
    const from = path.join(src, entry.name);
    const to = path.join(dst, entry.name);
    if (entry.isDirectory()) copyTree(from, to);
    else if (entry.isFile()) fs.copyFileSync(from, to);
  }
}

function removeVendor() {
  try {
    fs.rmSync(VENDOR, { recursive: true, force: true });
  } catch {
    /* не смогли убрать — это проверит cleanupVendor после сборки */
  }
}

function stageVendor() {
  if (!fs.existsSync(path.join(SPEC, 'scripts', 'init.mjs'))) {
    die('в ' + SPEC + ' нет scripts/init.mjs — панели нечего запускать');
  }
  const version = fs.readFileSync(SPEC_VERSION, 'utf8').trim();
  if (version === '') die('пустой ' + SPEC_VERSION + ' — версию движка вложить нечем');
  /* Остаток прошлой неудачной сборки не должен попасть в новый tarball. */
  removeVendor();
  copyTree(SPEC, VENDOR_SPEC);
  fs.writeFileSync(VENDOR_VERSION, version + '\n');
  console.log('  vendor    ' + path.relative(ROOT, VENDOR_SPEC) + ' + VERSION ' + version);
}

function cleanupVendor() {
  removeVendor();
  return !fs.existsSync(VENDOR);
}

/*
 * Ошибки после начала сборки бросаются, а не завершают процесс: `process.exit`
 * не раскручивает finally, и vendor остался бы в репозитории.
 */
function fail(message) {
  throw new Error(message);
}

/* Имена файлов в tar-заголовках — обычный текст; gzip снимаем zlib-ом. */
function tarballHas(buffer, needle) {
  try {
    return zlib.gunzipSync(buffer).toString('latin1').includes(needle);
  } catch (error) {
    fail('tarball не читается как gzip+tar: ' + (error && error.message ? error.message : String(error)));
    return false;
  }
}

let pkg;
try {
  pkg = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
} catch (error) {
  die('не читается ' + MANIFEST + ': ' + error.message);
}

const name = String(pkg.name || '');
if (name !== 'dsh-workflow-console') {
  die('в ' + MANIFEST + ' имя ' + JSON.stringify(pkg.name) + ', ожидалось "dsh-workflow-console"');
}
const version = String(pkg.version || '');
if (!/^\d+\.\d+\.\d+$/.test(version)) {
  die('в ' + MANIFEST + ' нет semver-версии: version=' + JSON.stringify(pkg.version));
}
if (!Array.isArray(pkg.files) || !pkg.files.includes('vendor')) {
  die('в ' + MANIFEST + ' нет "vendor" в files: спека не попадёт в tarball');
}
/* Лицензия — обязательный файл пакета (0.8.0): без неё tarball не выпускается. */
if (!pkg.files.includes('LICENSE')) {
  die('в ' + MANIFEST + ' нет "LICENSE" в files: лицензия не попадёт в tarball');
}

const versioned = name + '-' + version + '.tgz';
const stable = name + '.tgz';
const versionedPath = path.join(DIST, versioned);
const stablePath = path.join(DIST, stable);

console.log('pack-plugin: ' + name + '@' + version);
console.log('  versioned ' + versionedPath);
console.log('  stable    ' + stablePath);
if (PLAN) {
  console.log('  vendor    ' + path.relative(ROOT, VENDOR_SPEC) + ' + VERSION (на время сборки, потом убирается)');
  console.log('  plan      сборка не выполнялась');
  process.exit(0);
}

fs.mkdirSync(DIST, { recursive: true });
/* Старые файлы убираем заранее: иначе «файл создан» может означать прошлый прогон. */
for (const file of [versionedPath, stablePath, versionedPath + '.sha256', stablePath + '.sha256']) {
  fs.rmSync(file, { force: true });
}

/*
 * На Windows npm — это npm.cmd, а spawnSync без shell не запускает .cmd.
 * Запускаем через cmd.exe /d /s /c; shell: true с аргументами в Node даёт
 * deprecation-предупреждение и лишний слой разбора кавычек.
 */
const command = process.platform === 'win32' ? (process.env.ComSpec || 'cmd.exe') : 'npm';
/*
 * Кавычек в команде нет намеренно: Node экранирует их обратным слэшем, а cmd
 * обратный слэш не понимает и передаёт кавычки npm как часть пути. Относительный
 * `..\dist` от plugin/ не содержит пробелов даже в workspace с пробелами.
 */
const args = process.platform === 'win32'
  ? ['/d', '/s', '/c', 'npm pack --pack-destination ' + path.relative(PLUGIN, DIST)]
  : ['pack', '--pack-destination', DIST];

let failure = null;
try {
  stageVendor();
  const packed = spawnSync(command, args, { cwd: PLUGIN, encoding: 'utf8', windowsHide: true });
  const output = String(packed.stdout || '') + String(packed.stderr || '');
  if (packed.error) {
    fail('не удалось запустить npm pack: ' + packed.error.message);
  }
  if (packed.status !== 0) {
    fail('npm pack завершился с кодом ' + packed.status + (output.trim() ? ': ' + output.trim() : ''));
  }
  if (!fs.existsSync(versionedPath)) {
    fail('npm pack не создал ' + versionedPath + (output.trim() ? ': ' + output.trim() : ''));
  }

  const data = fs.readFileSync(versionedPath);
  if (data.length === 0) {
    fail('npm pack создал пустой файл ' + versionedPath);
  }
  /*
   * Проверка сборки, а не надежда: правильный files в манифесте ещё не значит,
   * что спека попала в tarball. Панель без vendor развернуть движок не может.
   */
  if (!tarballHas(data, VENDOR_MARKER)) {
    fail('в tarball нет ' + VENDOR_MARKER + ': спека не вложена');
  }
  if (!tarballHas(data, 'vendor/VERSION')) {
    fail('в tarball нет vendor/VERSION: init не увидит версию движка');
  }
  if (!tarballHas(data, 'LICENSE')) {
    fail('в tarball нет LICENSE: манифест обещает файл, а архив его не содержит');
  }

  fs.writeFileSync(stablePath, data);
  if (!fs.readFileSync(stablePath).equals(data)) {
    fail('копия ' + stablePath + ' не совпадает с ' + versionedPath);
  }

  const sha256 = (buffer) => crypto.createHash('sha256').update(buffer).digest('hex');
  for (const file of [versionedPath, stablePath]) {
    const bytes = fs.readFileSync(file);
    const digest = sha256(bytes);
    fs.writeFileSync(file + '.sha256', digest + '  ' + path.basename(file) + '\n');
    console.log('  ' + path.basename(file) + '  ' + bytes.length + ' байт  sha256 ' + digest);
  }
} catch (error) {
  failure = error;
} finally {
  /* vendor — сборочный материал, а не файл репозитория: убираем всегда. */
  const cleaned = cleanupVendor();
  if (!cleaned) {
    console.error('pack-plugin: WARN не удалось убрать ' + VENDOR + ' — уберите вручную');
    if (!failure) failure = new Error('vendor не убран после сборки');
  }
}
if (failure) {
  console.error('pack-plugin: ' + (failure.message || String(failure)));
  process.exit(1);
}
console.log('pack-plugin: готово');
