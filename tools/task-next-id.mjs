#!/usr/bin/env node
/**
 * 0092 / 2.6.90: следующий свободный номер задачи.
 *
 *   node tools/task-next-id.mjs [--repo .] [--registry <файл>]
 *
 * Берёт максимум по реестру и по каталогам docs/tasks/<4 цифры>, добавляет 1
 * и печатает с ведущими нулями. Реестра нет — считает только по каталогам.
 */
import fs from 'node:fs';
import path from 'node:path';
import { REGISTRY_REL, registryPathOf } from '../spec/scripts/lib/registry.mjs';

const argv = process.argv.slice(2);
const value = (flag) => { const i = argv.indexOf(flag); return i >= 0 ? argv[i + 1] : undefined; };
const repo = path.resolve(String(value('--repo') || '.'));
const tasksDir = path.join(repo, path.dirname(REGISTRY_REL));
const numbers = [];
const file = registryPathOf(repo, value('--registry'));
if (fs.existsSync(file)) {
  try {
    const doc = JSON.parse(fs.readFileSync(file, 'utf8'));
    for (const item of (doc.tasks || [])) {
      const n = Number.parseInt(String(item && item.id), 10);
      if (Number.isFinite(n)) numbers.push(n);
    }
  } catch { /* битый реестр не мешает посчитать по каталогам */ }
}
if (fs.existsSync(tasksDir)) {
  for (const name of fs.readdirSync(tasksDir)) {
    if (!/^[0-9]{4}$/u.test(name)) continue;
    numbers.push(Number.parseInt(name, 10));
  }
}
const next = (numbers.length === 0 ? 0 : Math.max(...numbers)) + 1;
console.log(String(next).padStart(4, '0'));
