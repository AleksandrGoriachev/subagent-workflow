/*
 * Решения задания: digest, сводка, элементы.
 *
 * 0179: часть state.js; публичный вход — plugin/lib/state.js (баррель).
 */
import { DECISION_EVIDENCE_KINDS } from './constants.js';
import { canonicalize, sha256Text } from './primitives.js';
import { isManual } from './contract.js';
/* ------------------------------------------------------------------ *
 * decisions
 * ------------------------------------------------------------------ */

export function decisionEvidenceKind(decision, criteriaList) {
  const evidence = decision && decision.evidence;
  if (evidence && typeof evidence === 'object' && DECISION_EVIDENCE_KINDS.includes(evidence.kind)) {
    if (evidence.kind === 'criterion') {
      const criterion = (criteriaList || []).find((item) => String(item.id) === String(evidence.ref));
      if (criterion) return isManual(criterion) ? 'human' : 'executable';
    } else {
      return 'human';
    }
  }
  const confirmation = decision && decision.confirmation;
  if (confirmation && typeof confirmation === 'object' && (confirmation.kind === 'customer' || confirmation.kind === 'human')) {
    const who = typeof confirmation.who === 'string' ? confirmation.who.trim() : '';
    if (who !== '') return 'human';
  }
  return 'none';
}

export function decisionsDigest(decisions) {
  const list = Array.isArray(decisions) ? decisions : [];
  return sha256Text(canonicalize(JSON.stringify(list)));
}

export function summarizeDecisions(decisions, criteriaList) {
  const list = Array.isArray(decisions) ? decisions : [];
  const assumed = [];
  const unproven = [];
  for (const decision of list) {
    if (!decision || typeof decision !== 'object') continue;
    const kind = decisionEvidenceKind(decision, criteriaList);
    const meaningful = decision.class === 'semantic' || decision.class === 'contract';
    if (!meaningful) continue;
    const status = decision.status === 'confirmed' || decision.status === 'assumed'
      ? decision.status
      : (kind === 'none' ? 'assumed' : 'confirmed');
    if (status === 'assumed') assumed.push(String(decision.id));
    const touchesUser = decision.impact === 'user-visible' || decision.impact === 'public-contract';
    if (kind === 'none' && touchesUser) unproven.push(String(decision.id));
  }
  return {
    count: list.length,
    digest: decisionsDigest(list),
    assumed,
    confirmed: list.length - assumed.length,
    unproven,
  };
}

export function decisionItems(decisions, criteriaList) {
  const list = Array.isArray(decisions) ? decisions : [];
  return list.map((decision, index) => {
    if (!decision || typeof decision !== 'object') {
      return { id: '#' + (index + 1), malformed: true };
    }
    const evidenceKind = decisionEvidenceKind(decision, criteriaList);
    const meaningful = decision.class === 'semantic' || decision.class === 'contract';
    const status = decision.status === 'confirmed' || decision.status === 'assumed'
      ? decision.status
      : (evidenceKind === 'none' ? 'assumed' : 'confirmed');
    const evidence = decision.evidence && typeof decision.evidence === 'object'
      ? { kind: decision.evidence.kind || null, ref: decision.evidence.ref === undefined ? null : String(decision.evidence.ref) }
      : null;
    const confirmation = decision.confirmation && typeof decision.confirmation === 'object'
      ? { kind: decision.confirmation.kind || null, who: decision.confirmation.who === undefined ? null : String(decision.confirmation.who) }
      : null;
    return {
      id: String(decision.id === undefined ? '#' + (index + 1) : decision.id),
      class: decision.class || null,
      impact: decision.impact || null,
      what: decision.what || decision.title || decision.text || null,
      status,
      assumed: meaningful && status === 'assumed',
      evidenceKind,
      evidence,
      confirmation,
      malformed: false,
    };
  });
}

