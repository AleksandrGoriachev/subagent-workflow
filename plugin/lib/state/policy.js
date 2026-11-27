/*
 * Политика и семейства моделей: уровень проверки и его применение.
 *
 * 0179: часть state.js; публичный вход — plugin/lib/state.js (баррель).
 */
import { POLICY_LEVELS } from './constants.js';
/* ------------------------------------------------------------------ *
 * policy and model families
 * ------------------------------------------------------------------ */

export function policyOf(config) {
  const raw = (config && config.policy) || {};
  const pick = (value, fallback) => (POLICY_LEVELS.includes(value) ? value : fallback);
  return {
    decisions: pick(raw.decisions, 'fail'),
    coverage: pick(raw.coverage, 'fail'),
    attack: pick(raw.attack, 'off'),
    roles: { modelFamily: pick((raw.roles || {}).modelFamily, 'warn') },
  };
}

export function familyOf(config, model) {
  const key = String(model || '').trim();
  if (!key) return null;
  const models = (config && config.models) || {};
  const family = models[key];
  return typeof family === 'string' && family.length > 0 ? family : null;
}

export function modelLevel(config, issuerModel, actorModel) {
  const issuer = familyOf(config, issuerModel);
  const actor = familyOf(config, actorModel);
  if (!issuer || !actor) return 'unknown';
  return issuer === actor ? 'same-family' : 'different-family';
}

export function applyLevel(level, issues) {
  const list = (issues || []).filter(Boolean);
  if (level === 'fail') return { errors: [...list], warnings: [] };
  if (level === 'warn') return { errors: [], warnings: [...list] };
  return { errors: [], warnings: [] };
}

