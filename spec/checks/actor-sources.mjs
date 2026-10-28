#!/usr/bin/env node
/*
 * Приёмочные проверки задания 0008: актор без DSH.
 *
 * Каждый сценарий строит одноразовый репозиторий, разворачивает в нём копию
 * пакета (spec/ -> docs/subagent-workflow/), пишет свой workflow.config.json и
 * запускает штатные ворота с ЯВНО подменённым окружением: DSH_SESSION_ID из
 * окружения проверяющего удаляется, иначе проверка была бы вакуумной.
 *
 * Проверяется то, что обещано в контракте:
 *   - источник актора берётся из actor.sources, вид источника определяет уровень;
 *   - harness и runner дают separate-session, ci и manual — declared;
 *   - пустое окружение — none/declared, doctor красный (контроль);
 *   - legacy-конфиг (primaryEnv/fallbackEnv без sources) ведёт себя как раньше;
 *   - неизвестный вид источника закрывает ворота, а не повышает уровень.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PKG = path.resolve(HERE, '..', '..');
/* 2.6.2: проверка относится к пакету (spec/checks); в развёрнутой копии spec/SPEC.md нет — SKIP. */
if (!fs.existsSync(path.join(PKG, 'spec', 'SPEC.md'))) {
  console.log('SKIP: проверка относится к пакету (spec/checks), а не к развёрнутой копии');
  process.exit(0);
}
const CONFIG_REL = path.join('docs', 'subagent-workflow', 'workflow.config.json');
const SCRIPT = (repo, name) => path.join(repo, 'docs', 'subagent-workflow', 'scripts', name);
let failed = 0;

const pass = (name) => console.log('PASS ' + name);
const fail = (name, detail) => { failed += 1; console.log('FAIL ' + name + (detail ? ' — ' + detail : '')); };

function copyTree(from, to) {
  fs.mkdirSync(to, { recursive: true });
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    const source = path.join(from, entry.name);
    const target = path.join(to, entry.name);
    if (entry.isDirectory()) copyTree(source, target);
    else if (entry.isFile()) {
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.copyFileSync(source, target);
    }
  }
}

/* Окружение проверяющего не должно протекать в сценарий. */
const ACTOR_ENVS = ['DSH_SESSION_ID', 'WF_ACTOR_SESSION', 'TASK_ACTOR_SESSION', 'GITHUB_RUN_ID', 'DSH_MODEL', 'WF_ACTOR_MODEL', 'TASK_ACTOR_MODEL'];
function envWith(extra) {
  const env = { ...process.env, ...(extra || {}) };
  for (const key of ACTOR_ENVS) if (!(extra && key in extra)) delete env[key];
  return env;
}

function makeRepo(actorConfig) {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-actor-'));
  const git = (args) => spawnSync('git', args, { cwd: repo, encoding: 'utf8' });
  git(['init', '-q']);
  git(['config', 'user.email', 'actor@local']);
  git(['config', 'user.name', 'actor']);
  copyTree(path.join(PKG, 'spec'), path.join(repo, 'docs', 'subagent-workflow'));
  fs.copyFileSync(
    path.join(PKG, 'docs', 'subagent-workflow', 'acceptors.json'),
    path.join(repo, 'docs', 'subagent-workflow', 'acceptors.json'),
  );
  const config = JSON.parse(fs.readFileSync(path.join(PKG, 'spec', 'workflow.config.json'), 'utf8'));
  if (actorConfig === null) delete config.actor;
  else config.actor = actorConfig;
  fs.writeFileSync(path.join(repo, CONFIG_REL), JSON.stringify(config, null, 2) + '\n');
  return repo;
}

function cleanup(repo) {
  try { fs.rmSync(repo, { recursive: true, force: true }); } catch { /* ignore */ }
}

function node(repo, script, args, env) {
  const result = spawnSync(process.execPath, [SCRIPT(repo, script), ...args], {
    cwd: repo, env, encoding: 'utf8', timeout: 120000,
  });
  return { code: result.status, out: String(result.stdout || '') + String(result.stderr || '') };
}

function json(repo, script, args, env) {
  const result = node(repo, script, args, env);
  try {
    return { code: result.code, value: JSON.parse(result.out), out: result.out };
  } catch {
    return { code: result.code, value: null, out: result.out };
  }
}

function field(value, key) {
  return value && value.actor ? String(value.actor[key] === undefined ? 'undefined' : value.actor[key]) : 'undefined';
}

function scenario(name, actorConfig, env, expected) {
  const repo = makeRepo(actorConfig);
  try {
    const probe = json(repo, 'actor.mjs', ['--json', '--risk', 'medium'], env);
    if (!probe.value) return fail(name, 'actor.mjs --json не вернул JSON: ' + probe.out.trim().slice(0, 200));
    const problems = [];
    for (const key of Object.keys(expected.actor || {})) {
      const actual = field(probe.value, key);
      if (actual !== expected.actor[key]) problems.push(key + '=' + actual + ' (ожидалось ' + expected.actor[key] + ')');
    }
    if (expected.level && probe.value.level !== expected.level) problems.push('level=' + probe.value.level + ' (ожидалось ' + expected.level + ')');
    if (expected.code !== undefined && probe.code !== expected.code) problems.push('exit=' + probe.code + ' (ожидалось ' + expected.code + ')');
    if (expected.doctor !== undefined) {
      const doctor = node(repo, 'doctor.mjs', ['--repo', '.'], env);
      const ok = expected.doctor === 'pass' ? doctor.code === 0 && /PASS\s+актор виден окружению/.test(doctor.out) : doctor.code !== 0;
      if (!ok) problems.push('doctor exit=' + doctor.code);
    }
    if (problems.length) return fail(name, problems.join('; '));
    return pass(name);
  } finally {
    cleanup(repo);
  }
}

/* 1. runner: обёртка проекта выставляет WF_ACTOR_SESSION — medium разрешён. */
scenario('runner: WF_ACTOR_SESSION даёт separate-session',
  { sources: [{ env: 'WF_ACTOR_SESSION', kind: 'runner' }], modelSources: ['WF_ACTOR_MODEL'] },
  envWith({ WF_ACTOR_SESSION: 'runner-session-1' }),
  { actor: { attestedBy: 'env', session: 'runner-session-1', source: 'WF_ACTOR_SESSION', sourceKind: 'runner' }, level: 'separate-session', code: 0, doctor: 'pass' });

/* 2. harness: DSH остаётся одним из источников, поведение не изменилось. */
scenario('harness: DSH_SESSION_ID по-прежнему separate-session',
  { sources: [{ env: 'DSH_SESSION_ID', kind: 'harness' }] },
  envWith({ DSH_SESSION_ID: 'harness-session-1' }),
  { actor: { attestedBy: 'env', source: 'DSH_SESSION_ID', sourceKind: 'harness' }, level: 'separate-session', code: 0 });

/* 3. ci: та же машина — уровень declared, medium закрыт. */
scenario('ci: GITHUB_RUN_ID даёт только declared',
  { sources: [{ env: 'GITHUB_RUN_ID', kind: 'ci' }] },
  envWith({ GITHUB_RUN_ID: '42' }),
  { actor: { attestedBy: 'declared', sourceKind: 'ci' }, level: 'declared', code: 1 });

/* 4. manual: ручная переменная — declared, medium закрыт. */
scenario('manual: TASK_ACTOR_SESSION даёт только declared',
  { sources: [{ env: 'TASK_ACTOR_SESSION', kind: 'manual' }] },
  envWith({ TASK_ACTOR_SESSION: 'manual-session' }),
  { actor: { attestedBy: 'declared', sourceKind: 'manual' }, level: 'declared', code: 1 });

/* 5. Контроль: источник настроен, окружение пустое — ворота отказывают. */
scenario('контроль: пустое окружение — none и doctor красный',
  { sources: [{ env: 'WF_ACTOR_SESSION', kind: 'runner' }] },
  envWith({}),
  { actor: { attestedBy: 'none' }, level: 'declared', code: 1, doctor: 'fail' });

/* 6. Legacy: старый конфиг (primaryEnv/fallbackEnv, без sources) не изменился. */
scenario('legacy: primaryEnv — env/separate-session как раньше',
  { primaryEnv: 'DSH_SESSION_ID', fallbackEnv: 'TASK_ACTOR_SESSION', modelEnv: 'DSH_MODEL' },
  envWith({ DSH_SESSION_ID: 'legacy-primary' }),
  { actor: { attestedBy: 'env', session: 'legacy-primary' }, level: 'separate-session', code: 0 });

scenario('legacy: fallbackEnv — declared как раньше',
  { primaryEnv: 'DSH_SESSION_ID', fallbackEnv: 'TASK_ACTOR_SESSION', modelEnv: 'DSH_MODEL' },
  envWith({ TASK_ACTOR_SESSION: 'legacy-fallback' }),
  { actor: { attestedBy: 'declared', session: 'legacy-fallback' }, level: 'declared', code: 1 });

/* 7. Неизвестный вид источника не повышает уровень: doctor обязан быть красным. */
scenario('неизвестный вид источника закрывает ворота',
  { sources: [{ env: 'WF_ACTOR_SESSION', kind: 'vendor' }] },
  envWith({ WF_ACTOR_SESSION: 'vendor-session' }),
  { doctor: 'fail', code: 1 });

if (failed > 0) {
  console.log('');
  console.log('ACTOR SOURCES FAIL: ' + failed);
  process.exit(1);
}
console.log('');
console.log('ACTOR SOURCES OK');
