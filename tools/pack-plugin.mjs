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
 * --plan — показать версию и имена ассетов, ничего не собирая (эту ветку
 * использует spec/checks/acceptance-schema.mjs).
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PLUGIN = path.join(ROOT, 'plugin');
const DIST = path.join(ROOT, 'dist');
const MANIFEST = path.join(PLUGIN, 'package.json');
const PLAN = process.argv.includes('--plan');

function die(message) {
  console.error('pack-plugin: ' + message);
  process.exit(1);
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

const versioned = name + '-' + version + '.tgz';
const stable = name + '.tgz';
const versionedPath = path.join(DIST, versioned);
const stablePath = path.join(DIST, stable);

console.log('pack-plugin: ' + name + '@' + version);
console.log('  versioned ' + versionedPath);
console.log('  stable    ' + stablePath);
if (PLAN) {
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
const packed = spawnSync(command, args, { cwd: PLUGIN, encoding: 'utf8', windowsHide: true });
const output = String(packed.stdout || '') + String(packed.stderr || '');
if (packed.error) {
  die('не удалось запустить npm pack: ' + packed.error.message);
}
if (packed.status !== 0) {
  die('npm pack завершился с кодом ' + packed.status + (output.trim() ? ': ' + output.trim() : ''));
}
if (!fs.existsSync(versionedPath)) {
  die('npm pack не создал ' + versionedPath + (output.trim() ? ': ' + output.trim() : ''));
}

const data = fs.readFileSync(versionedPath);
if (data.length === 0) {
  die('npm pack создал пустой файл ' + versionedPath);
}
fs.writeFileSync(stablePath, data);
if (!fs.readFileSync(stablePath).equals(data)) {
  die('копия ' + stablePath + ' не совпадает с ' + versionedPath);
}

const sha256 = (buffer) => crypto.createHash('sha256').update(buffer).digest('hex');
for (const file of [versionedPath, stablePath]) {
  const bytes = fs.readFileSync(file);
  const digest = sha256(bytes);
  fs.writeFileSync(file + '.sha256', digest + '  ' + path.basename(file) + '\n');
  console.log('  ' + path.basename(file) + '  ' + bytes.length + ' байт  sha256 ' + digest);
}
console.log('pack-plugin: готово');