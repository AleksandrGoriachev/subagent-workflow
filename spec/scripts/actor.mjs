#!/usr/bin/env node
/*
 * Аттестация актора и уровень независимости.
 *
 * Идея: ворота не верят строке --acceptor. Они берут идентификатор сессии из
 * окружения (его выставляет харнесс, а не аргументы команды), сравнивают его с
 * сессией постановщика из контракта и с сессией исполнителя из отчёта и выводят
 * уровень независимости. Уровень ниже требуемого — отказ.
 *
 * Если окружение не даёт идентификатор, это не повод выдумывать его: актор
 * помечается как declared, и такой уровень допустим только для low.
 */
import os from 'node:os';
import { pathToFileURL } from 'node:url';

export const LEVEL_RANK = {
  'same-session': 0,
  declared: 1,
  'separate-session': 2,
  human: 3,
};

export function requiredLevel(risk) {
  if (risk === 'low') return 'declared';
  if (risk === 'medium') return 'separate-session';
  if (risk === 'high') return 'human';
  return 'human';
}

/**
 * Определяет актора по окружению.
 * DSH_SESSION_ID — идентификатор сессии агента в DSH (у каждого агента свой).
 * TASK_ACTOR_SESSION — запасной вариант для других раннеров (уровень declared).
 */
export function detectActor(env = process.env, { kind = 'agent', model = '', host = os.hostname(), primaryEnv = 'DSH_SESSION_ID', fallbackEnv = 'TASK_ACTOR_SESSION' } = {}) {
  if (kind === 'human') {
    return { kind: 'human', session: null, model, host, attestedBy: 'key' };
  }
  if (env[primaryEnv]) {
    return { kind: 'agent', session: String(env[primaryEnv]), model, host, attestedBy: 'env' };
  }
  if (env[fallbackEnv]) {
    return { kind: 'agent', session: String(env[fallbackEnv]), model, host, attestedBy: 'declared' };
  }
  return { kind: 'agent', session: null, model, host, attestedBy: 'none' };
}

/**
 * Считает уровень независимости и проверяет минимум по риску.
 * issuedBy — блок из контракта: { kind, session }.
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

  const required = requiredLevel(risk);
  if (LEVEL_RANK[level] < LEVEL_RANK[required]) {
    errors.push('уровень независимости ' + level + ' ниже требуемого ' + required + ' для risk=' + risk);
  }
  return { level, required, ok: errors.length === 0, errors };
}


/* CLI для проверки адаптера: какие данные видит ворота в этом харнессе. */
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  const riskIndex = args.indexOf('--risk');
  const risk = riskIndex === -1 ? 'medium' : String(args[riskIndex + 1] || 'medium');
  const actor = detectActor(process.env);
  const result = assessIndependence({ actor, issuedBy: null, executorSession: null, risk });
  const output = {
    actor,
    risk,
    required: result.required,
    level: result.level,
    ok: result.ok,
    note: actor.attestedBy === 'env'
      ? 'сессия пришла из окружения'
      : actor.attestedBy === 'declared'
        ? 'сессия объявлена вручную: допустимо только для low'
        : 'окружение не дало сессии: medium/high невозможны',
    errors: result.errors,
  };
  if (args.includes('--json') || !process.stdout.isTTY) console.log(JSON.stringify(output, null, 2));
  else {
    console.log('actor:   ' + actor.kind + ' / ' + (actor.session || '—') + ' [' + actor.attestedBy + ']');
    console.log('risk:    ' + risk + ' → нужно ' + result.required + ', есть ' + result.level);
    console.log('verdict: ' + (result.ok ? 'ok' : 'НЕДОСТАТОЧНО'));
    for (const error of result.errors) console.log('  - ' + error);
  }
  process.exit(result.ok && actor.attestedBy === 'env' ? 0 : 1);
}
