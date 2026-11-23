#!/usr/bin/env node
/*
 * 2.6.105 (0124): повторная приёмка — только с причиной.
 *
 * Замер structure: 16 лишних прогонов review/accept. Раньше повторный accept для
 * того же контракта требовал лишь --force (аварийный обход без причины), и причины
 * переделки нигде не оставалось. Теперь: тот же контракт + запись accepted —
 * отказ, пока не передан --rework "<почему>"; причина попадает в notes записи
 * (acceptanceNotes), а --force остаётся обходом.
 *
 * c1: правило повтора — refuse / rework / force / allow при смене контракта.
 * c2: причина переделки попадает в notes вместе с причиной обхода.
 *
 * Вне пакета — SKIP (конвенция deployed-copy).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { acceptanceRepeatGuard, acceptanceNotes } from '../scripts/lib/common.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PKG = path.resolve(HERE, '..', '..');

if (!fs.existsSync(path.join(PKG, 'spec'))) {
  console.log('SKIP: проверка пакета вне пакета');
  process.exit(0);
}

function truthy(value, label) {
  if (!value) throw new Error(label);
}

const ACCEPTED = { status: 'accepted', contractCommit: 'a'.repeat(40) };
const OTHER = { status: 'accepted', contractCommit: 'b'.repeat(40) };

function c1() {
  const same = acceptanceRepeatGuard(ACCEPTED, 'a'.repeat(40), {});
  truthy(same.action === 'refuse', 'повтор того же контракта не отклонён: ' + same.action);

  const rework = acceptanceRepeatGuard(ACCEPTED, 'a'.repeat(40), { rework: '  переделал проверку  ' });
  truthy(rework.action === 'rework', 'с --rework повтор не разрешён: ' + rework.action);
  truthy(rework.rework === 'переделал проверку', 'причина не нормализована: ' + JSON.stringify(rework.rework));

  const forced = acceptanceRepeatGuard(ACCEPTED, 'a'.repeat(40), { force: true });
  truthy(forced.action === 'force', '--force не считается обходом: ' + forced.action);

  const changed = acceptanceRepeatGuard(OTHER, 'a'.repeat(40), {});
  truthy(changed.action === 'allow', 'новый контракт не считается обычной работой: ' + changed.action);

  const fresh = acceptanceRepeatGuard(null, 'a'.repeat(40), {});
  truthy(fresh.action === 'allow', 'первая приёмка требует причины: ' + fresh.action);

  const draft = acceptanceRepeatGuard({ status: 'draft', contractCommit: 'a'.repeat(40) }, 'a'.repeat(40), {});
  truthy(draft.action === 'allow', 'непринятая запись блокирует приёмку: ' + draft.action);
  console.log('REWORK OK c1');
}

function c2() {
  truthy(acceptanceNotes('обход allowMissingRed', 'переделал проверку') === 'обход allowMissingRed; rework: переделал проверку',
    'notes не склеены: ' + JSON.stringify(acceptanceNotes('обход allowMissingRed', 'переделал проверку')));
  truthy(acceptanceNotes(null, 'только причина') === 'rework: только причина', 'notes без обхода: ' + JSON.stringify(acceptanceNotes(null, 'только причина')));
  truthy(acceptanceNotes('только обход', '') === 'только обход', 'notes без переделки: ' + JSON.stringify(acceptanceNotes('только обход', '')));
  truthy(acceptanceNotes(undefined, undefined) === '', 'пустые notes не пусты');
  console.log('REWORK OK c2');
}

const table = { c1, c2 };
const which = process.argv[2];
if (!table[which]) {
  console.log('usage: node spec/checks/accept-rework.mjs c1|c2');
  process.exit(2);
}
try {
  table[which]();
} catch (error) {
  console.log('REWORK FAIL ' + which + ': ' + (error && error.message ? error.message : error));
  process.exit(1);
}
