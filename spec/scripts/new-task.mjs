#!/usr/bin/env node
/*
 * Новое задание из шаблонов: каталог, task.md с issuedBy, criteria.json.
 * Ничего не коммитит и не запускает — это делает человек/оркестратор по чек-листу.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig, repoRoot } from './lib/common.mjs';
import { detectActor } from './actor.mjs';

function args(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith('--')) { out[a.slice(2)] = next; i += 1; }
      else out[a.slice(2)] = true;
    } else out._.push(a);
  }
  return out;
}

const argv = args(process.argv.slice(2));
if (argv.help || !argv.id) {
  console.log('Usage: node new-task.mjs --id 0001 --title "..." --risk medium [--repo .] [--executor subagent:executor] [--acceptor subagent:judge]');
  console.log('issuedBy берётся из первого непустого источника actor.sources (например DSH_SESSION_ID или WF_ACTOR_SESSION),');
  console.log('модель — из actor.modelSources. Источник и его вид печатаются ниже.');
  process.exit(argv.id ? 0 : 1);
}

const repo = path.resolve(String(argv.repo || '.'));
const config = loadConfig(repo);
const workflowDir = path.join(repo, 'docs', 'subagent-workflow');
const id = String(argv.id);
if (!/^[0-9A-Za-z._-]+$/.test(id)) { console.error('new-task: недопустимый id'); process.exit(1); }
const risk = String(argv.risk || 'medium');
if (!['low', 'medium', 'high'].includes(risk)) { console.error('new-task: --risk low|medium|high'); process.exit(1); }
const taskDir = path.join(repo, config.tasksDir, id);
if (fs.existsSync(taskDir) && !argv.force) { console.error('new-task: каталог уже существует: ' + taskDir); process.exit(1); }
fs.mkdirSync(taskDir, { recursive: true });

/* Тот же резолвер, что у ворот: источники, вид основания и модель из конфига. */
const actor = detectActor(process.env, config.actor);
const session = actor.session || '';
const model = actor.model;
const sourceErrors = Array.isArray(config.actor.errors) ? config.actor.errors : [];
if (sourceErrors.length > 0) {
  console.error('new-task: WARN actor.sources: ' + sourceErrors.join('; '));
}
if (risk !== 'low' && session === '') {
  const configured = config.actor.sources.map((source) => source.env).join(', ') || 'нет источников';
  console.error('new-task: нет сессии постановщика — ни один источник актора не задан (' + configured + '): для medium/high issuedBy обязателен');
  process.exit(1);
}

let taskMd = fs.readFileSync(path.join(workflowDir, 'templates', 'task.md'), 'utf8');
const title = String(argv.title || '<короткое название>');
taskMd = taskMd
  .replace(/^# Задание NNNN\..*$/m, '# Задание ' + id + '. ' + title)
  .replace(/"title": "<короткое название>"/, '"title": ' + JSON.stringify(title))
  .replace(/"risk": "medium"/, '"risk": ' + JSON.stringify(risk))
  .replace(/"created": "YYYY-MM-DD"/, '"created": ' + JSON.stringify(new Date().toISOString().slice(0, 10)))
  .replace(/<DSH_SESSION_ID постановщика>/, session || '<сессия>')
  .replace(/<модель>/, model)
  .replace(/NNNN/g, id);
fs.writeFileSync(path.join(taskDir, 'task.md'), taskMd);

let criteria = fs.readFileSync(path.join(workflowDir, 'templates', 'criteria.json'), 'utf8');
criteria = criteria.replace(/"task": "NNNN"/, '"task": ' + JSON.stringify(id));
fs.writeFileSync(path.join(taskDir, 'criteria.json'), criteria);

console.log('new-task: создано ' + path.relative(repo, taskDir).split(path.sep).join('/'));
if (session) console.log('  issuedBy   ' + session + ' [' + actor.attestedBy + '] ' + actor.source + ' (' + actor.sourceKind + ')');
if (!session) console.log('  issuedBy   — (источник актора не задан; допустимо только для low)');
console.log('');
console.log('Дальше:');
console.log('  1. Заполните цель, границы и критерии в task.md/criteria.json.');
console.log('  2. git add ' + config.tasksDir + '/' + id + ' checks  && git commit -m "task ' + id + ': контракт"');
console.log('  3. node docs/subagent-workflow/scripts/task-hash.mjs --task ' + config.tasksDir + '/' + id + ' --write');
console.log('  4. node docs/subagent-workflow/scripts/task-lint.mjs --task ' + config.tasksDir + '/' + id + ' --strict');
console.log('  5. node docs/subagent-workflow/scripts/task-red.mjs  --task ' + config.tasksDir + '/' + id + ' --base HEAD');
