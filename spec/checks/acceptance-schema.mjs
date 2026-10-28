#!/usr/bin/env node
/*
 * Приёмочные проверки задания 0009: схема записи и сборка tarball плагина.
 *
 * 1. Схема приёмки знает новые поля записи (actor.source, actor.sourceKind,
 *    independence.basis), по-прежнему принимает записи без них и отклоняет
 *    незнакомое поле (контроль: иначе «дописали в схему» ничего не доказывает).
 * 2. Манифест плагина готов к установке из tarball: версия 0.6.0, engines.dsh,
 *    dsh.bundle, dsh.client, состав files.
 * 3. Сборщик tools/pack-plugin.mjs умеет --plan и печатает стабильное и
 *    версионированное имена ассетов.
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SCHEMA = path.join(ROOT, 'spec', 'templates', 'acceptance.schema.json');
const PLUGIN_PKG = path.join(ROOT, 'plugin', 'package.json');
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
  const v = String(pkg.version || '');
  if (pkg.name !== 'dsh-workflow-console') fail('имя плагина', String(pkg.name));
  else pass('имя плагина dsh-workflow-console');
  if (v !== '0.6.0') fail('версия плагина 0.6.0', v); else pass('версия плагина 0.6.0');
  const engines = pkg.engines || {};
  if (engines.dsh !== '>=0.2.0-0 <0.3.0') fail('engines.dsh', JSON.stringify(engines.dsh));
  else pass('engines.dsh объявлен');
  const dsh = pkg.dsh || {};
  if (!dsh.bundle || dsh.bundle.patch !== './cordis.patch.yml') fail('dsh.bundle.patch', JSON.stringify(dsh.bundle));
  else pass('dsh.bundle.patch объявлен');
  if (!dsh.client || dsh.client.platform !== 'web') fail('dsh.client.platform', JSON.stringify(dsh.client));
  else pass('dsh.client.platform web');
  const files = Array.isArray(pkg.files) ? pkg.files : [];
  const needed = ['lib', 'cordis.patch.yml', 'README.md'];
  const missing = needed.filter((item) => !files.includes(item));
  if (missing.length) fail('files плагина', 'нет ' + missing.join(', '));
  else pass('files плагина полный');
  if (pkg.private !== true) fail('private: true в tarball', String(pkg.private));
  else pass('private: true в tarball');
}

/* 3. Сборщик tarball. */
if (!fs.existsSync(PACK_TOOL)) {
  fail('есть tools/pack-plugin.mjs');
} else {
  const result = spawnSync(process.execPath, [PACK_TOOL, '--plan'], { cwd: ROOT, encoding: 'utf8' });
  const out = String(result.stdout || '') + String(result.stderr || '');
  const stableOk = /\bdsh-workflow-console\.tgz\b/.test(out);
  const versionedOk = /dsh-workflow-console-\d+\.\d+\.\d+\.tgz/.test(out);
  const ok = result.status === 0 && stableOk && versionedOk;
  if (!ok) fail('сборщик печатает имена ассетов', 'exit=' + result.status + ' ' + out.trim().slice(0, 200));
  else pass('сборщик печатает стабильное и версионированное имена');
}

if (failed > 0) {
  console.log('');
  console.log('ACCEPTANCE SCHEMA FAIL: ' + failed);
  process.exit(1);
}
console.log('');
console.log('ACCEPTANCE SCHEMA OK');