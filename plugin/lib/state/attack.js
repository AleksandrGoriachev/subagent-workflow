/*
 * Атака спецификации: сводка для карточки.
 *
 * 0179: часть state.js; публичный вход — plugin/lib/state.js (баррель).
 */
import { modelLevel } from './policy.js';
/* ------------------------------------------------------------------ *
 * attack
 * ------------------------------------------------------------------ */

export function attackView(attack, { meta, models } = {}) {
  if (!attack || typeof attack !== 'object' || Array.isArray(attack)) return null;
  const findings = Array.isArray(attack.findings) ? attack.findings : [];
  const unresolved = [];
  const issues = [];
  let blocking = 0;
  if (attack.version !== 1) issues.push('версия ' + attack.version + ', нужна 1');
  if (meta && meta.id !== undefined && String(attack.task) !== String(meta.id)) {
    issues.push('task ' + attack.task + ' не совпадает с заданием ' + meta.id);
  }
  const critic = attack.critic && typeof attack.critic === 'object' ? attack.critic : {};
  if (typeof critic.session !== 'string' || critic.session.trim() === '') issues.push('critic.session пуст');
  if (typeof critic.model !== 'string' || critic.model.trim() === '') issues.push('critic.model пуст');
  for (const [index, finding] of findings.entries()) {
    if (!finding || typeof finding !== 'object') {
      issues.push('находка #' + (index + 1) + ' не объект');
      continue;
    }
    if (finding.severity === 'blocking') {
      blocking += 1;
      if (typeof finding.resolution !== 'string' || finding.resolution.trim() === '') {
        unresolved.push(String(finding.id === undefined ? index : finding.id));
      }
    }
  }
  const sameSession = Boolean(
    meta && meta.issuedBy && meta.issuedBy.session && critic.session && meta.issuedBy.session === critic.session,
  );
  const level = meta && meta.issuedBy && meta.issuedBy.model && critic.model
    ? modelLevel({ models: models || {} }, meta.issuedBy.model, critic.model)
    : 'unknown';
  const family = critic.model ? ((models || {})[critic.model] || null) : null;
  return {
    present: true,
    version: attack.version === undefined ? null : attack.version,
    task: attack.task === undefined ? null : String(attack.task),
    createdAt: attack.createdAt || null,
    critic: {
      session: critic.session || null,
      model: critic.model || null,
      attestedBy: critic.attestedBy || null,
    },
    findings: findings.map((finding, index) => ({
      id: finding && finding.id !== undefined ? String(finding.id) : '#' + (index + 1),
      class: finding && finding.class ? finding.class : null,
      severity: finding && finding.severity ? finding.severity : null,
      claim: finding && typeof finding.claim === 'string' ? finding.claim : null,
      case: finding && typeof finding.case === 'string' ? finding.case : null,
      resolution: finding && typeof finding.resolution === 'string' && finding.resolution.trim() !== '' ? finding.resolution : null,
      reason: finding && typeof finding.reason === 'string' ? finding.reason : null,
      followUpId: finding && finding.followUpId ? String(finding.followUpId) : null,
    })),
    summary: { total: findings.length, blocking, unresolved: unresolved.length },
    unresolvedIds: unresolved,
    sameSession,
    level,
    family,
    issues,
  };
}

