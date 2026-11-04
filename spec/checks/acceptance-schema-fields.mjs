#!/usr/bin/env node
/*
 * 2.6.20 (0054): схема записи приёмки знает поля, которые мы уже пишем.
 *
 * 0049 добавил independence.reportReadReason, 0053 — reportRead и reportReadVerified.
 * Схема (spec/templates/acceptance.schema.json) объявляет independence с
 * additionalProperties: false и этих полей не знала: внутренние ворота зелёные, но внешний
 * потребитель отклонял бы корректную запись (нашёл приёмщик 0053 валидатором из
 * acceptance-schema.mjs; дефект тянулся с 0049).
 *
 * Проверяется и схема, и реальная запись: docs/tasks/0053/acceptance.json обязана проходить
 * валидацию, а запись с незнакомым полем — по-прежнему нет (контроль).
 * Вне пакета — SKIP (конвенция deployed-copy).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PKG = path.resolve(HERE, '..', '..');

if (!fs.existsSync(path.join(PKG, 'spec'))) {
  console.log('SKIP: проверка пакета вне пакета');
  process.exit(0);
}

const SCHEMA = path.join(PKG, 'spec', 'templates', 'acceptance.schema.json');
const SAMPLE = path.join(PKG, 'docs', 'tasks', '0053', 'acceptance.json');

function truthy(value, label) {
  if (!value) throw new Error(label);
}

function validate(schema, value, where = '') {
  const errors = [];
  if (!schema || typeof schema !== 'object') return errors;
  const name = where || 'значение';
  if (Array.isArray(schema.enum) && !schema.enum.includes(value)) errors.push(name + ': не из enum');
  if (schema.type === 'object' && (typeof value !== 'object' || value === null || Array.isArray(value))) {
    errors.push(name + ': ожидался объект');
    return errors;
  }
  if (schema.type === 'string' && typeof value !== 'string') errors.push(name + ': ожидалась строка');
  if (schema.type === 'boolean' && typeof value !== 'boolean') errors.push(name + ': ожидался boolean');
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    for (const key of schema.required || []) if (!(key in value)) errors.push(name + ': нет обязательного ' + key);
    const props = schema.properties || {};
    for (const [key, item] of Object.entries(value)) {
      if (!(key in props)) {
        if (schema.additionalProperties === false) errors.push(name + ': лишнее поле ' + key);
        continue;
      }
      errors.push(...validate(props[key], item, where ? where + '.' + key : key));
    }
  }
  return errors;
}

function c1() {
  const schema = JSON.parse(fs.readFileSync(SCHEMA, 'utf8'));
  const ind = schema.properties && schema.properties.independence;
  truthy(ind && ind.properties, 'в схеме нет independence.properties');
  truthy(ind.additionalProperties === false, 'independence.additionalProperties должен остаться false');
  const read = ind.properties.reportRead;
  truthy(read && Array.isArray(read.enum), 'в схеме нет independence.reportRead');
  truthy(read.enum.includes('declared') && read.enum.includes('not-declared'), 'reportRead: неверный enum ' + JSON.stringify(read.enum));
  truthy(ind.properties.reportReadVerified && ind.properties.reportReadVerified.type === 'boolean', 'нет reportReadVerified: boolean');
  truthy(ind.properties.reportReadReason && ind.properties.reportReadReason.type === 'string', 'нет reportReadReason: string');
  console.log('SCHEMA OK c1');
}

function c2() {
  const schema = JSON.parse(fs.readFileSync(SCHEMA, 'utf8'));
  truthy(fs.existsSync(SAMPLE), 'нет docs/tasks/0053/acceptance.json — образца реальной записи');
  const record = JSON.parse(fs.readFileSync(SAMPLE, 'utf8'));
  const errors = validate(schema, record);
  truthy(errors.length === 0, 'реальная запись 0053 не проходит схему: ' + errors.slice(0, 6).join('; '));
  const dirty = JSON.parse(JSON.stringify(record));
  dirty.independence.zzzUnknown = true;
  const control = validate(schema, dirty);
  truthy(control.some((e) => e.includes('zzzUnknown')), 'контроль не сработал: незнакомое поле independence принято');
  console.log('SCHEMA OK c2');
}

const table = { c1, c2 };
const which = process.argv[2];
if (!table[which]) {
  console.log('usage: node spec/checks/acceptance-schema-fields.mjs c1|c2');
  process.exit(2);
}
try {
  table[which]();
} catch (error) {
  console.log('SCHEMA FAIL ' + which + ': ' + (error && error.message ? error.message : error));
  process.exit(1);
}
