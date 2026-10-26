/*
 * Атака спецификации (2.2.0): критик ищет в задании то, чего в нём нет —
 * пропущенные случаи, неоднозначные критерии, необъявленные режимы отказа.
 * Находки классифицируются; blocking без решения запрещает замок контракта
 * (при policy.attack = fail).
 */

export const ATTACK_CLASSES = [
  'missing-case',
  'ambiguous-criterion',
  'contradicts-invariant',
  'undefined-failure-mode',
  'unverifiable-claim',
  'scope-creep',
];

export const FINDING_SEVERITIES = ['blocking', 'non-blocking', 'follow-up'];

import { modelLevel } from './policy.mjs';

export function validateAttack(attack, { task, risk } = {}) {
  const errors = [];
  const warnings = [];
  const unresolved = [];
  if (!attack || typeof attack !== 'object' || Array.isArray(attack)) {
    return { ok: false, errors: ['attack.json должен быть объектом'], warnings, unresolved, summary: { total: 0, blocking: 0, unresolved: 0 } };
  }
  if (attack.version !== 1) errors.push('attack.json: версия ' + attack.version + ', нужна 1');
  if (task !== undefined && String(attack.task) !== String(task)) errors.push('attack.json: task ' + attack.task + ' не совпадает с заданием ' + task);

  const critic = attack.critic || {};
  if (risk !== 'low' && (typeof critic.session !== 'string' || critic.session.trim() === '')) {
    errors.push('attack.critic.session пуст: критик должен назвать свою сессию');
  }
  if (typeof critic.model !== 'string' || critic.model.trim() === '') errors.push('attack.critic.model обязателен');
  if (critic.attestedBy !== undefined && !['env', 'declared', 'key'].includes(critic.attestedBy)) {
    errors.push('attack.critic.attestedBy: ожидается env | declared | key');
  }

  if (!Array.isArray(attack.findings)) {
    errors.push('attack.findings должен быть массивом (пустой — если находок нет)');
    return { ok: errors.length === 0, errors, warnings, unresolved, summary: { total: 0, blocking: 0, unresolved: 0 } };
  }
  const seen = new Set();
  let blocking = 0;
  for (const [index, finding] of attack.findings.entries()) {
    const label = 'находка ' + ((finding && finding.id) || '#' + (index + 1));
    if (!finding || typeof finding !== 'object' || Array.isArray(finding)) { errors.push(label + ': должна быть объектом'); continue; }
    if (typeof finding.id !== 'string' || finding.id.trim() === '') errors.push(label + ': нет id');
    else if (seen.has(finding.id)) errors.push(label + ': повторяется id');
    else seen.add(finding.id);
    if (!ATTACK_CLASSES.includes(finding.class)) errors.push(label + ': class должен быть ' + ATTACK_CLASSES.join(' | '));
    if (!FINDING_SEVERITIES.includes(finding.severity)) errors.push(label + ': severity должна быть ' + FINDING_SEVERITIES.join(' | '));
    if (typeof finding.claim !== 'string' || finding.claim.trim() === '') errors.push(label + ': нет claim (что именно не так)');
    if (typeof finding.case !== 'string' || finding.case.trim() === '') errors.push(label + ': нет case (контрпример или точный вопрос)');
    if (finding.severity === 'blocking') {
      blocking += 1;
      if (typeof finding.resolution !== 'string' || finding.resolution.trim() === '') unresolved.push(String(finding.id || index));
    }
    if (finding.severity === 'non-blocking' && (typeof finding.reason !== 'string' || finding.reason.trim() === '')) {
      errors.push(label + ': non-blocking требует reason');
    }
    if (finding.severity === 'follow-up' && (typeof finding.followUpId !== 'string' || finding.followUpId.trim() === '')) {
      errors.push(label + ': follow-up требует followUpId');
    }
  }
  return {
    ok: errors.length === 0,
    errors,
    warnings,
    unresolved,
    summary: { total: attack.findings.length, blocking, unresolved: unresolved.length },
  };
}

/*
 * Полная оценка атаки против задания и конфигурации: структурные ошибки,
 * неразрешённые blocking-находки, независимость критика (сессия, семейство).
 * Политика (fail/warn/off) применяется вызывающим: этот слой только собирает
 * факты, чтобы ворота не расходились в трактовке.
 */
export function evaluateAttack(attack, { meta, config }) {
  const check = validateAttack(attack, { task: meta.id, risk: meta.risk });
  const issues = [...check.errors];
  if (check.unresolved.length) issues.push('blocking-находки без resolution: ' + check.unresolved.join(', '));
  const issuedBy = (meta && meta.issuedBy) || {};
  const critic = (attack && attack.critic) || {};
  if (issuedBy.session && critic.session && issuedBy.session === critic.session) {
    issues.push('критик из сессии постановщика: атака не независима');
  }
  const level = issuedBy.model && critic.model ? modelLevel(config, issuedBy.model, critic.model) : 'unknown';
  const family = critic.model ? ((config && config.models) || {})[critic.model] || null : null;
  const familyIssues = level === 'same-family'
    ? ['критик той же модели/семейства, что постановщик (' + critic.model + ')']
    : [];
  return { ...check, issues, familyIssues, level, family, critic };
}
