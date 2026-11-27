/*
 * Записи приёмки: verify, red, review, acceptance — чистые представления.
 *
 * 0179: часть state.js; публичный вход — plugin/lib/state.js (баррель).
 */
import { isManual } from './contract.js';
import { modelLevel } from './policy.js';
/* ------------------------------------------------------------------ *
 * verify / red / acceptance
 * ------------------------------------------------------------------ */

export function coverageView(verify) {
  if (!verify || typeof verify !== 'object') return null;
  const coverage = verify.coverage && typeof verify.coverage === 'object' ? verify.coverage : null;
  if (!coverage) return null;
  return {
    declared: Number(coverage.declared) || 0,
    covered: Array.isArray(coverage.covered) ? coverage.covered : [],
    uncovered: Array.isArray(coverage.uncovered) ? coverage.uncovered.map(String) : [],
    mode: coverage.mode || null,
    warnings: Array.isArray(coverage.warnings) ? coverage.warnings.map(String) : [],
  };
}

/**
 * Доказательство и эффект (I-34, 2.4.0): цепь «критерий-носитель → измеритель»,
 * какие решения обязаны на неё ссылаться и что записали ворота. Чистая функция:
 * тесты кормят её объектами, без файловой системы.
 *
 * Статусы: none — эффект не заявлен и не требуется; ok — цепь собрана и
 * согласована; missing — решение требует эффекта, а критериев с effect нет;
 * invalid — effect объявлен неверно (нет observable/threshold/measuredBy,
 * измеритель = сам критерий); unlinked — решение ссылается мимо цепи;
 * mismatch — ворота записали несогласованность (verify/record ok=false).
 */
export function effectsView(meta, criteriaList, { verify = null, record = null } = {}) {
  const list = Array.isArray(criteriaList) ? criteriaList : [];
  const byId = new Map(list.map((criterion) => [String(criterion.id), criterion]));
  const issues = [];
  const declared = [];
  for (const criterion of list) {
    if (!criterion || criterion.effect === undefined) continue;
    const effect = criterion.effect;
    const label = 'критерий ' + criterion.id + ': effect';
    if (!effect || typeof effect !== 'object' || Array.isArray(effect)) {
      issues.push(label + ' должен быть объектом { observable, threshold, measuredBy }');
      continue;
    }
    const observable = typeof effect.observable === 'string' ? effect.observable.trim() : '';
    const threshold = typeof effect.threshold === 'string' ? effect.threshold.trim() : '';
    const measuredBy = typeof effect.measuredBy === 'string' ? effect.measuredBy.trim() : '';
    if (!observable) issues.push(label + ': observable обязателен');
    if (!threshold) issues.push(label + ': threshold обязателен');
    if (!measuredBy) issues.push(label + ': measuredBy обязателен');
    else if (measuredBy === String(criterion.id)) issues.push(label + ': measuredBy не может указывать на сам критерий');
    else if (!byId.has(measuredBy)) issues.push(label + ': measuredBy ссылается на неизвестный критерий ' + measuredBy);
    else if (isManual(byId.get(measuredBy))) issues.push(label + ': measuredBy указывает на manual-критерий ' + measuredBy);
    declared.push({
      criterion: String(criterion.id),
      observable: observable || null,
      threshold: threshold || null,
      measuredBy: measuredBy || null,
      measuredKnown: measuredBy !== '' && byId.has(measuredBy),
    });
  }

  /*
   * 0.4.1: «эффект требуется» — ровно правило ворот (userFacingDecisions,
   * spec/scripts/lib/common.mjs): любое решение с impact user-visible или
   * public-contract, без оглядки на class и evidence. Раньше панель требовала
   * ещё class semantic|contract и evidence.kind=criterion — и могла сказать
   * «эффект не требуется», когда ворота дают ошибку. Список applicable ниже
   * остаётся узким: он про цепь доказательства (isEffectLinkApplicable).
   */
  const userFacing = (meta && Array.isArray(meta.decisions) ? meta.decisions : []).filter(
    (decision) => decision && (decision.impact === 'user-visible' || decision.impact === 'public-contract'),
  );

  const applicable = (meta && Array.isArray(meta.decisions) ? meta.decisions : []).filter((decision) => {
    if (!decision || typeof decision !== 'object' || Array.isArray(decision)) return false;
    if (decision.class !== 'semantic' && decision.class !== 'contract') return false;
    if (decision.impact !== 'user-visible' && decision.impact !== 'public-contract') return false;
    const evidence = decision.evidence;
    if (!evidence || evidence.kind !== 'criterion' || typeof evidence.ref !== 'string') return false;
    const criterion = byId.get(evidence.ref.trim());
    return Boolean(criterion) && !isManual(criterion);
  });
  const links = [];
  const unlinked = [];
  for (const decision of applicable) {
    const ref = String(decision.evidence.ref).trim();
    const matched = declared.filter((chain) => chain.measuredBy === ref || (chain.criterion === ref && chain.measuredBy));
    if (matched.length === 0) {
      unlinked.push({ decision: String(decision.id), ref });
      continue;
    }
    for (const chain of matched) {
      links.push({ decision: String(decision.id), ref, criterion: chain.criterion, measuredBy: chain.measuredBy });
    }
  }

  const required = userFacing.length > 0;
  const verifyEffects = verify && verify.effects && typeof verify.effects === 'object'
    ? {
        required: verify.effects.required === true,
        checked: verify.effects.checked === true,
        ok: verify.effects.ok !== false,
        mode: verify.effects.mode || null,
      }
    : null;
  const recordEffects = record && record.effectConsistency && typeof record.effectConsistency === 'object'
    ? {
        checked: record.effectConsistency.checked === true,
        ok: record.effectConsistency.ok !== false,
        mode: record.effectConsistency.mode || null,
      }
    : null;

  const mismatch = Boolean((verifyEffects && verifyEffects.ok === false) || (recordEffects && recordEffects.ok === false));
  const status = mismatch
    ? 'mismatch'
    : issues.length > 0
      ? 'invalid'
      : required && declared.length === 0
        ? 'missing'
        : unlinked.length > 0
          ? 'unlinked'
          : declared.length === 0
            ? 'none'
            : 'ok';

  return { required, declared, links, unlinked, issues, verify: verifyEffects, record: recordEffects, status };
}

export function verifyView(verify) {
  if (!verify || typeof verify !== 'object') return null;
  return {
    present: true,
    version: verify.version === undefined ? null : verify.version,
    createdAt: verify.createdAt || null,
    headSha: verify.headSha || null,
    allPassed: verify.allPassed === true,
    executed: Number(verify.executed) || 0,
    failed: Number(verify.failed) || 0,
    manualSkipped: Number(verify.manualSkipped) || 0,
    violations: Array.isArray(verify.violations) ? verify.violations.map(String) : [],
    changedPaths: Array.isArray(verify.changedPaths) ? verify.changedPaths.map(String) : [],
    worktreeDigest: verify.worktreeDigest || null,
    red: verify.red || null,
    coverage: coverageView(verify),
    /* 0.4.0: что ворота записали про эффект на зелёном прогоне. */
    effects: verify.effects && typeof verify.effects === 'object'
      ? {
          required: verify.effects.required === true,
          checked: verify.effects.checked === true,
          mode: verify.effects.mode || null,
          ok: verify.effects.ok !== false,
          declared: Array.isArray(verify.effects.declared) ? verify.effects.declared.length : 0,
          links: Array.isArray(verify.effects.links) ? verify.effects.links.length : 0,
        }
      : null,
    bypasses: verify.bypasses && typeof verify.bypasses === 'object' ? verify.bypasses : {},
  };
}

export function redView(red) {
  if (!red || typeof red !== 'object') return null;
  return {
    present: true,
    version: red.version === undefined ? null : red.version,
    createdAt: red.createdAt || null,
    redProven: red.redProven === true,
    allGreen: red.allGreen === true,
    executed: Number(red.executed) || 0,
    failed: Number(red.failed) || 0,
    failedIds: Array.isArray(red.failedIds) ? red.failedIds.map(String) : [],
    redExpectation: red.redExpectation && typeof red.redExpectation === 'object'
      ? {
          configured: red.redExpectation.configured === true,
          ok: red.redExpectation.ok === true,
          errors: Array.isArray(red.redExpectation.errors) ? red.redExpectation.errors.map(String) : [],
          mustFail: Array.isArray(red.redExpectation.mustFail) ? red.redExpectation.mustFail.map(String) : [],
          mustPass: Array.isArray(red.redExpectation.mustPass) ? red.redExpectation.mustPass.map(String) : [],
        }
      : null,
    bypasses: red.bypasses && typeof red.bypasses === 'object' ? red.bypasses : {},
  };
}

export function reviewView(review) {
  if (!review || typeof review !== 'object' || Array.isArray(review)) return null;
  const remarks = Array.isArray(review.remarks) ? review.remarks : [];
  const unresolved = remarks.filter(
    (remark) => remark && remark.class === 'blocking'
      && !(typeof remark.resolution === 'string' && remark.resolution.trim() !== ''),
  ).map((remark) => (remark.id === undefined ? '?' : String(remark.id)));
  return {
    present: true,
    decision: review.decision || null,
    remarks: remarks.map((remark, index) => ({
      id: remark && remark.id !== undefined ? String(remark.id) : '#' + (index + 1),
      class: remark && remark.class ? remark.class : null,
      what: remark && (remark.what || remark.text || remark.claim) ? (remark.what || remark.text || remark.claim) : null,
      resolution: remark && typeof remark.resolution === 'string' ? remark.resolution : null,
      reason: remark && typeof remark.reason === 'string' ? remark.reason : null,
      followUpId: remark && remark.followUpId ? String(remark.followUpId) : null,
      unresolved: unresolved.includes(remark && remark.id !== undefined ? String(remark.id) : '?'),
    })),
    releaseReady: review.decision === 'accepted' && unresolved.length === 0,
    unresolved,
    ok: review.decision === 'accepted' && unresolved.length === 0,
  };
}

export function recordView(record) {
  if (!record || typeof record !== 'object' || Array.isArray(record)) return null;
  const version = Number(record.version) || 0;
  const decisions = record.decisions && typeof record.decisions === 'object'
    ? {
        count: Number(record.decisions.count) || 0,
        digest: record.decisions.digest || null,
        assumed: Array.isArray(record.decisions.assumed) ? record.decisions.assumed.map(String) : [],
        confirmed: Number(record.decisions.confirmed) || 0,
      }
    : null;
  const attack = record.attack && typeof record.attack === 'object'
    ? {
        present: record.attack.present === true,
        sha256: record.attack.sha256 || null,
        session: record.attack.session || null,
        model: record.attack.model || null,
        family: record.attack.family || null,
        level: record.attack.level || null,
        attestation: record.attack.attestation || null,
        findings: record.attack.findings && typeof record.attack.findings === 'object'
          ? {
              total: Number(record.attack.findings.total) || 0,
              blocking: Number(record.attack.findings.blocking) || 0,
              unresolved: Number(record.attack.findings.unresolved) || 0,
            }
          : null,
      }
    : null;
  const actor = record.actor && typeof record.actor === 'object'
    ? {
        kind: record.actor.kind || null,
        session: record.actor.session || null,
        model: record.actor.model || null,
        family: record.actor.family || null,
        attestedBy: record.actor.attestedBy || null,
        keyId: record.actor.keyId || null,
      }
    : null;
  const independence = record.independence && typeof record.independence === 'object'
    ? {
        level: record.independence.level || null,
        separateSession: record.independence.separateSession === true,
        reportWithheld: record.independence.reportWithheld === true,
        keyCustody: record.independence.keyCustody || null,
        modelLevel: record.independence.modelLevel || null,
      }
    : null;
  return {
    present: true,
    version,
    legacy: version < 4,
    status: record.status || null,
    task: record.task === undefined ? null : String(record.task),
    title: record.title || null,
    risk: record.risk || null,
    keyId: record.keyId || null,
    acceptor: record.acceptor || null,
    acceptedAt: record.acceptedAt || null,
    candidateCommit: record.candidateCommit || null,
    baseCommit: record.baseCommit || null,
    contractCommit: record.contractCommit || null,
    tree: record.tree || null,
    taskFileSha256: record.taskFileSha256 || null,
    criteriaSha256: record.criteriaSha256 || null,
    criteriaJsonSha256: record.criteriaJsonSha256 || null,
    releaseReady: record.releaseReady === true ? true : record.releaseReady === false ? false : null,
    humanSignoff: record.humanSignoff === true,
    signedBy: record.signedBy || null,
    securityReview: record.securityReview === true,
    signatureAlgorithm: record.signatureAlgorithm || null,
    signed: (record.signatureAlgorithm === 'ed25519' || record.signatureAlgorithm === 'hmac-sha256')
      && typeof record.signature === 'string' && record.signature.length > 0,
    decisions,
    attack,
    actor,
    independence,
    /*
     * 0.4.0 (WC-5): эффект решения. Ворота 2.3+ пишут его в запись, панель
     * раньше просто не читала — и «Совместимость» честно называла этот пробел.
     */
    effectsRequired: record.effectsRequired === true,
    effects: Array.isArray(record.effects)
      ? record.effects.map((effect) => (effect && typeof effect === 'object'
        ? {
            criterion: effect.criterion === undefined ? null : String(effect.criterion),
            observable: effect.observable || null,
            threshold: effect.threshold || null,
            measuredBy: effect.measuredBy || null,
          }
        : null)).filter(Boolean)
      : [],
    effectConsistency: record.effectConsistency && typeof record.effectConsistency === 'object'
      ? {
          checked: record.effectConsistency.checked === true,
          ok: record.effectConsistency.ok !== false,
          mode: record.effectConsistency.mode || null,
          links: Array.isArray(record.effectConsistency.links)
            ? record.effectConsistency.links.map((link) => (link && typeof link === 'object'
              ? {
                  decision: link.decision === undefined ? null : String(link.decision),
                  criterion: link.criterion || null,
                  carrier: link.carrier || null,
                  measuredBy: link.measuredBy || null,
                }
              : null)).filter(Boolean)
            : [],
        }
      : null,
    review: record.review === undefined ? null : reviewView(record.review),
    acceptorRun: record.acceptorRun && typeof record.acceptorRun === 'object'
      ? {
          fresh: record.acceptorRun.fresh === true,
          runKind: record.acceptorRun.runKind || null,
          nonce: record.acceptorRun.nonce || null,
          startedAt: record.acceptorRun.startedAt || null,
          finishedAt: record.acceptorRun.finishedAt || null,
          durationMs: Number(record.acceptorRun.durationMs) || null,
        }
      : null,
    checks: Array.isArray(record.checks) ? record.checks.length : 0,
    notes: record.notes || '',
  };
}

