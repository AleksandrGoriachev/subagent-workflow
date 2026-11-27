/*
 * Виды: доска, счётчики стадий, страница политики.
 *
 * 0179: часть state.js; публичный вход — plugin/lib/state.js (баррель).
 */
import { policyOf, familyOf } from './policy.js';
/* ------------------------------------------------------------------ *
 * policy view
 * ------------------------------------------------------------------ */

export function policyView(config, { root = null, configPath = null } = {}) {
  const policy = policyOf(config);
  const models = (config && config.models) || {};
  const warnings = [];
  const roles = [];
  for (const [name, spec] of Object.entries((config && config.roles) || {})) {
    if (!spec || typeof spec !== 'object' || Array.isArray(spec)) {
      warnings.push('роль ' + name + ': ожидается объект');
      roles.push({ name, model: null, family: null, mustDifferFromIssuer: null, ok: false });
      continue;
    }
    const model = typeof spec.model === 'string' ? spec.model.trim() : '';
    if (!model) {
      warnings.push('роль ' + name + ': нет model');
      roles.push({ name, model: null, family: null, mustDifferFromIssuer: spec.mustDifferFromIssuer || null, ok: false });
      continue;
    }
    const family = familyOf(config, model);
    if (!family) warnings.push('роль ' + name + ': модель ' + model + ' без семейства в models');
    roles.push({
      name,
      model,
      family,
      mustDifferFromIssuer: spec.mustDifferFromIssuer || null,
      ok: true,
    });
  }
  for (const [model, family] of Object.entries(models)) {
    if (typeof family !== 'string' || family.trim() === '') warnings.push('models.' + model + ': семейство не строка');
  }
  return {
    root,
    configPath,
    loaded: Boolean(config && config.loaded),
    policy,
    models,
    roles,
    warnings,
    line: 'decisions=' + policy.decisions + ', coverage=' + policy.coverage
      + ', attack=' + policy.attack + ', modelFamily=' + policy.roles.modelFamily,
  };
}

