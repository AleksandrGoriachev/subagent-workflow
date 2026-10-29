#!/usr/bin/env node
/*
 * Приёмочные проверки задания 0009: схема записи и сборка tarball плагина.
 *
 * 1. Схема приёмки знает новые поля записи (actor.source, actor.sourceKind,
 *    independence.basis), по-прежнему принимает записи без них и отклоняет
 *    незнакомое поле (контроль: иначе «дописали в схему» ничего не доказывает).
 * 2. Манифест плагина готов к установке из tarball: имя и версия читаются из
 *    самого манифеста, engines.dsh, dsh.bundle, dsh.client, состав files.
 * 3. Сборщик tools/pack-plugin.mjs умеет --plan и печатает стабильное и
 *    версионированное имена ассетов.
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
/* 2.6.2: проверка относится к пакету (spec/checks); в развёрнутой копии spec/SPEC.md нет — SKIP. */
if (!fs.existsSync(path.join(ROOT, 'spec', 'SPEC.md'))) {
  console.log('SKIP: проверка относится к пакету (spec/checks), а не к развёрнутой копии');
  process.exit(0);
}
const SCHEMA = path.join(ROOT, 'spec', 'templates', 'acceptance.schema.json');
const PLUGIN_DIR = path.join(ROOT, 'plugin');
const PLUGIN_PKG = path.join(PLUGIN_DIR, 'package.json');
const PACK_TOOL = path.join(ROOT, 'tools', 'pack-plugin.mjs');
let failed = 0;

const pass = (name) => console.log('PASS ' + name);
const fail = (name, detail) => { failed += 1; console.log('FAIL ' + name + (detail ? ' — ' + detail : '')); };

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

/*
 * Минимальный валидатор подмножества draft-07, которое используется в
 * actor/independence: type, enum, const, pattern, minLength, required,
 * properties, additionalProperties. Больше схема записи здесь не требует.
 */
function validate(schema, value, where = '') {
  const errors = [];
  if (!schema || typeof schema !== 'object') return errors;
  const name = where || 'значение';
  if ('const' in schema && value !== schema.const) errors.push(name + ': ожидалось ' + JSON.stringify(schema.const));
  if (Array.isArray(schema.enum) && !schema.enum.includes(value)) errors.push(name + ': допустимо ' + JSON.stringify(schema.enum));
  if (schema.type !== undefined) {
    const types = Array.isArray(schema.type) ? schema.type : [schema.type];
    const actual = value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value;
    const normalize = (type) => (type === 'integer' ? 'number' : type);
    if (!types.map(normalize).includes(normalize(actual))) errors.push(name + ': тип ' + actual + ', ожидался ' + types.join('|'));
  }
  if (typeof value === 'string') {
    if (schema.minLength !== undefined && value.length < schema.minLength) errors.push(name + ': короче ' + schema.minLength);
    if (schema.pattern !== undefined && !new RegExp(schema.pattern).test(value)) errors.push(name + ': не соответствует /' + schema.pattern + '/');
  }
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    for (const key of schema.required || []) if (!(key in value)) errors.push(name + ': нет обязательного поля ' + key);
    const properties = schema.properties || {};
    for (const [key, child] of Object.entries(properties)) {
      if (key in value) errors.push(...validate(child, value[key], (where ? where + '.' : '') + key));
    }
    if (schema.additionalProperties === false) {
      for (const key of Object.keys(value)) if (!(key in properties)) errors.push(name + ': лишнее поле ' + key);
    }
  }
  return errors;
}

/* 1. Схема записи. */
let schema = null;
try { schema = readJson(SCHEMA); } catch (error) { fail('схема приёмки читается', error.message); }
if (schema) {
  const actor = schema.properties && schema.properties.actor;
  const independence = schema.properties && schema.properties.independence;
  const baseActor = { kind: 'agent', session: 'session-1', model: 'm', family: 'f', host: 'h', keyId: 'agent-judge', attestedBy: 'env' };
  const baseIndependence = { level: 'separate-session', separateSession: true, reportWithheld: true, keyCustody: 'agent-key', modelLevel: 'unknown' };

  const withSource = validate(actor, { ...baseActor, source: 'WF_ACTOR_SESSION', sourceKind: 'runner' }, 'actor');
  if (withSource.length) fail('схема принимает actor.source и actor.sourceKind', withSource.join('; '));
  else pass('схема принимает actor.source и actor.sourceKind');

  const legacy = validate(actor, baseActor, 'actor');
  if (legacy.length) fail('схема принимает записи без новых полей', legacy.join('; '));
  else pass('схема принимает записи без новых полей');

  const unknown = validate(actor, { ...baseActor, vendor: 'x' }, 'actor');
  if (unknown.length === 0) fail('контроль: незнакомое поле в actor отклоняется', 'валидатор пропустил vendor');
  else pass('контроль: незнакомое поле в actor отклоняется');

  const withBasis = validate(independence, { ...baseIndependence, basis: 'runner' }, 'independence');
  if (withBasis.length) fail('схема принимает independence.basis', withBasis.join('; '));
  else pass('схема принимает independence.basis');

  const legacyBasis = validate(independence, baseIndependence, 'independence');
  if (legacyBasis.length) fail('схема принимает записи без basis', legacyBasis.join('; '));
  else pass('схема принимает записи без basis');
}

/* 2. Манифест плагина. */
let pkg = null;
try { pkg = readJson(PLUGIN_PKG); } catch (error) { fail('манифест плагина читается', error.message); }
if (pkg) {
  /* Имя и версия — из манифеста: конкретный номер сверяет tools/check-version.mjs. */
  const v = String(pkg.version || '');
  const name = String(pkg.name || '');
  if (name === '') fail('имя плагина из манифеста', JSON.stringify(pkg.name));
  else pass('имя плагина из манифеста: ' + name);
  if (!/^\d+\.\d+\.\d+$/.test(v)) fail('версия плагина из манифеста', JSON.stringify(pkg.version));
  else pass('версия плагина из манифеста: ' + v);
  const engines = pkg.engines || {};
  if (engines.dsh !== '>=0.2.0-0 <0.3.0') fail('engines.dsh', JSON.stringify(engines.dsh));
  else pass('engines.dsh объявлен');
  const dsh = pkg.dsh || {};
  if (!dsh.bundle || dsh.bundle.patch !== './cordis.patch.yml') fail('dsh.bundle.patch', JSON.stringify(dsh.bundle));
  else pass('dsh.bundle.patch объявлен');
  if (!dsh.client || dsh.client.platform !== 'web') fail('dsh.client.platform', JSON.stringify(dsh.client));
  else pass('dsh.client.platform web');
  const files = (Array.isArray(pkg.files) ? pkg.files : []).filter((item) => typeof item === 'string' && item.trim() !== '');
  /*
   * Состав архива — из манифеста: каждая точка входа (main, exports, patch)
   * должна попадать в files. README — обязательный сосед tarball по конвенции
   * npm, vendor — вложенная спека для офлайн-развёртывания.
   */
  const entryPaths = [
    'README.md',
    pkg.main,
    ...Object.values(pkg.exports || {}),
    pkg.dsh && pkg.dsh.bundle && pkg.dsh.bundle.patch,
  ].filter((item) => typeof item === 'string' && item !== '').map((item) => item.replace(/^\.\//, ''));
  const filed = (target) => files.some((entry) => {
    const base = entry.replace(/^\.\//, '').replace(/\/+$/, '');
    return target === base || target.startsWith(base + '/');
  });
  const notFiled = [...new Set(entryPaths)].filter((target) => !filed(target));
  if (notFiled.length) fail('files плагина: точки входа в архиве', 'нет ' + notFiled.join(', '));
  else pass('files плагина: точки входа в архиве');
  const missingOnDisk = files.filter((entry) => entry !== 'vendor' && !fs.existsSync(path.join(PLUGIN_DIR, entry)));
  if (missingOnDisk.length) fail('files плагина: пути на диске', 'нет ' + missingOnDisk.join(', '));
  else pass('files плагина: пути на диске (кроме vendor — его создаёт сборщик)');
  if (!files.includes('vendor')) fail('vendor в files', 'вложенная спека не попадёт в tarball');
  else pass('vendor в files: вложенная спека');
  /* 0.8.0: LICENSE — обязательный файл пакета, а не только строка в манифесте. */
  if (!files.includes('LICENSE')) fail('LICENSE в files', 'лицензия не попадёт в tarball');
  else pass('LICENSE в files: лицензия в архиве');
  if (pkg.private !== true) fail('private: true в tarball', String(pkg.private));
  else pass('private: true в tarball');
}

/* 3. Сборщик tarball. */
if (!fs.existsSync(PACK_TOOL)) {
  fail('есть tools/pack-plugin.mjs');
} else {
  const result = spawnSync(process.execPath, [PACK_TOOL, '--plan'], { cwd: ROOT, encoding: 'utf8' });
  const out = String(result.stdout || '') + String(result.stderr || '');
  /* Имена ассетов строятся из манифеста: сборщик обязан взять имя и версию оттуда. */
  const assetName = String((pkg && pkg.name) || '');
  const assetVersion = String((pkg && pkg.version) || '');
  const stableOk = assetName !== '' && out.includes(assetName + '.tgz');
  const versionedOk = assetName !== '' && assetVersion !== '' && out.includes(assetName + '-' + assetVersion + '.tgz');
  const ok = result.status === 0 && stableOk && versionedOk;
  if (!ok) fail('сборщик печатает имена ассетов из манифеста', 'exit=' + result.status + ' ' + out.trim().slice(0, 200));
  else pass('сборщик печатает стабильное и версионированное имена из манифеста');
}

/* 4. Схема проверяется в CI, а не только руками. */
const CI_PATH = path.join(ROOT, '.github', 'workflows', 'ci.yml');
let ci = '';
try { ci = fs.readFileSync(CI_PATH, 'utf8'); } catch { ci = ''; }
if (ci === '') fail('есть .github/workflows/ci.yml');
else if (!/node spec\/checks\/acceptance-schema\.mjs/.test(ci)) fail('в CI есть шаг acceptance-schema.mjs', 'шага нет в ci.yml');
else pass('в CI есть шаг acceptance-schema.mjs');

if (failed > 0) {
  console.log('');
  console.log('ACCEPTANCE SCHEMA FAIL: ' + failed);
  process.exit(1);
}
console.log('');
console.log('ACCEPTANCE SCHEMA OK');