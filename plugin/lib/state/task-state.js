/*
 * Состояние задачи: артефакты -> { task, stage, flags }.
 *
 * 0179: часть state.js; публичный вход — plugin/lib/state.js (баррель).
 */
import { STAGE_LABELS, STAGE_ORDER } from './constants.js';
import { exists } from './primitives.js';
import { parseTaskMeta, parseCriteriaRaw, isManual } from './contract.js';
import { policyOf } from './policy.js';
import { summarizeDecisions, decisionItems } from './decisions.js';
import { attackView } from './attack.js';
import { lockView } from './lock.js';
import { coverageView, effectsView, verifyView, redView, reviewView, recordView } from './acceptance.js';
/* ------------------------------------------------------------------ *
 * the state
 * ------------------------------------------------------------------ */

function flag(code, severity, message, detail) {
  return { code, severity, message, ...(detail === undefined ? {} : { detail }) };
}

function severityForPolicy(level, fallback = 'warn') {
  if (level === 'fail') return 'error';
  if (level === 'warn') return 'warn';
  if (level === 'off') return 'info';
  return fallback;
}

/**
 * Build one task state from already-read artifacts.
 *
 * @param {object} input
 * @param {string} input.id
 * @param {string} [input.dir]
 * @param {string|null} [input.taskMd]
 * @param {string|null} [input.criteriaRaw]
 * @param {object|null} [input.lock]
 * @param {object|null} [input.attack]
 * @param {object|null} [input.red]
 * @param {object|null} [input.verify]
 * @param {object|null} [input.acceptance]
 * @param {string|null} [input.attackSha256] raw-file hash for lock comparison
 * @param {Array<{path:string,sha256:string|null}>|null} [input.protectedActual]
 * @param {object|null} [input.config]
 * @param {string|null} [input.head]
 * @param {Array<object>|null} [input.gitLog]
 * @param {Array<{file:string,message:string}>} [input.parseErrors]
 */
export function buildTaskState(input = {}) {
  const {
    id,
    dir = null,
    taskMd = null,
    criteriaRaw = null,
    lock = null,
    attack = null,
    red = null,
    verify = null,
    acceptance = null,
    present = null,
    attackSha256 = null,
    protectedActual = null,
    config = null,
    head = null,
    gitLog = null,
    regress = null,
    parseErrors = [],
  } = input;

  const policy = policyOf(config);
  const models = (config && config.models) || {};
  const flags = [];
  for (const error of parseErrors) {
    flags.push(flag('artifact-unreadable', 'error', error.file + ': ' + error.message));
  }

  const metaResult = parseTaskMeta(taskMd);
  const criteriaResult = parseCriteriaRaw(criteriaRaw);
  const meta = metaResult.ok ? metaResult.meta : null;
  const criteria = criteriaResult.ok ? criteriaResult.criteria : [];

  if (taskMd === null) flags.push(flag('task-missing', 'error', 'нет task.md'));
  else if (!metaResult.ok) flags.push(flag('task-meta-invalid', 'error', metaResult.error));
  if (criteriaRaw === null) flags.push(flag('criteria-missing', 'error', 'нет criteria.json'));
  else if (!criteriaResult.ok) flags.push(flag('criteria-invalid', 'error', criteriaResult.error));

  const decisions = summarizeDecisions(meta && meta.decisions, criteria);
  const decisionRows = decisionItems(meta && meta.decisions, criteria);
  const attackInfo = attackView(attack, { meta, models });
  const lockInfo = lockView(lock, {
    taskMd,
    criteriaRaw,
    attackSha256,
    protectedActual,
    taskId: id,
  });
  const has = (name, value) => (present && typeof present[name] === 'boolean' ? present[name] : value !== null);
  const redInfo = redView(red);
  const verifyInfo = verifyView(verify);
  const coverageInfo = coverageView(verify);
  const recordInfo = recordView(acceptance);
  const effectsInfo = effectsView(meta, criteria, { verify, record: acceptance });
  /*
   * 0.4.1: строгость проблемы эффекта — из политики. Панель проецирует её в
   * boardTask, чтобы бейдж доски красился флагом effect-problem, а не статусом:
   * при decisions=off флага нет, и красный бейдж врал бы.
   */
  effectsInfo.severity = effectsInfo.status !== 'none' && effectsInfo.status !== 'ok'
    ? (policy.decisions === 'fail' ? 'error' : policy.decisions === 'warn' ? 'warn' : null)
    : null;
  if (effectsInfo.status !== 'none' && effectsInfo.status !== 'ok') {
    const level = effectsInfo.severity;
    const text = {
      missing: 'решение с impact user-visible/public-contract требует эффекта, но ни один критерий его не объявляет',
      invalid: 'эффект объявлен неверно: ' + effectsInfo.issues.join('; '),
      unlinked: 'решение ссылается мимо цепи эффекта: '
        + effectsInfo.unlinked.map((item) => item.decision + '→' + item.ref).join(', '),
      mismatch: 'ворота записали несогласованность эффекта решения',
    }[effectsInfo.status] || 'эффект решения объявлен неполно';
    if (level) flags.push(flag('effect-problem', level, text, effectsInfo));
  }
  const risk = meta && typeof meta.risk === 'string' ? meta.risk : null;
  const attackRequired = Boolean(risk && risk !== 'low' && policy.attack !== 'off');

  /* --- lock ------------------------------------------------------- */
  if (lockInfo) {
    if (!lockInfo.versionOk) flags.push(flag('lock-version', 'warn', 'criteria.lock: версия ' + lockInfo.version + ', нужна 3'));
    if (lockInfo.mismatches.length > 0) {
      flags.push(flag(
        'lock-mismatch',
        'error',
        'замок не совпадает с контрактом: ' + lockInfo.mismatches.map((item) => item.field).join(', '),
        lockInfo.mismatches,
      ));
    }
    const protectedDiff = lockInfo.protectedDiff;
    if (protectedDiff.changed.length || protectedDiff.missing.length || protectedDiff.added.length) {
      flags.push(flag(
        'lock-mismatch-protected',
        'error',
        'защищённые файлы: изменены ' + protectedDiff.changed.length
          + ', исчезли ' + protectedDiff.missing.length
          + ', появились ' + protectedDiff.added.length,
        protectedDiff,
      ));
    }
  }

  /* --- attack ----------------------------------------------------- */
  if (!attackInfo) {
    if (policy.attack === 'fail' && risk && risk !== 'low') {
      flags.push(flag('attack-missing', 'error', 'нет attack.json: атака спецификации не проводилась (policy.attack=fail)'));
    } else if (attackRequired) {
      flags.push(flag('attack-missing', 'warn', 'нет attack.json: атака не проводилась (policy.attack=warn)'));
    }
  } else {
    if (attackInfo.summary.unresolved > 0) {
      flags.push(flag(
        'attack-unresolved',
        severityForPolicy(policy.attack),
        'blocking-находки без решения: ' + attackInfo.unresolvedIds.join(', '),
      ));
    }
    if (attackInfo.sameSession) {
      flags.push(flag('attack-not-independent', 'warn', 'критик из сессии постановщика: атака не независима'));
    } else if (attackInfo.level === 'same-family') {
      flags.push(flag(
        'attack-same-family',
        severityForPolicy(policy.roles.modelFamily),
        'критик той же модели/семейства, что постановщик (' + attackInfo.critic.model + ')',
      ));
    }
    if (attackInfo.issues.length > 0) {
      flags.push(flag('attack-structure', 'warn', 'attack.json: ' + attackInfo.issues.join('; ')));
    }
  }

  /* --- decisions -------------------------------------------------- */
  if (decisions.assumed.length > 0) {
    flags.push(flag('decisions-assumed', 'warn', 'решения без доказательства: ' + decisions.assumed.join(', ')));
  }
  if (decisions.unproven.length > 0) {
    flags.push(flag(
      'decision-unproven',
      severityForPolicy(policy.decisions),
      'решение о пользовательском контракте без критерия и без подтверждения: ' + decisions.unproven.join(', '),
    ));
  }
  if (recordInfo && recordInfo.decisions) {
    const recorded = [...recordInfo.decisions.assumed].map(String).sort();
    const derived = [...decisions.assumed].map(String).sort();
    if (JSON.stringify(recorded) !== JSON.stringify(derived)) {
      flags.push(flag(
        'decisions-mismatch',
        'error',
        'decisions.assumed в записи [' + recorded.join(', ') + '] не совпадает с контрактом [' + derived.join(', ') + ']',
      ));
    }
  }

  /* --- verify, red, coverage -------------------------------------- */
  if (verifyInfo) {
    if (!verifyInfo.allPassed) {
      flags.push(flag(
        'verify-failed',
        'error',
        'verify.json: проверка не пройдена (failed ' + verifyInfo.failed + ', нарушений ' + verifyInfo.violations.length + ')',
      ));
    }
    if (!redInfo && !(verifyInfo.bypasses && verifyInfo.bypasses.allowMissingRed === true)) {
      flags.push(flag('red-missing', 'warn', 'есть verify.json, но нет red.json: красный не доказан'));
    }
  }
  if (redInfo && !redInfo.redProven) {
    flags.push(flag(
      'red-not-proven',
      'warn',
      'red.json: красный не доказан' + (redInfo.redExpectation && redInfo.redExpectation.errors.length
        ? ' (' + redInfo.redExpectation.errors.join('; ') + ')'
        : ''),
    ));
  }
  if (coverageInfo && coverageInfo.uncovered.length > 0) {
    flags.push(flag(
      'coverage-uncovered',
      severityForPolicy(policy.coverage),
      'изменённые файлы без покрытия: ' + coverageInfo.uncovered.join(', '),
      coverageInfo.uncovered,
    ));
  }

  /* --- acceptance record ------------------------------------------ */
  if (recordInfo) {
    if (recordInfo.status !== 'accepted') {
      flags.push(flag('record-status', 'error', 'статус записи: ' + recordInfo.status));
    }
    if (recordInfo.legacy) {
      flags.push(flag('record-legacy', 'warn', 'запись v' + recordInfo.version + ': нет independence/decisions/attack (до 2.0)'));
    }
    if (!recordInfo.signed) {
      flags.push(flag('record-unsigned', 'warn', 'запись без подписи Ed25519'));
    }
    if (recordInfo.releaseReady === false) {
      flags.push(flag('release-not-ready', 'warn', 'releaseReady=false: выпуск закрыт'));
    }
    if (recordInfo.review && !recordInfo.review.releaseReady) {
      flags.push(flag(
        'review-blocked',
        'error',
        'review: ' + (recordInfo.review.decision || 'нет решения')
          + (recordInfo.review.unresolved.length ? ', blocking без решения: ' + recordInfo.review.unresolved.join(', ') : ''),
      ));
    }
    if (recordInfo.version >= 5 && !recordInfo.decisions) {
      flags.push(flag('record-no-decisions', 'warn', 'запись v' + recordInfo.version + ' без блока decisions'));
    }
  }

  /* --- stage ------------------------------------------------------- */
  let stage;
  if (!metaResult.ok || !criteriaResult.ok) {
    stage = 'incomplete';
  } else if (recordInfo) {
    const blocked = recordInfo.status !== 'accepted'
      || recordInfo.releaseReady === false
      || (recordInfo.review && recordInfo.review.releaseReady === false);
    stage = blocked ? 'remarks' : 'accepted';
  } else if (has('acceptance', acceptance)) {
    // The record exists but cannot be parsed: never pretend the task is green.
    stage = 'remarks';
  } else if (verifyInfo && verifyInfo.allPassed) {
    stage = 'green';
  } else if (redInfo && redInfo.redProven) {
    stage = 'red';
  } else if (lockInfo) {
    stage = 'lock';
  } else if (attackRequired && (!attackInfo || attackInfo.summary.unresolved > 0)) {
    stage = 'attack';
  } else {
    stage = 'contract';
  }

  const errors = flags.filter((item) => item.severity === 'error').length;
  const warnings = flags.filter((item) => item.severity === 'warn').length;

  return {
    id: String(meta && meta.id !== undefined ? meta.id : id),
    dir,
    title: (meta && typeof meta.title === 'string' && meta.title) || (criteriaResult.parsed && criteriaResult.parsed.title) || null,
    risk,
    created: (meta && meta.created) || null,
    stage,
    stageLabel: STAGE_LABELS[stage],
    errors,
    warnings,
    flags,
    artifacts: {
      task: has('task', taskMd),
      criteria: has('criteria', criteriaRaw),
      lock: has('lock', lock),
      attack: has('attack', attack),
      red: has('red', red),
      verify: has('verify', verify),
      acceptance: has('acceptance', acceptance),
    },
    contract: meta
      ? {
          id: meta.id === undefined ? null : String(meta.id),
          version: meta.version === undefined ? null : meta.version,
          title: meta.title || null,
          risk: meta.risk || null,
          created: meta.created || null,
          owner: meta.owner || null,
          executor: meta.executor || null,
          acceptor: meta.acceptor || null,
          base: meta.base || null,
          issuedBy: meta.issuedBy || null,
          allowedPaths: Array.isArray(meta.allowedPaths) ? meta.allowedPaths.map(String) : [],
          protectedPaths: Array.isArray(meta.protectedPaths) ? meta.protectedPaths.map(String) : [],
          hashExclude: Array.isArray(meta.hashExclude) ? meta.hashExclude.map(String) : [],
          securityReview: meta.securityReview === true,
          humanSignoff: meta.humanSignoff === true,
          followUps: Array.isArray(meta.followUps) ? meta.followUps : [],
        }
      : null,
    criteria: criteria.map((criterion) => ({
      id: criterion && criterion.id !== undefined ? String(criterion.id) : null,
      title: criterion && criterion.title ? String(criterion.title) : null,
      command: criterion && criterion.command ? String(criterion.command) : null,
      covers: criterion && Array.isArray(criterion.covers) ? criterion.covers.map(String) : [],
      tags: criterion && Array.isArray(criterion.tags) ? criterion.tags.map(String) : [],
      manual: isManual(criterion),
      timeoutMs: criterion && criterion.timeoutMs ? Number(criterion.timeoutMs) : null,
      expect: criterion && criterion.expect && typeof criterion.expect === 'object' ? criterion.expect : null,
    })),
    decisions: { ...decisions, items: decisionRows },
    effects: effectsInfo,
    regress: regress || null,
    lock: lockInfo,
    attack: attackInfo,
    red: redInfo,
    verify: verifyInfo,
    coverage: coverageInfo,
    record: recordInfo,
    git: { head: head || null, log: Array.isArray(gitLog) ? gitLog : [] },
  };
}

/** Board projection: everything the columns need, without the heavy detail. */
export function boardTask(state) {
  return {
    id: state.id,
    dir: state.dir,
    title: state.title,
    risk: state.risk,
    stage: state.stage,
    stageLabel: state.stageLabel,
    errors: state.errors,
    warnings: state.warnings,
    flags: state.flags,
    artifacts: state.artifacts,
    created: state.created,
    acceptedAt: state.record ? state.record.acceptedAt : null,
    assumed: state.decisions.assumed,
    attackUnresolved: state.attack ? state.attack.summary.unresolved : 0,
    coverageUncovered: state.coverage ? state.coverage.uncovered.length : 0,
    redProven: Boolean(state.red && state.red.redProven),
    verifyPassed: Boolean(state.verify && state.verify.allPassed),
    lockInSync: state.lock ? state.lock.inSync : null,
    lockVersion: state.lock ? state.lock.version : null,
    recordVersion: state.record ? state.record.version : null,
    releaseReady: state.record ? state.record.releaseReady : null,
    /* 0.4.0 (WC-5): эффект виден на доске, иначе о нём знает только карточка. */
    effects: state.effects
      ? {
          status: state.effects.status,
          required: state.effects.required,
          declared: state.effects.declared.length,
          links: state.effects.links.length,
          unlinked: state.effects.unlinked.length,
          /* 0.4.1: строгость флага effect-problem (error/warn/null при decisions=off). */
          severity: state.effects.severity || null,
        }
      : null,
    /* 0.4.0: запись в regress.baseline.json — единственный след регресса на диске. */
    regress: state.regress || null,
  };
}

export function countStages(tasks) {
  const counts = Object.fromEntries(STAGE_ORDER.map((code) => [code, 0]));
  for (const task of tasks) counts[task.stage] = (counts[task.stage] || 0) + 1;
  return counts;
}

