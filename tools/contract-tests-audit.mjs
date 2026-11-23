#!/usr/bin/env node
/*
 * 0127 (2.6.106): контракты должны проверяться отбором, а не полным набором.
 *
 * Долг из хендовера и причина 5 замера structure: полный прогон на каждом шаге.
 * tools/check-tests.mjs (2.6.99) отбирает проверку по изменённым файлам, но им
 * пользуется горстка контрактов, а шаблон задания его не называл вовсе. Здесь
 * аудит: какие контракты запускают полный набор плагина напрямую (plugin/tools/test.mjs
 * или node --test plugin/test) вместо check-tests.
 *
 *   node tools/contract-tests-audit.mjs [--tasks <каталог>] [--since <id>] [--json] [--strict]
 *
 * Без --strict — отчёт, код 0. С --strict — отказ (код 1), если контракт с id >= --since
 * запускает полный набор без check-tests: новые задания не должны возвращать долг.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PKG = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const NL = String.fromCharCode(10);
const argv = process.argv.slice(2);
if (argv.includes('--help') || argv.includes('-h')) {
  process.stdout.write('contract-tests-audit: node tools/contract-tests-audit.mjs [--tasks <каталог>] [--since <id>] [--json] [--strict]' + NL);
  process.exit(0);
}
function valueOf(flag) {
  const at = argv.indexOf(flag);
  return at >= 0 && argv[at + 1] !== undefined && !String(argv[at + 1]).startsWith('--') ? String(argv[at + 1]) : '';
}
const tasksRoot = path.resolve(valueOf('--tasks') || path.join(PKG, 'docs', 'tasks'));
const since = valueOf('--since').trim();
const asJson = argv.includes('--json');
const strict = argv.includes('--strict');

if (!fs.existsSync(tasksRoot)) {
  process.stderr.write('audit: нет каталога задач ' + tasksRoot + NL);
  process.exit(2);
}

/*
 * Полный набор — это plugin/tools/test.mjs (сборщик списка тестов), а не один файл:
 * `node --test plugin/test/x.test.mjs` — точечная проверка, она долг не образует.
 */
const FULL_SUITE = [/(^|[\\/])plugin[\\/]tools[\\/]test\.mjs(?![\w.-])/u, /npm\s+(run\s+)?test(?![\w-])/u];

function readCriteria(dir) {
  try {
    return JSON.parse(fs.readFileSync(path.join(dir, 'criteria.json'), 'utf8'));
  } catch {
    return null;
  }
}

const rows = [];
for (const entry of fs.readdirSync(tasksRoot, { withFileTypes: true })) {
  if (!entry.isDirectory()) continue;
  const id = entry.name;
  if (!/^\d{4}$/u.test(id)) continue;
  const criteria = readCriteria(path.join(tasksRoot, id));
  if (!criteria) continue;
  const commands = Array.isArray(criteria.criteria) ? criteria.criteria.map((item) => String((item && item.command) || '')) : [];
  const fullSuite = commands.filter((command) => FULL_SUITE.some((pattern) => pattern.test(command)));
  const manualTests = commands.filter((command) => /(^|\s)node\s+--test\s|plugin[\\/]tools[\\/]test\.mjs/u.test(command));
  const hasCheckTests = commands.some((command) => /tools[\\/]check-tests\.mjs/u.test(command));
  const applicable = since === '' || id >= since;
  /*
   * Три состояния: с check-tests; тесты вручную (долг: набор выбирали руками, отбор
   * не применяется); без тестов (док-задачи). Долг — только ручной набор, и только
   * в области --since: историю не переписываем.
   */
  const mode = hasCheckTests ? 'check-tests' : (manualTests.length > 0 ? 'manual-tests' : 'none');
  const verdict = mode === 'manual-tests' ? 'legacy' : 'ok';
  rows.push({ task: id, mode, hasCheckTests, manualTests, fullSuite, applicable, verdict });
}

const violations = rows.filter((row) => row.applicable && row.verdict === 'legacy');
if (asJson) {
  process.stdout.write(JSON.stringify({ tasksRoot, since: since || null, strict, count: rows.length, violations: violations.map((row) => row.task), tasks: rows }, null, 2) + NL);
} else {
  process.stdout.write('audit: ' + tasksRoot + (since ? ' (с ' + since + ')' : '') + NL);
  const legacy = rows.filter((row) => row.verdict === 'legacy');
  if (legacy.length === 0) process.stdout.write('  контрактов без check-tests нет' + NL);
  for (const row of legacy) {
    process.stdout.write('  ' + row.task + (row.applicable ? '' : ' (не в области --since)') + '  тесты вручную: ' + row.manualTests.slice(0, 2).join(' | ') + NL);
  }
  const adopted = rows.filter((row) => row.mode === 'check-tests').length;
  const none = rows.filter((row) => row.mode === 'none').length;
  process.stdout.write('  с check-tests: ' + adopted + ' из ' + rows.length + ', без тестов: ' + none + NL);
}
process.exit(strict && violations.length > 0 ? 1 : 0);
