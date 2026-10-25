#!/usr/bin/env node
/*
 * Проверка целостности распакованного пакета по CHECKSUMS.sha256.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const file = path.join(root, 'CHECKSUMS.sha256');
if (!fs.existsSync(file)) {
  console.error('verify: нет CHECKSUMS.sha256 рядом с tools/');
  process.exit(1);
}

let bad = 0;
let total = 0;
for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
  if (!line.trim()) continue;
  const match = /^([0-9a-f]{64})\s{2}(.+)$/.exec(line);
  if (!match) { console.error('verify: непонятная строка: ' + line); bad += 1; continue; }
  const [, expected, rel] = match;
  const target = path.join(root, rel.split('/').join(path.sep));
  total += 1;
  if (!fs.existsSync(target)) { console.error('MISSING ' + rel); bad += 1; continue; }
  const actual = crypto.createHash('sha256').update(fs.readFileSync(target)).digest('hex');
  if (actual !== expected) { console.error('CHANGED ' + rel); bad += 1; }
}

console.log(bad ? 'verify: ' + bad + ' проблем из ' + total : 'verify: ok (' + total + ' файлов)');
process.exit(bad ? 1 : 0);
