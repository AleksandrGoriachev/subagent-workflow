#!/usr/bin/env node
/* Задание 0020: проверки не хардкодят версии (2.6.4).
 * Версии проверяет tools/check-version.mjs; spec/checks/* не должны содержать
 * литералов текущей версии спеки и плагина — иначе после каждого релиза
 * проверка краснеет (deploy-safety 2.6.3/0.7.1 после выпуска 2.6.4). */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PKG = path.resolve(HERE, '..', '..');
let failed = 0;
const pass = (n) => console.log('PASS ' + n);
const fail = (n, d) => { failed += 1; console.log('FAIL ' + n + (d ? ' — ' + d : '')); };

const specVersion = fs.readFileSync(path.join(PKG, 'VERSION'), 'utf8').trim();
const pluginVersion = JSON.parse(fs.readFileSync(path.join(PKG, 'plugin', 'package.json'), 'utf8')).version;
console.log('версия спеки: ' + specVersion + ', плагина: ' + pluginVersion);

const files = fs.readdirSync(path.join(PKG, 'spec', 'checks')).filter((f) => f.endsWith('.mjs'));
const skip = new Set(['version-drift.mjs']);
for (const name of files) {
  if (skip.has(name)) continue;
  const raw = fs.readFileSync(path.join(PKG, 'spec', 'checks', name), 'utf8');
  /* Комментарии не считаем: они не влияют на поведение проверки. */
  const text = raw.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').map((line) => line.replace(/\/\/.*$/, '')).join('\n');
  const problems = [];
  if (text.includes(specVersion)) problems.push('литерал спеки ' + specVersion);
  if (text.includes(pluginVersion)) problems.push('литерал плагина ' + pluginVersion);
  if (problems.length === 0) pass(name + ': без литералов версий');
  else fail(name + ': без литералов версий', problems.join(', '));
}

/* Проверки сборки должны читать версию плагина из манифеста, а не помнить её. */
for (const name of ['panel-deploy.mjs', 'acceptance-schema.mjs']) {
  const text = fs.readFileSync(path.join(PKG, 'spec', 'checks', name), 'utf8');
  if (/plugin['\"]?\s*,\s*['\"]package\.json/.test(text) || /package\.json/.test(text)) pass(name + ': читает plugin/package.json');
  else fail(name + ': читает plugin/package.json');
}

if (failed > 0) { console.log(''); console.log('VERSION DRIFT FAIL: ' + failed); process.exit(1); }
console.log(''); console.log('VERSION DRIFT OK');