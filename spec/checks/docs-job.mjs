#!/usr/bin/env node
/*
 * 0172: сторож job.mjs назван штатным способом длинных прогонов и замеров.
 *   c1 — INSTALL: раздел, start/wait/log, запрет пауз (Start-Sleep), замеры;
 *   c2 — шаблон: тот же рецепт для пауз и замеров в разделе «Среда».
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

const mode = String(process.argv[2] || '').toLowerCase();
let bad = 0;
function fail(tag, message) { bad += 1; console.log('FAIL ' + tag + ': ' + message); }

if (mode === 'c1') {
  const text = fs.readFileSync(path.join(PKG, 'INSTALL.md'), 'utf8');
  if (!/Длинные прогоны и замеры/u.test(text)) fail('c1', 'в INSTALL нет раздела «Длинные прогоны и замеры»');
  for (const needle of ['job.mjs start', 'job.mjs wait', 'job.mjs log']) {
    if (!text.includes(needle)) fail('c1', 'не названо: ' + needle);
  }
  if (!/Start-Sleep/u.test(text)) fail('c1', 'не назван запрет пауз (Start-Sleep)');
  if (!/120/u.test(text)) fail('c1', 'не назван предел паузы');
  if (!/heartbeat|замер/iu.test(text)) fail('c1', 'не сказано про замеры с интервалом');
  if (bad === 0) console.log('DOCS-JOB OK c1');
  process.exit(bad === 0 ? 0 : 1);
}

if (mode === 'c2') {
  const text = fs.readFileSync(path.join(PKG, 'spec', 'templates', 'task.md'), 'utf8');
  if (!/job\.mjs start/u.test(text)) fail('c2', 'шаблон не называет job.mjs start');
  if (!/job\.mjs wait/u.test(text)) fail('c2', 'шаблон не называет job.mjs wait');
  if (!/Start-Sleep/u.test(text)) fail('c2', 'шаблон не называет запрет пауз');
  if (!/замер|heartbeat/iu.test(text)) fail('c2', 'шаблон не говорит про замеры');
  if (bad === 0) console.log('DOCS-JOB OK c2');
  process.exit(bad === 0 ? 0 : 1);
}

console.log('usage: node spec/checks/docs-job.mjs c1|c2');
process.exit(2);
