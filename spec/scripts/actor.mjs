#!/usr/bin/env node
/*
 * Аттестация актора и уровень независимости.
 *
 * Идея: ворота не верят строке --acceptor. Они берут идентификатор сессии из
 * окружения (его выставляет харнесс или обёртка проекта, а не аргументы
 * команды), сравнивают его с сессией постановщика из контракта и с сессией
 * исполнителя из отчёта и выводят уровень независимости. Уровень ниже
 * требуемого — отказ.
 *
 * 2.6.0: DSH не обязателен. Источник — настраиваемая цепочка actor.sources, где
 * каждая запись — { env, kind }. Первый непустой побеждает, а ВИД источника
 * (harness | runner | ci | manual) определяет, чем сессия подтверждена:
 * harness/runner → attestedBy: env (уровень separate-session), ci/manual →
 * declared (уровень не выше declared). Пустое окружение — none/declared:
 * выдумывать сессию запрещено.
 */
import os from 'node:os';
import { pathToFileURL } from 'node:url';
import { ACTOR_SOURCE_KINDS, findRepoRoot, loadConfig } from './lib/common.mjs';

export const LEVEL_RANK = {
  'same-session': 0,
  declared: 1,
  'separate-session': 2,
  human: 3,
};

/* Чем подтверждён идентификатор: окружение или заявление участника. */
const ATTESTED_BY = {
  harness: 'env',
  runner: 'env',
  ci: 'declared',
  manual: 'declared',
};

export function requiredLevel(risk) {
  if (risk === 'low') return 'declared';
  if (risk === 'medium') return 'separate-session';
  if (risk === 'high') return 'human';
  return 'human';
}

/**
 * Цепочка источников. Без opts.sources поведение прежнее (legacy-конфиг):
 * primaryEnv — harness, fallbackEnv — manual. Пустой массив — это именно
 * «источников нет», а не «не передали»: иначе невалидный конфиг молча вернул бы
 * legacy-имена.
 */
function sourceChain({ sources = null, primaryEnv = 'DSH_SESSION_ID', fallbackEnv = 'TASK_ACTOR_SESSION' } = {}) {
  if (Array.isArray(sources)) {
    return sources
      .filter((entry) => entry && typeof entry === 'object'
        && typeof entry.env === 'string' && entry.env.trim() !== ''
        && ACTOR_SOURCE_KINDS.includes(entry.kind))
      .map((entry) => ({ env: entry.env.trim(), kind: entry.kind }));
  }
  return [{ env: primaryEnv, kind: 'harness' }, { env: fallbackEnv, kind: 'manual' }];
}

/** Модель: первый непустой из modelSources, иначе переданный model, иначе unknown. */
function resolveModel(env, modelSources, model) {
  for (const name of Array.isArray(modelSources) ? modelSources : []) {
    if (typeof name !== 'string') continue;
    const value = env[name];
    if (value !== undefined && value !== null && String(value).trim() !== '') return String(value).trim();
  }
  const fallback = typeof model === 'string' ? model.trim() : '';
  return fallback || 'unknown';
}

/**
 * Определяет актора по окружению и цепочке источников.
 *
 * opts.sources — [{ env, kind }] из config.actor.sources;
 * opts.modelSources — ['DSH_MODEL', 'WF_ACTOR_MODEL'];
 * без них — прежние primaryEnv/fallbackEnv (обратная совместимость вызывающих).
 */
export function detectActor(env = process.env, opts = {}) {
  const {
    kind = 'agent',
    model = '',
    host = os.hostname(),
    primaryEnv = 'DSH_SESSION_ID',
    fallbackEnv = 'TASK_ACTOR_SESSION',
    sources = null,
    modelSources = null,
  } = opts || {};
  const actorModel = resolveModel(env, modelSources, model);
  if (kind === 'human') {
    return { kind: 'human', session: null, model: actorModel, host, attestedBy: 'key', source: null, sourceKind: null };
  }
  for (const source of sourceChain({ sources, primaryEnv, fallbackEnv })) {
    const value = env[source.env];
    if (value === undefined || value === null || String(value).trim() === '') continue;
    return {
      kind: 'agent',
      session: String(value),
      model: actorModel,
      host,
      attestedBy: ATTESTED_BY[source.kind],
      source: source.env,
      sourceKind: source.kind,
    };
  }
  return { kind: 'agent', session: null, model: actorModel, host, attestedBy: 'none', source: null, sourceKind: null };
}

/**
 * Считает уровень независимости и проверяет минимум по риску.
 * issuedBy — блок из контракта: { kind, session }.
 * basis — вид источника, на котором держится уровень: его пишут в запись, чтобы
 * «separate-session» нельзя было выдать за DSH-сессию или наоборот.
 */
export function assessIndependence({ actor, issuedBy = null, executorSession = null, risk = 'medium' }) {
  const errors = [];
  let level;

  if (actor.kind === 'human') {
    level = 'human';
  } else if (!actor.session) {
    level = 'declared';
    errors.push('окружение не дало идентификатор сессии: актор declared, для risk=' + risk + ' этого недостаточно');
  } else if (issuedBy && issuedBy.session && actor.session === issuedBy.session) {
    level = 'same-session';
    errors.push('сессия приёмщика совпадает с сессией постановщика (issuedBy): самоприёмка запрещена');
  } else if (executorSession && actor.session === executorSession) {
    level = 'same-session';
    errors.push('сессия приёмщика совпадает с сессией исполнителя: исполнитель не принимает свою работу');
  } else if (actor.attestedBy === 'env') {
    level = 'separate-session';
  } else {
    level = 'declared';
  }
  const basis = actor.sourceKind || 'none';

  const required = requiredLevel(risk);
  if (LEVEL_RANK[level] < LEVEL_RANK[required]) {
    errors.push('уровень независимости ' + level + ' ниже требуемого ' + required + ' для risk=' + risk);
  }
  return { level, required, ok: errors.length === 0, errors, basis };
}

/**
 * Конфиг для CLI: корень по findRepoRoot(process.cwd()), затем loadConfig.
 * Битый конфиг — это ошибка, а не повод работать «как раньше»: иначе ворота
 * показали бы другой источник, чем тот, что настроен в проекте.
 */
function cliConfig() {
  const root = findRepoRoot(process.cwd());
  if (!root) return { config: null, error: null, root: null };
  try {
    return { config: loadConfig(root), error: null, root };
  } catch (err) {
    return { config: null, error: err.message, root };
  }
}

/* CLI для проверки адаптера: какие данные видит ворота в этом харнессе. */
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  const riskIndex = args.indexOf('--risk');
  const risk = riskIndex === -1 ? 'medium' : String(args[riskIndex + 1] || 'medium');
  const loaded = cliConfig();
  const config = loaded.config;
  const sourceErrors = config && Array.isArray(config.actor.errors) ? config.actor.errors : [];
  const actor = detectActor(process.env, config ? config.actor : {});
  const result = assessIndependence({ actor, issuedBy: null, executorSession: null, risk });
  const output = {
    actor,
    risk,
    required: result.required,
    level: result.level,
    basis: result.basis,
    ok: result.ok,
    note: actor.attestedBy === 'env'
      ? 'сессия пришла из окружения: ' + actor.source + ' (' + actor.sourceKind + ')'
      : actor.attestedBy === 'declared'
        ? 'сессия объявлена источником ' + actor.source + ' (' + actor.sourceKind + '): допустимо только для low'
        : 'окружение не дало сессии ни одним источником actor.sources: medium/high невозможны',
    errors: [
      ...(loaded.error ? ['workflow.config.json: ' + loaded.error] : []),
      ...sourceErrors,
      ...result.errors,
    ],
    config: config ? config.file : null,
  };
  if (args.includes('--json') || !process.stdout.isTTY) console.log(JSON.stringify(output, null, 2));
  else {
    console.log('actor:   ' + actor.kind + ' / ' + (actor.session || '—') + ' [' + actor.attestedBy + ']');
    console.log('source:  ' + (actor.source || '—') + ' (' + (actor.sourceKind || 'none') + '), основание ' + result.basis);
    console.log('risk:    ' + risk + ' → нужно ' + result.required + ', есть ' + result.level);
    console.log('verdict: ' + (result.ok ? 'ok' : 'НЕДОСТАТОЧНО'));
    for (const error of output.errors) console.log('  - ' + error);
  }
  process.exit(result.ok && actor.attestedBy === 'env' && sourceErrors.length === 0 && !loaded.error ? 0 : 1);
}
