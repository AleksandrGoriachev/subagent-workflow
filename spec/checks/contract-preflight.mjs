#!/usr/bin/env node
/*
 * 0092 (WC-20): контракт до красного.
 *
 * Обязательства:
 *  - c1: mustPass зелёные на базе — preflight ok;
 *  - c2: mustPass красный — preflight не ok (красный прогон не докажет поведение);
 *  - c3: дешёвая mustPass упала — дорогая не запускается (skipped);
 *  - c4: mustPass не объявлены — проверять нечего, preflight пустой и ok.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { preflightMustPass } from '../scripts/lib/preflight.mjs';

const truthy = (value, label) => { if (!value) throw new Error(label); };
const equal = (actual, expected, label) => {
  if (actual !== expected) throw new Error(label + ': ожидалось ' + JSON.stringify(expected) + ', получено ' + JSON.stringify(actual));
};

const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-preflight-'));
const quiet = () => {};

/* c1 */
const green = {
  redExpect: { mustPass: ['C4'] },
  criteria: [{ id: 'C4', command: 'node -e "process.exit(0)"', expect: { exitCode: 0 }, timeoutMs: 60000 }],
};
const c1 = await preflightMustPass({ repo, criteria: green, log: quiet });
truthy(c1.ok, 'c1: зелёный mustPass должен проходить');
equal(c1.rows.length, 1, 'c1: одна проверка');

/* c2 */
const red = {
  redExpect: { mustPass: ['C4'] },
  criteria: [{ id: 'C4', command: 'node -e "process.exit(3)"', expect: { exitCode: 0 }, timeoutMs: 60000 }],
};
const c2 = await preflightMustPass({ repo, criteria: red, log: quiet });
truthy(c2.ok === false, 'c2: красный mustPass должен отклонять контракт');
equal(c2.rows[0].exitCode, 3, 'c2: код выхода');

/* c3 */
const mixed = {
  redExpect: { mustPass: ['C1', 'C2'] },
  criteria: [
    { id: 'C1', command: 'node -e "process.exit(2)"', expect: { exitCode: 0 }, timeoutMs: 60000 },
    { id: 'C2', command: 'node -e "process.exit(0)"', expect: { exitCode: 0 }, timeoutMs: 300000, tags: ['expensive'] },
  ],
};
const c3 = await preflightMustPass({ repo, criteria: mixed, log: quiet });
truthy(c3.ok === false, 'c3: пачка с красной дешёвой не ok');
equal(c3.skipped.join(','), 'C2', 'c3: дорогая пропущена');
equal(c3.rows.length, 1, 'c3: дорогая не запускалась');

/* c4 */
const empty = await preflightMustPass({ repo, criteria: { criteria: [] }, log: quiet });
truthy(empty.ok && empty.empty, 'c4: без mustPass проверять нечего');

fs.rmSync(repo, { recursive: true, force: true });
console.log('contract-preflight: OK c1–c4');
