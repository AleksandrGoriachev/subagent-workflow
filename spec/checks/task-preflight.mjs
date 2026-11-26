#!/usr/bin/env node
/*
 * 0164: префлайт контракта до запуска узла. Проверка на временных каталогах:
 *   c1 — годный контракт даёт 0, а каждая причина отказа названа: нет task.md,
 *        нет блока TASK-META, битый JSON, суффикс каталога, принятое задание;
 *   c2 — покрытие заявленных путей allowedPaths: непокрытый путь назван, покрытый проходит;
 *   c3 — id не совпадает с каталогом, недопустимый risk, нет criteria.json.
 * Вне пакета — SKIP (конвенция deployed-copy).
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSyncPipeFree } from '../scripts/lib/common.mjs';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PKG = path.resolve(HERE, '..', '..');
if (!fs.existsSync(path.join(PKG, 'spec'))) {
  console.log('SKIP: проверка пакета вне пакета');
  process.exit(0);
}

const mode = String(process.argv[2] || '').toLowerCase();
let bad = 0;
function fail(tag, message) { bad += 1; console.log('FAIL ' + tag + ': ' + message); }

function makeRoot({ dir = '0001', meta, taskMd = true, metaBlock = true, criteria = true, acceptance = false } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-task-preflight-'));
  const taskDir = path.join(root, 'docs', 'tasks', dir);
  fs.mkdirSync(taskDir, { recursive: true });
  const value = meta || { id: /^[0-9]{4}/u.test(dir) ? dir.slice(0, 4) : '0001', risk: 'medium', owner: 'координатор', allowedPaths: ['tools/**'] };
  if (taskMd) {
    const text = metaBlock
      ? '# Задание\n\n<!-- TASK-META\n' + (typeof value === 'string' ? value : JSON.stringify(value, null, 2)) + '\n-->\n\n## Цель\n\nПроверка.\n'
      : '# Задание без блока метаданных\n';
    fs.writeFileSync(path.join(taskDir, 'task.md'), text);
  }
  if (criteria) fs.writeFileSync(path.join(taskDir, 'criteria.json'), JSON.stringify({ task: value.id || dir, criteria: [] }) + '\n');
  if (acceptance) fs.writeFileSync(path.join(taskDir, 'acceptance.json'), '{}\n');
  return { root, taskDir, rel: 'docs/tasks/' + dir };
}

function preflight(root, rel, extra = []) {
  const r = spawnSyncPipeFree(process.execPath, [path.join(PKG, 'spec', 'scripts', 'task-preflight.mjs'), '--contract', '--task', rel, '--repo', root, ...extra], { cwd: PKG, encoding: 'utf8', timeout: 120000 });
  return { code: r.status, out: String(r.stdout || '') + String(r.stderr || '') };
}

function withRoot(options, fn) {
  const ws = makeRoot(options);
  try { return fn(ws); } finally { fs.rmSync(ws.root, { recursive: true, force: true }); }
}

if (mode === 'c1') {
  withRoot({}, ({ root, rel }) => {
    const r = preflight(root, rel);
    if (r.code !== 0) fail('c1', 'годный контракт дал код ' + r.code + ': ' + r.out.trim().slice(-400));
    if (!/префлайт: OK/u.test(r.out)) fail('c1', 'нет «префлайт: OK»: ' + r.out.trim().slice(-300));
  });

  withRoot({ taskMd: false }, ({ root, rel }) => {
    const r = preflight(root, rel);
    if (r.code !== 1) fail('c1', 'без task.md код ' + r.code + ' вместо 1');
    if (!/нет файла docs\/tasks\/0001\/task\.md/u.test(r.out)) fail('c1', 'файл не назван: ' + r.out.trim().slice(-300));
  });

  withRoot({ metaBlock: false }, ({ root, rel }) => {
    const r = preflight(root, rel);
    if (r.code !== 1) fail('c1', 'без TASK-META код ' + r.code + ' вместо 1');
    if (!/нет блока TASK-META/u.test(r.out)) fail('c1', 'причина не названа: ' + r.out.trim().slice(-300));
  });

  withRoot({ meta: '{ "id": "0001", "risk": }' }, ({ root, rel }) => {
    const r = preflight(root, rel);
    if (r.code !== 1) fail('c1', 'битый JSON дал код ' + r.code + ' вместо 1');
    if (!/не разбирается как JSON/u.test(r.out)) fail('c1', 'битый JSON не назван: ' + r.out.trim().slice(-300));
  });

  withRoot({ dir: '0001-bot', meta: { id: '0001', risk: 'medium', owner: 'координатор', allowedPaths: ['tools/**'] } }, ({ root, rel }) => {
    const r = preflight(root, rel);
    if (r.code !== 1) fail('c1', 'суффикс каталога дал код ' + r.code + ' вместо 1');
    if (!/только четыре цифры/u.test(r.out)) fail('c1', 'правило имени не названо: ' + r.out.trim().slice(-300));
  });

  withRoot({ acceptance: true }, ({ root, rel }) => {
    const r = preflight(root, rel);
    if (r.code !== 1) fail('c1', 'принятое задание дало код ' + r.code + ' вместо 1');
    if (!/уже принято/u.test(r.out)) fail('c1', 'причина «уже принято» не названа: ' + r.out.trim().slice(-300));
  });

  if (bad === 0) console.log('TASK-PREFLIGHT OK c1');
  process.exit(bad === 0 ? 0 : 1);
}

if (mode === 'c2') {
  withRoot({}, ({ root, rel }) => {
    const r = preflight(root, rel, ['--paths', 'tools/a.mjs']);
    if (r.code !== 0) fail('c2', 'покрытый путь дал код ' + r.code + ': ' + r.out.trim().slice(-300));
    if (!/проверено путей 1/u.test(r.out)) fail('c2', 'проверка путей не отработала: ' + r.out.trim().slice(-300));
  });

  withRoot({}, ({ root, rel }) => {
    const r = preflight(root, rel, ['--paths', 'src/app.js']);
    if (r.code !== 1) fail('c2', 'непокрытый путь дал код ' + r.code + ' вместо 1');
    if (!/путь src\/app\.js не покрыт allowedPaths/u.test(r.out)) fail('c2', 'путь не назван: ' + r.out.trim().slice(-300));
  });

  withRoot({}, ({ root, rel }) => {
    const r = preflight(root, rel, ['--paths', 'tools/a.mjs,src/app.js']);
    if (r.code !== 1) fail('c2', 'смешанные пути дали код ' + r.code + ' вместо 1');
    if (!/src\/app\.js/u.test(r.out)) fail('c2', 'непокрытый путь не назван: ' + r.out.trim().slice(-300));
    if (/путь tools\/a\.mjs не покрыт/u.test(r.out)) fail('c2', 'покрытый путь назван непокрытым');
  });

  if (bad === 0) console.log('TASK-PREFLIGHT OK c2');
  process.exit(bad === 0 ? 0 : 1);
}

if (mode === 'c3') {
  withRoot({ meta: { id: '0002', risk: 'medium', owner: 'координатор', allowedPaths: ['tools/**'] } }, ({ root, rel }) => {
    const r = preflight(root, rel);
    if (r.code !== 1) fail('c3', 'чужой id дал код ' + r.code + ' вместо 1');
    if (!/не совпадает с каталогом/u.test(r.out)) fail('c3', 'id не назван: ' + r.out.trim().slice(-300));
  });

  withRoot({ meta: { id: '0001', risk: 'normal', owner: 'координатор', allowedPaths: ['tools/**'] } }, ({ root, rel }) => {
    const r = preflight(root, rel);
    if (r.code !== 1) fail('c3', 'недопустимый risk дал код ' + r.code + ' вместо 1');
    if (!/поле risk/u.test(r.out)) fail('c3', 'поле risk не названо: ' + r.out.trim().slice(-300));
  });

  withRoot({ criteria: false }, ({ root, rel }) => {
    const r = preflight(root, rel);
    if (r.code !== 1) fail('c3', 'без criteria.json код ' + r.code + ' вместо 1');
    if (!/нет criteria\.json/u.test(r.out)) fail('c3', 'отсутствие критериев не названо: ' + r.out.trim().slice(-300));
  });

  /* Контроль: годный контракт по-прежнему проходит. */
  withRoot({}, ({ root, rel }) => {
    const r = preflight(root, rel);
    if (r.code !== 0) fail('c3', 'контроль: годный контракт не прошёл, код ' + r.code);
  });

  if (bad === 0) console.log('TASK-PREFLIGHT OK c3');
  process.exit(bad === 0 ? 0 : 1);
}

console.log('usage: node spec/checks/task-preflight.mjs c1|c2|c3');
process.exit(2);
