#!/usr/bin/env node
/*
 * 2.6.33 (0074, WC-58): императив воркспейса проверяется машиной.
 *
 * Правило (docs/IMPERATIVE-workspaces.md): воркспейс с движком держит сторож
 * (scripts/job.mjs), версию не ниже 2.6.31 и политику ожиданий не «off».
 * processPolicy проверяется только когда в воркспейсе есть задания движка:
 * проектному воркспейсу без заданий держать «fail» бессмысленно.
 *
 * Обязательства:
 *  - c1: в развёрнутой копии есть job.mjs, VERSION >= 2.6.31, enforcement.waitPolicy != off;
 *  - c2: processPolicy != off, если docs/tasks содержит хотя бы одно задание; иначе — допустимо;
 *  - c3: битый или отсутствующий конфиг даёт внятный отказ с рецептом (не молчание);
 *  - c4: вне развёрнутого воркспейса (в самом пакете) — SKIP по конвенции deployed-copy.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PKG = path.resolve(HERE, '..', '..');
const truthy = (value, label) => { if (!value) throw new Error(label); };

function workflowDir() {
  if (process.env.WF_WORKFLOW_DIR) return process.env.WF_WORKFLOW_DIR;
  const local = path.join(PKG, 'docs', 'subagent-workflow');
  if (fs.existsSync(path.join(local, 'VERSION'))) return local;
  /* Пакет может лежать внутри воркспейса: тогда движок развёрнут рядом. */
  const parent = path.resolve(PKG, '..', 'docs', 'subagent-workflow');
  if (fs.existsSync(path.join(parent, 'VERSION'))) return parent;
  return local;
}

function workspaceRoot(dir) {
  return path.resolve(dir, '..', '..');
}

function readConfig(dir) {
  const file = path.join(dir, 'workflow.config.json');
  truthy(fs.existsSync(file), 'нет ' + file + ' — воркспейс не развёрнут (node spec/scripts/init.mjs --repo <root>)');
  let parsed;
  try { parsed = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (error) {
    throw new Error('workflow.config.json не JSON: ' + (error && error.message ? error.message : error));
  }
  return { file, config: parsed && typeof parsed === 'object' ? parsed : {} };
}

function versionAtLeast(text, major, minor, patch) {
  const m = /^(\d+)\.(\d+)\.(\d+)/.exec(String(text || '').trim());
  if (!m) return false;
  const [a, b, c] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (a !== major) return a > major;
  if (b !== minor) return b > minor;
  return c >= patch;
}

function c1() {
  const dir = workflowDir();
  truthy(fs.existsSync(path.join(dir, 'scripts', 'job.mjs')), 'нет scripts/job.mjs — движок старше 2.6.31, поставьте обновление');
  const version = fs.readFileSync(path.join(dir, 'VERSION'), 'utf8');
  truthy(versionAtLeast(version, 2, 6, 31), 'VERSION ' + version.trim() + ' старше 2.6.31');
  const { config } = readConfig(dir);
  const enforcement = config.enforcement && typeof config.enforcement === 'object' ? config.enforcement : {};
  truthy(enforcement.waitPolicy !== 'off', 'enforcement.waitPolicy = off: долгие ожидания не проверяются');
  truthy(['fail', 'warn'].includes(enforcement.waitPolicy), 'enforcement.waitPolicy = ' + JSON.stringify(enforcement.waitPolicy) + ' — допустимо fail|warn|off');
  if (enforcement.waitBudgetMs !== undefined) {
    truthy(Number.isFinite(Number(enforcement.waitBudgetMs)) && Number(enforcement.waitBudgetMs) > 0, 'enforcement.waitBudgetMs должно быть положительным числом');
  }
  console.log('IMPERATIVE OK c1');
}

function c2() {
  const dir = workflowDir();
  const { config } = readConfig(dir);
  const enforcement = config.enforcement && typeof config.enforcement === 'object' ? config.enforcement : {};
  const tasksDir = path.join(workspaceRoot(dir), config.tasksDir || 'docs/tasks');
  const hasTasks = fs.existsSync(tasksDir)
    && fs.readdirSync(tasksDir, { withFileTypes: true }).some((entry) => entry.isDirectory() && /^\d{4}$/.test(entry.name));
  if (!hasTasks) {
    console.log('IMPERATIVE OK c2 (заданий движка нет — processPolicy не требуется, сейчас ' + JSON.stringify(enforcement.processPolicy) + ')');
    return;
  }
  truthy(enforcement.processPolicy !== 'off', 'в воркспейсе есть задания движка, но enforcement.processPolicy = off');
  console.log('IMPERATIVE OK c2');
}

function c3() {
  const dir = workflowDir();
  const { config } = readConfig(dir);
  truthy(config.enforcement && typeof config.enforcement === 'object', 'в workflow.config.json нет блока enforcement — добавьте (init досыпает недостающие ключи при --force)');
  console.log('IMPERATIVE OK c3');
}

function c4() {
  const deployed = workflowDir();
  if (!fs.existsSync(path.join(deployed, 'VERSION'))) {
    console.log('SKIP: проверка императива вне развёрнутого воркспейса');
    return;
  }
  const { config } = readConfig(deployed);
  const enforcement = config.enforcement || {};
  for (const key of ['waitPolicy', 'waitBudgetMs', 'processPolicy', 'structurePolicy']) {
    truthy(Object.prototype.hasOwnProperty.call(enforcement, key), 'в enforcement нет ключа ' + key + ' — init --force досыпает недостающие');
  }
  console.log('IMPERATIVE OK c4');
}

const table = { c1, c2, c3, c4 };
const which = process.argv[2];
if (!table[which]) {
  console.log('usage: node spec/checks/workspace-imperative.mjs c1|c2|c3|c4');
  process.exit(2);
}
try { table[which](); } catch (error) {
  console.log('IMPERATIVE FAIL ' + which + ': ' + (error && error.message ? error.message : error));
  process.exit(1);
}
