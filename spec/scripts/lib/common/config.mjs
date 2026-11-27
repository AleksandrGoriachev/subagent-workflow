/*
 * Конфигурация: источники актора, loadConfig.
 *
 * 0181: часть spec/scripts/lib/common.mjs; публичный вход — common.mjs.
 */
import path from 'node:path';
import { fail } from './cli.mjs';
import { exists, readJson } from './fsio.mjs';
export const ACTOR_SOURCE_KINDS = ['harness', 'runner', 'ci', 'manual'];

/**
 * Нормализация блока actor (2.6.0).
 *
 * Правила:
 * 1. Непустой actor.sources — источник истины. Невалидные записи отбрасываются,
 *    текст ошибки складывается в actor.errors: молча «починить» конфиг нельзя,
 *    иначе неизвестный вид источника тихо стал бы разрешённым.
 * 2. Без sources (legacy) поведение прежнее: primaryEnv → harness, fallbackEnv →
 *    manual; уровень остаётся env/separate-session и declared соответственно.
 * 3. Файла конфига нет — дефолт нового пакета: DSH как harness, WF_ACTOR_SESSION
 *    как runner (обёртка проекта, а не DSH).
 * 4. Старые поля primaryEnv/fallbackEnv/modelEnv сохраняются без изменений:
 *    их читает панель и конфиги проектов.
 */
export function normalizeActorConfig(rawActor, { fileExists = true } = {}) {
  const raw = rawActor && typeof rawActor === 'object' && !Array.isArray(rawActor) ? rawActor : {};
  const errors = [];
  /* Старые поля живут в объекте всегда: их читает панель, а конфиг без них не должен падать. */
  const legacy = {
    primaryEnv: typeof raw.primaryEnv === 'string' && raw.primaryEnv.trim() !== '' ? raw.primaryEnv : 'DSH_SESSION_ID',
    fallbackEnv: typeof raw.fallbackEnv === 'string' && raw.fallbackEnv.trim() !== '' ? raw.fallbackEnv : 'TASK_ACTOR_SESSION',
    modelEnv: typeof raw.modelEnv === 'string' && raw.modelEnv.trim() !== '' ? raw.modelEnv : 'DSH_MODEL',
  };
  let sources;
  const declaredSources = raw.sources;
  if (Array.isArray(declaredSources) && declaredSources.length > 0) {
    sources = [];
    for (const [index, entry] of declaredSources.entries()) {
      const label = 'actor.sources[' + index + ']';
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
        errors.push(label + ': запись должна быть объектом { env, kind }');
        continue;
      }
      const env = typeof entry.env === 'string' ? entry.env.trim() : '';
      if (env === '') {
        errors.push(label + ': env должен быть непустой строкой — именем переменной окружения');
        continue;
      }
      if (!ACTOR_SOURCE_KINDS.includes(entry.kind)) {
        errors.push(label + ' (' + env + '): вид ' + JSON.stringify(entry.kind) + ' неизвестен, допустимы ' + ACTOR_SOURCE_KINDS.join(' | '));
        continue;
      }
      sources.push({ env, kind: entry.kind });
    }
  } else if (declaredSources !== undefined && !Array.isArray(declaredSources)) {
    errors.push('actor.sources должен быть массивом записей { env, kind }');
    sources = [];
  } else if (fileExists) {
    sources = [
      { env: legacy.primaryEnv, kind: 'harness' },
      { env: legacy.fallbackEnv, kind: 'manual' },
    ];
  } else {
    sources = [
      { env: 'DSH_SESSION_ID', kind: 'harness' },
      { env: 'WF_ACTOR_SESSION', kind: 'runner' },
    ];
  }
  const declaredModels = Array.isArray(raw.modelSources)
    ? raw.modelSources
      .filter((name) => typeof name === 'string' && name.trim() !== '')
      .map((name) => name.trim())
    : [];
  const modelSources = declaredModels.length > 0
    ? declaredModels
    : [legacy.modelEnv, 'WF_ACTOR_MODEL'];
  return { ...raw, ...legacy, sources, modelSources, errors };
}

/**
 * Конфигурация рабочего пространства. Лежит в репозитории, поэтому пути и
 * политика логирования одинаковы у всех, кто запускает ворота.
 */
export function loadConfig(repo, fileName = 'docs/subagent-workflow/workflow.config.json') {
  const file = path.join(repo, fileName);
  const defaults = {
    version: 1,
    tasksDir: 'docs/tasks',
    keysFile: 'docs/subagent-workflow/acceptors.json',
    logs: 'local',
    actor: { primaryEnv: 'DSH_SESSION_ID', fallbackEnv: 'TASK_ACTOR_SESSION', modelEnv: 'DSH_MODEL' },
    policy: { decisions: 'fail', coverage: 'fail', attack: 'off', roles: { modelFamily: 'warn' } },
    models: {},
    roles: {},
    verifyTimeoutMs: 1800000,
  };
  if (!exists(file)) return { ...defaults, actor: normalizeActorConfig({}, { fileExists: false }), loaded: false, file };
  const raw = readJson(file);
  return {
    ...defaults,
    ...raw,
    actor: normalizeActorConfig(raw.actor, { fileExists: true }),
    policy: { ...defaults.policy, ...(raw.policy || {}), roles: { ...defaults.policy.roles, ...((raw.policy || {}).roles || {}) } },
    models: { ...defaults.models, ...(raw.models || {}) },
    roles: { ...defaults.roles, ...(raw.roles || {}) },
    loaded: true,
    file,
  };
}

