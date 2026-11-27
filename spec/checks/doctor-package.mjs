#!/usr/bin/env node
/*
 * 0175: doctor различает корень пакета и развёрнутую копию.
 *   c1 — в корне пакета ноль проблем, файлы проверяются по spec/;
 *   c2 — чужой корень без шаблонов: FAIL называет spec/, а не docs/subagent-workflow.
 * Вне пакета — SKIP (конвенция deployed-copy).
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSyncPipeFree } from '../scripts/lib/common.mjs';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PKG = path.resolve(HERE, '..', '..');
if (!fs.existsSync(path.join(PKG, 'spec'))) { console.log('SKIP: проверка пакета вне пакета'); process.exit(0); }

const mode = String(process.argv[2] || '').toLowerCase();
let bad = 0;
function fail(tag, message) { bad += 1; console.log('FAIL ' + tag + ': ' + message); }
function doctor(root) {
  const r = spawnSyncPipeFree(process.execPath, [path.join(PKG, 'spec', 'scripts', 'doctor.mjs'), '--repo', root], { cwd: PKG, encoding: 'utf8', timeout: 180000 });
  return { code: r.status, out: String(r.stdout || '') + String(r.stderr || '') };
}

if (mode === 'c1') {
  const r = doctor(PKG);
  if (!/PASS  есть spec\/templates\/task\.md/u.test(r.out)) fail('c1', 'файл не проверен по spec/: ' + r.out.split('\n').filter((l) => /есть .*templates/.test(l)).join(' | ').slice(0, 300));
  if (/FAIL  есть spec\//u.test(r.out)) fail('c1', 'ложный FAIL по файлам пакета: ' + r.out.split('\n').filter((l) => /FAIL  есть/.test(l)).join(' | ').slice(0, 300));
  if (!/DOCTOR OK/u.test(r.out)) fail('c1', 'нет «DOCTOR OK»: ' + (r.out.match(/DOCTOR[^\n]*/u) || [''])[0]);
  if (/^FAIL  /mu.test(r.out)) fail('c1', 'есть FAIL: ' + r.out.split('\n').filter((l) => /^FAIL  /.test(l)).slice(0, 3).join(' | '));
  if (bad === 0) console.log('DOCTOR-PACKAGE OK c1');
  process.exit(bad === 0 ? 0 : 1);
}

if (mode === 'c2') {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-doctor-pkg-'));
  try {
    const git = spawnSyncPipeFree('git', ['init', '-q'], { cwd: root, encoding: 'utf8', timeout: 60000 });
    if (git.status !== 0) fail('c2', 'не удалось создать git-репозиторий');
    fs.mkdirSync(path.join(root, 'spec', 'scripts'), { recursive: true });
    fs.writeFileSync(path.join(root, 'spec', 'scripts', 'doctor.mjs'), '// признак корня пакета\n');
    const r = doctor(root);
    if (!/FAIL  есть spec\/templates\/task\.md/u.test(r.out)) fail('c2', 'FAIL не назвал spec/: ' + r.out.split('\n').filter((l) => /есть .*templates/.test(l)).join(' | ').slice(0, 300));
    if (/есть docs\/subagent-workflow\/templates/u.test(r.out)) fail('c2', 'проверяется путь развёрнутой копии в корне пакета');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
  if (bad === 0) console.log('DOCTOR-PACKAGE OK c2');
  process.exit(bad === 0 ? 0 : 1);
}

console.log('usage: node spec/checks/doctor-package.mjs c1|c2');
process.exit(2);
