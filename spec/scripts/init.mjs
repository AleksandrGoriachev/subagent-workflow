#!/usr/bin/env node
/*
 * Разворачивание рабочего пространства «с нуля»: копирует спецификацию и ворота
 * в репозиторий, создаёт конфигурацию, каталог заданий, закреплённый ключ приёмщика.
 *
 * Запускать из распакованного пакета:
 *   node scripts/init.mjs --repo <путь к проекту> [--key-id agent-judge]
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
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

function copyTree(src, dst, force) {
  fs.mkdirSync(dst, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const from = path.join(src, entry.name);
    const to = path.join(dst, entry.name);
    if (entry.isDirectory()) copyTree(from, to, force);
    else if (force || !fs.existsSync(to)) fs.copyFileSync(from, to);
  }
}

const argv = args(process.argv.slice(2));
if (argv.help) {
  console.log('Usage: node init.mjs --repo <dir> [--tasks docs/tasks] [--logs local|commit]');
  console.log('       [--key-id agent-judge] [--key-out <dir>] [--owner <name>] [--force]');
  process.exit(0);
}

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repo = path.resolve(String(argv.repo || '.'));
const tasksDir = String(argv.tasks || 'docs/tasks').replace(/\\/g, '/');
const workflowDir = 'docs/subagent-workflow';
const logs = String(argv.logs || 'local');
if (!['local', 'commit'].includes(logs)) { console.error('init: --logs local|commit'); process.exit(1); }

if (!fs.existsSync(path.join(repo, '.git'))) {
  console.warn('init: ' + repo + ' не git-репозиторий — выполните git init, ворота требуют git');
}
const dest = path.join(repo, workflowDir);
copyTree(packageRoot, dest, Boolean(argv.force));
fs.mkdirSync(path.join(repo, tasksDir), { recursive: true });

const configFile = path.join(dest, 'workflow.config.json');
const config = JSON.parse(fs.readFileSync(configFile, 'utf8'));
config.tasksDir = tasksDir;
config.logs = logs;
fs.writeFileSync(configFile, JSON.stringify(config, null, 2) + '\n');

const keysFile = path.join(dest, 'acceptors.json');
const keyId = String(argv['key-id'] || 'agent-judge');
const home = process.env.USERPROFILE || process.env.HOME || os.homedir();
const keyOut = path.resolve(String(argv['key-out'] || path.join(home, '.wf-keys')));
let createdKey = null;
if (!fs.existsSync(keysFile) || argv.force) {
  const { privateKeyPem, publicKeyPem } = generateKeyPair();
  fs.mkdirSync(keyOut, { recursive: true });
  const priv = path.join(keyOut, keyId + '.key.pem');
  const pub = path.join(keyOut, keyId + '.pub.pem');
  fs.writeFileSync(priv, privateKeyPem, { mode: 0o600 });
  fs.writeFileSync(pub, publicKeyPem, { mode: 0o644 });
  fs.writeFileSync(keysFile, JSON.stringify({
    acceptors: [{
      keyId,
      kind: 'agent',
      owner: String(argv.owner || 'acceptor'),
      publicKeyPem,
      createdAt: new Date().toISOString(),
      fingerprint: publicKeyFingerprint(publicKeyPem),
    }],
  }, null, 2) + '\n');
  createdKey = { keyId, privateKey: priv, publicKey: pub };
}

const gitignore = path.join(repo, '.gitignore');
const ignoreLine = logs === 'commit' ? '!docs/tasks/**/*.log' : 'docs/tasks/**/*.log';
const ignoreText = fs.existsSync(gitignore) ? fs.readFileSync(gitignore, 'utf8') : '';
if (!ignoreText.split(/\r?\n/).includes(ignoreLine)) {
  fs.appendFileSync(gitignore, (ignoreText && !ignoreText.endsWith('\n') ? '\n' : '') + '# subagent-workflow: журналы прогонов\n' + ignoreLine + '\n');
}

console.log('init: рабочее пространство готово');
console.log('  repo        ' + repo);
console.log('  workflow    ' + workflowDir);
console.log('  tasks       ' + tasksDir);
console.log('  logs        ' + logs);
console.log('  config      ' + path.join(workflowDir, 'workflow.config.json'));
if (createdKey) {
  console.log('  key         ' + createdKey.keyId);
  console.log('  private     ' + createdKey.private + '  (вне репозитория!)');
  console.log('  public      ' + path.join(workflowDir, 'acceptors.json'));
}
console.log('');
console.log('Дальше:');
console.log('  node ' + path.posix.join(workflowDir, 'scripts/new-task.mjs') + ' --repo . --id 0001 --title "..." --risk medium');
console.log('  git add ' + tasksDir + '/0001 checks && git commit -m "task 0001: контракт"');
console.log('  node ' + path.posix.join(workflowDir, 'scripts/task-hash.mjs') + ' --task ' + tasksDir + '/0001 --write');
console.log('  node ' + path.posix.join(workflowDir, 'scripts/task-lint.mjs') + ' --task ' + tasksDir + '/0001 --strict');
console.log('  node ' + path.posix.join(workflowDir, 'scripts/task-red.mjs')  + ' --task ' + tasksDir + '/0001 --base HEAD');
