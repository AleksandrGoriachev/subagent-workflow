/*
 * Политика ворот (2.2.0): что обязательно, что только предупреждает, что не
 * проверяется. Настройка живёт в workflow.config.json, поэтому строгость
 * выбирает репозиторий, а не версия пакета. Целостность записи (самоприёмка,
 * подпись, хеши контракта) под политику не попадает — иначе ворота бессмысленны.
 */
export const POLICY_LEVELS = ['off', 'warn', 'fail'];

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
  return models[key] || null;
}

export function modelLevel(config, issuerModel, actorModel) {
  const issuer = familyOf(config, issuerModel);
  const actor = familyOf(config, actorModel);
  if (!issuer || !actor) return 'unknown';
  return issuer === actor ? 'same-family' : 'different-family';
}

/* Превращает список замечаний в ошибки/предупреждения по уровню политики. */
export function applyLevel(level, issues) {
  const list = (issues || []).filter(Boolean);
  if (level === 'fail') return { errors: [...list], warnings: [] };
  if (level === 'warn') return { errors: [], warnings: [...list] };
  return { errors: [], warnings: [] };
}
