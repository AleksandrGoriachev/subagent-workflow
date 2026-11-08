#!/usr/bin/env node
/*
 * 0100 (WC-25): модель сессии по факту харнесса.
 *
 * Обязательства:
 *  - c1: проекция сессии с lastUsed даёт provider/model и источник projcache;
 *  - c2: нет файла проекции — null (не догадка);
 *  - c3: проекция без modelSelection — null;
 *  - c4: пустой или подозрительный id не превращается в путь.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { sessionModelFact, projcacheDir } from '../scripts/lib/session-model.mjs';

const truthy = (value, label) => { if (!value) throw new Error(label); };
const equal = (actual, expected, label) => {
  if (actual !== expected) throw new Error(label + ': ожидалось ' + JSON.stringify(expected) + ', получено ' + JSON.stringify(actual));
};

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-projcache-'));
const write = (id, payload) => fs.writeFileSync(path.join(dir, id + '.json'), JSON.stringify(payload));

/* c1 */
write('session-aaaa-1111', {
  version: 1,
  record: { rows: { modelSelection: { val: { lastUsed: { provider: 'opencode-go', model: 'glm-5.3-flash' }, pending: null } } } },
});
const fact = sessionModelFact('session-aaaa-1111', { dir });
truthy(fact, 'c1: факт должен читаться');
equal(fact.model, 'glm-5.3-flash', 'c1: модель');
equal(fact.provider, 'opencode-go', 'c1: провайдер');
equal(fact.source, 'projcache', 'c1: источник');
equal(path.dirname(fact.file), dir, 'c1: файл из указанного каталога');

/* c2 */
equal(sessionModelFact('session-нет-такой', { dir }), null, 'c2: нет проекции — null');

/* c3 */
write('session-bbbb-2222', { version: 1, record: { rows: { modelSelection: { val: { lastUsed: null } } } } });
equal(sessionModelFact('session-bbbb-2222', { dir }), null, 'c3: lastUsed пуст — null');

/* c4 */
equal(sessionModelFact('', { dir }), null, 'c4: пустой id');
equal(sessionModelFact('../../etc/passwd', { dir }), null, 'c4: id с разделителями пути');
equal(sessionModelFact('session-cccc-3333 ', { dir }), null, 'c4: отсутствующий файл — null, даже если id с пробелом');

/* переопределение каталога через env — тот же механизм, что в бою */
process.env.WF_PROJCACHE_DIR = dir;
equal(projcacheDir(), dir, 'c4: WF_PROJCACHE_DIR переопределяет каталог');

fs.rmSync(dir, { recursive: true, force: true });
console.log('model-source: OK c1–c4');
