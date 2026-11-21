#!/usr/bin/env node
/**
 * 0092 / 2.6.90: запись в реестр задач (docs/tasks/REGISTRY.json).
 *
 *   node tools/task-register.mjs --id 0092 --subject "Название" [--status open|accepted|cancelled] [--at YYYY-MM-DD] [--repo .] [--registry <файл>]
 *
 * Реестр — источник номера и предмета: task-lint сверяет номер и subject с
 * TASK-META.title, если файл реестра существует. Запись идемпотентна: повтор
 * с тем же id обновляет subject/status, а не плодит дубли.
 */
import fs from 'node:fs';
import path from 'node:path';
import { REGISTRY_REL, registryPathOf } from '../spec/scripts/lib/registry.mjs';

const argv = process.argv.slice(2);
const value = (flag) => { const i = argv.indexOf(flag); return i >= 0 ? argv[i + 1] : undefined; };
const repo = path.resolve(String(value('--repo') || '.'));
const id = String(value('--id') || '').trim();
const subject = String(value('--subject') || '').trim();
const status = String(value('--status') || 'open').trim();
const at = String(value('--at') || new Date().toISOString().slice(0, 10)).trim();
if (!/^[0-9]{4}$/u.test(id) || subject === '') {
  console.error('usage: node tools/task-register.mjs --id 0000 --subject "..." [--status open|accepted|cancelled] [--at YYYY-MM-DD] [--repo .] [--registry <файл>]');
  process.exit(2);
}
if (!['open', 'accepted', 'cancelled'].includes(status)) { console.error('status: open | accepted | cancelled'); process.exit(2); }
const file = registryPathOf(repo, value('--registry'));
let doc = { version: 1, tasks: [] };
if (fs.existsSync(file)) {
  try { doc = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (error) { console.error('REGISTRY.json не читается: ' + error.message); process.exit(3); }
}
if (!Array.isArray(doc.tasks)) doc.tasks = [];
const existing = doc.tasks.find((item) => String(item && item.id) === id);
if (existing) { existing.subject = subject; existing.status = status; existing.at = at; }
else doc.tasks.push({ id, subject, status, at });
doc.tasks.sort((a, b) => String(a.id).localeCompare(String(b.id)));
fs.mkdirSync(path.dirname(file), { recursive: true });
fs.writeFileSync(file, JSON.stringify(doc, null, 2) + '\n');
console.log('реестр: ' + (existing ? 'обновлено' : 'добавлено') + ' ' + id + ' «' + subject + '» [' + status + '] → ' + file);
