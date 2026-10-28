/**
 * Workflow state core: artifacts -> { task, stage, flags }.
 *
 * Everything here is deterministic given the artifact contents: the pure
 * functions never touch the filesystem. \`readRepository\` / \`readTask\` are the
 * only adapters that read files and run read-only git commands. The panel,
 * the HTTP API and any future action reuse this one computation so the UI and
 * the gates cannot drift apart.
 *
 * Mirrors the rules of subagent-workflow 2.2.1:
 *  - canonicalize/sha256 and lock v3 field names (spec/scripts/lib/common.mjs);
 *  - decisions summary and coverage (same module);
 *  - policy levels and model families (spec/scripts/lib/policy.mjs);
 *  - attack summary (spec/scripts/lib/attack.mjs);
 *  - acceptance record versions 3..6 (task-accept / task-check-acceptance).
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { PLUGIN_VERSION } from './compat.js';

/* Одна точка правды: TOOL не может отстать от package.json, пока он выводится
 * из PLUGIN_VERSION (тот сверяется с package.json тестом). Раньше строка была
 * вписана руками и осталась на 0.2.1 при фактических 0.3.0 — та же ошибка, что
 * пакет закрыл в 2.4.2. */
export const TOOL = 'dsh-workflow-console/' + PLUGIN_VERSION;
export const POLICY_LEVELS = ['off', 'warn', 'fail'];
export const DECISION_CLASSES = ['mechanical', 'semantic', 'contract'];
export const DECISION_IMPACTS = ['internal', 'user-visible', 'public-contract'];
export const DECISION_EVIDENCE_KINDS = ['criterion', 'spec', 'customer', 'human'];
export const REMARK_CLASSES = ['blocking', 'non-blocking', 'follow-up'];

export const STAGES = [
  { code: 'incomplete', label: 'неполный' },
  { code: 'contract', label: 'контракт' },
  { code: 'attack', label: 'атака' },
  { code: 'lock', label: 'замок' },
  { code: 'red', label: 'красный' },
  { code: 'green', label: 'зелёный' },
  { code: 'accepted', label: 'принято' },
  { code: 'remarks', label: 'замечания' },
];

export const STAGE_LABELS = Object.fromEntries(STAGES.map((item) => [item.code, item.label]));
export const STAGE_ORDER = STAGES.map((item) => item.code);

const DEFAULT_CONFIG = {
  version: 1,
  tasksDir: 'docs/tasks',
  keysFile: 'docs/subagent-workflow/acceptors.json',
  logs: 'local',
  actor: { primaryEnv: 'DSH_SESSION_ID', fallbackEnv: 'TASK_ACTOR_SESSION', modelEnv: 'DSH_MODEL' },
  policy: { decisions: 'fail', coverage: 'fail', attack: 'off', roles: { modelFamily: 'warn' } },
  models: {},
  roles: {},
  verifyTimeoutMs: 1800000,
};

/* ------------------------------------------------------------------ *
 * primitives
 * ------------------------------------------------------------------ */

export function toPosix(value) {
  return String(value).replace(/\\/g, '/');
}

export function fromPosix(value) {
  return String(value).split('/').join(path.sep);
}

/** Same text normalization the gates hash: CRLF -> LF, trim trailing blanks. */
export function canonicalize(text) {
  return String(text)
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.replace(/[ \t]+$/g, ''))
    .join('\n')
    .replace(/^\n+/, '')
    .replace(/\n+$/, '') + '\n';
}

export function sha256Text(text) {
  return crypto.createHash('sha256').update(String(text), 'utf8').digest('hex');
}

export function sha256Bytes(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

export function exists(file) {
  try {
    fs.accessSync(file);
    return true;
  } catch {
    return false;
  }
}

/**
 * Read text and drop a BOM. UTF-8 is the normative encoding; UTF-16LE/BE is
 * accepted too because real repositories contain artifacts written by Windows
 * PowerShell (`FF FE` BOM), and a read-only viewer must not lose the record.
 */
export function readText(file) {
  const buffer = fs.readFileSync(file);
  if (buffer.length >= 2 && buffer[0] === 0xff && buffer[1] === 0xfe) {
    return buffer.toString('utf16le').replace(/^\uFEFF/u, '');
  }
  if (buffer.length >= 2 && buffer[0] === 0xfe && buffer[1] === 0xff) {
    const swapped = Buffer.from(buffer);
    swapped.swap16();
    return swapped.toString('utf16le').replace(/^\uFEFF/u, '');
  }
  const text = buffer.toString('utf8');
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

export function readJsonSafe(file) {
  if (!exists(file)) return { value: null, error: null };
  try {
    return { value: JSON.parse(readText(file)), error: null };
  } catch (error) {
    return { value: null, error: String(error && error.message ? error.message : error) };
  }
}

/* ------------------------------------------------------------------ *
 * contract parsing
 * ------------------------------------------------------------------ */

export function parseTaskMeta(taskMd) {
  if (typeof taskMd !== 'string') return { ok: false, meta: null, error: 'нет task.md' };
  const match = taskMd.match(/<!--\s*TASK-META\s*([\s\S]*?)-->/);
  if (!match) return { ok: false, meta: null, error: 'в task.md нет блока <!-- TASK-META ... -->' };
  try {
    const meta = JSON.parse(match[1].trim());
    if (!meta || typeof meta !== 'object' || Array.isArray(meta)) {
      return { ok: false, meta: null, error: 'TASK-META не объект' };
    }
    return { ok: true, meta, error: null };
  } catch (error) {
    return { ok: false, meta: null, error: 'TASK-META не JSON: ' + String(error.message || error) };
  }
}

export function extractCriteriaBlock(taskMd) {
  if (typeof taskMd !== 'string') return null;
  const match = taskMd.match(/<!--\s*CRITERIA:BEGIN\s*-->([\s\S]*?)<!--\s*CRITERIA:END\s*-->/);
  return match ? match[1] : null;
}

export function parseCriteriaRaw(raw) {
  if (typeof raw !== 'string') return { ok: false, parsed: null, criteria: [], error: 'нет criteria.json' };
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    return { ok: false, parsed: null, criteria: [], error: 'criteria.json не JSON: ' + String(error.message || error) };
  }
  const criteria = Array.isArray(parsed) ? parsed : parsed && parsed.criteria;
  if (!Array.isArray(criteria) || criteria.length === 0) {
    return { ok: false, parsed, criteria: [], error: 'criteria.json: пустой или отсутствующий список criteria' };
  }
  return { ok: true, parsed, criteria, error: null };
}

export function isManual(criterion) {
  return criterion && (criterion.manual === true || (Array.isArray(criterion.tags) && criterion.tags.includes('manual')));
}

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

/* ------------------------------------------------------------------ *
 * lock
 * ------------------------------------------------------------------ */

export function lockView(lock, { taskMd, criteriaRaw, attackSha256, protectedActual, taskId } = {}) {
  if (!lock || typeof lock !== 'object' || Array.isArray(lock)) return null;
  const expected = {
    task: taskId === undefined ? null : String(taskId),
    taskFileSha256: typeof taskMd === 'string' ? sha256Text(canonicalize(taskMd)) : null,
    criteriaSha256: (() => {
      const block = extractCriteriaBlock(taskMd);
      return block === null ? null : sha256Text(canonicalize(block));
    })(),
    criteriaJsonSha256: typeof criteriaRaw === 'string' ? sha256Text(canonicalize(criteriaRaw)) : null,
    attackSha256: attackSha256 === undefined ? null : attackSha256,
  };
  const mismatches = [];
  for (const key of Object.keys(expected)) {
    if (expected[key] === null) continue;
    if (String(lock[key] === undefined ? null : lock[key]) !== String(expected[key])) {
      mismatches.push({ field: key, expected: expected[key], actual: lock[key] === undefined ? null : lock[key] });
    }
  }
  let protectedDiff = { changed: [], missing: [], added: [] };
  if (Array.isArray(protectedActual)) {
    const locked = new Map((Array.isArray(lock.protected) ? lock.protected : []).map((item) => [String(item.path), item.sha256]));
    const actual = new Map(protectedActual.map((item) => [String(item.path), item.sha256]));
    for (const [file, hash] of actual) {
      if (!locked.has(file)) protectedDiff.added.push(file);
      else if (locked.get(file) !== hash) protectedDiff.changed.push(file);
    }
    for (const file of locked.keys()) if (!actual.has(file)) protectedDiff.missing.push(file);
  }
  const protectedClean = !protectedDiff.changed.length && !protectedDiff.missing.length && !protectedDiff.added.length;
  const versionOk = lock.version === 3;
  return {
    present: true,
    version: lock.version === undefined ? null : lock.version,
    versionOk,
    task: lock.task === undefined ? null : String(lock.task),
    createdAt: lock.createdAt || null,
    tool: lock.tool || null,
    contractCommit: lock.contractCommit || null,
    expected,
    mismatches,
    protectedDiff,
    inSync: mismatches.length === 0 && protectedClean && versionOk,
  };
}

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

  const required = applicable.length > 0;
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
  if (effectsInfo.status !== 'none' && effectsInfo.status !== 'ok') {
    const level = policy.decisions === 'fail' ? 'error' : policy.decisions === 'warn' ? 'warn' : null;
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

/* ------------------------------------------------------------------ *
 * repository adapter (the only place that reads files)
 * ------------------------------------------------------------------ */

export function loadConfig(root) {
  const file = path.join(root, 'docs', 'subagent-workflow', 'workflow.config.json');
  const raw = readJsonSafe(file);
  if (raw.error) {
    return { ...DEFAULT_CONFIG, loaded: false, file, error: raw.error };
  }
  if (!raw.value) return { ...DEFAULT_CONFIG, loaded: false, file, error: null };
  const value = raw.value;
  return {
    ...DEFAULT_CONFIG,
    ...value,
    actor: { ...DEFAULT_CONFIG.actor, ...(value.actor || {}) },
    policy: {
      ...DEFAULT_CONFIG.policy,
      ...(value.policy || {}),
      roles: { ...DEFAULT_CONFIG.policy.roles, ...((value.policy || {}).roles || {}) },
    },
    models: { ...DEFAULT_CONFIG.models, ...(value.models || {}) },
    roles: { ...DEFAULT_CONFIG.roles, ...(value.roles || {}) },
    loaded: true,
    file,
    error: null,
  };
}

/**
 * Run a command with its output captured through temporary files instead of
 * pipes. DSH's workspace sandbox denies piped stdio (EPERM), while file-backed
 * stdio keeps read-only git usable inside the same sandbox.
 */
export function captureCommand(command, args, options = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-console-cmd-'));
  const outFile = path.join(dir, 'stdout');
  const errFile = path.join(dir, 'stderr');
  let outFd;
  let errFd;
  try {
    outFd = fs.openSync(outFile, 'w');
    errFd = fs.openSync(errFile, 'w');
    const result = spawnSync(command, args, {
      cwd: options.cwd,
      windowsHide: true,
      timeout: options.timeoutMs || 20000,
      stdio: ['ignore', outFd, errFd],
    });
    let stdout = '';
    let stderr = '';
    try { stdout = fs.readFileSync(outFile, 'utf8'); } catch { /* ignore */ }
    try { stderr = fs.readFileSync(errFile, 'utf8'); } catch { /* ignore */ }
    return {
      status: result.status,
      signal: result.signal || null,
      error: result.error || null,
      stdout,
      stderr,
    };
  } finally {
    if (outFd !== undefined) { try { fs.closeSync(outFd); } catch { /* ignore */ } }
    if (errFd !== undefined) { try { fs.closeSync(errFd); } catch { /* ignore */ } }
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
  }
}

/** Read-only git helper. Never passes a mutating subcommand. */
export function runGit(root, args) {
  try {
    const result = captureCommand('git', ['-C', root, ...args], { timeoutMs: 20000 });
    const ok = !result.error && result.status === 0;
    return { ok, status: result.status, stdout: result.stdout, stderr: result.stderr, error: result.error };
  } catch (error) {
    return { ok: false, status: null, stdout: '', stderr: '', error };
  }
}

export function readGitHead(root) {
  const result = runGit(root, ['rev-parse', '--verify', 'HEAD']);
  return result.ok ? result.stdout.trim() : null;
}

export function readGitLog(root, paths, limit = 20) {
  const target = paths && paths.length > 0 ? paths.map(toPosix) : ['.'];
  const result = runGit(root, [
    'log',
    '-n', String(limit),
    '--date=short',
    '--pretty=format:%h%x09%ad%x09%s',
    '--',
    ...target,
  ]);
  if (!result.ok) return [];
  const out = [];
  for (const line of result.stdout.split('\n')) {
    if (!line.trim()) continue;
    const parts = line.split('\t');
    const hash = parts.shift() || '';
    const date = parts.shift() || '';
    const subject = parts.join('\t');
    out.push({ hash, date, subject });
  }
  return out;
}

function walkFiles(root) {
  const out = [];
  const skipDirs = new Set(['.git', 'node_modules', '.venv', 'venv', '__pycache__']);
  const walk = (dir, rel) => {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const childRel = rel ? rel + '/' + entry.name : entry.name;
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        if (skipDirs.has(entry.name)) continue;
        walk(path.join(dir, entry.name), childRel);
      } else if (entry.isFile()) {
        out.push(childRel);
      }
    }
  };
  walk(root, '');
  return out;
}

export function listRepoFiles(root) {
  const tracked = runGit(root, ['ls-files', '-z']);
  if (tracked.ok) {
    const set = new Set();
    for (const item of tracked.stdout.split('\0')) if (item) set.add(toPosix(item));
    const untracked = runGit(root, ['ls-files', '--others', '--exclude-standard', '-z']);
    if (untracked.ok) for (const item of untracked.stdout.split('\0')) if (item) set.add(toPosix(item));
    return [...set].sort();
  }
  return walkFiles(root).sort();
}

export function globToRegExp(pattern) {
  const source = toPosix(pattern);
  let regex = '^';
  for (let i = 0; i < source.length; i += 1) {
    const char = source[i];
    if (char === '*') {
      if (source[i + 1] === '*') {
        i += 1;
        if (source[i + 1] === '/') {
          i += 1;
          regex += '(?:.*/)?';
        } else {
          regex += '.*';
        }
      } else {
        regex += '[^/]*';
      }
    } else if (char === '?') {
      regex += '[^/]';
    } else if (char === '[') {
      const end = source.indexOf(']', i + 1);
      if (end === -1) regex += '\\[';
      else {
        regex += source.slice(i, end + 1);
        i = end;
      }
    } else {
      regex += char.replace(/[.+^\${}()|\\]/g, '\\$&');
    }
  }
  return new RegExp(regex + '$');
}

export function matchesAny(file, patterns) {
  const value = toPosix(file);
  return (patterns || []).some((pattern) => globToRegExp(pattern).test(value));
}

/** Hash the protected files of one task, with a per-run stat cache. */
export function hashProtectedFiles(root, meta, taskRel, { repoFiles, hashCache } = {}) {
  const patterns = meta && Array.isArray(meta.protectedPaths) ? meta.protectedPaths : [];
  if (patterns.length === 0) return [];
  const exclude = [
    '.git/**',
    'node_modules/**',
    String(taskRel) + '/**',
    ...(meta && Array.isArray(meta.hashExclude) ? meta.hashExclude : []),
  ];
  const files = (repoFiles || []).filter((file) => matchesAny(file, patterns) && !matchesAny(file, exclude));
  return files.sort().map((file) => {
    const absolute = path.join(root, fromPosix(file));
    let stat;
    try {
      stat = fs.statSync(absolute);
    } catch {
      return { path: file, sha256: null };
    }
    const key = absolute + '\0' + stat.mtimeMs + '\0' + stat.size;
    if (hashCache && hashCache.has(key)) return { path: file, sha256: hashCache.get(key) };
    let hash = null;
    try {
      hash = sha256Bytes(fs.readFileSync(absolute));
    } catch {
      hash = null;
    }
    if (hashCache) hashCache.set(key, hash);
    return { path: file, sha256: hash };
  });
}

function readPackageInfo(root) {
  const workflowDir = path.join(root, 'docs', 'subagent-workflow');
  let packageVersion = null;
  const versionFile = path.join(workflowDir, 'VERSION');
  if (exists(versionFile)) {
    const text = readText(versionFile).trim();
    if (text) packageVersion = text;
  }
  let specVersion = null;
  const specFile = path.join(workflowDir, 'SPEC.md');
  if (exists(specFile)) {
    const head = readText(specFile).split('\n').slice(0, 20).join('\n');
    const match = head.match(/Версия:\s*([0-9]+(?:\.[0-9]+)*)/);
    if (match) specVersion = match[1];
  }
  const versionSource = packageVersion
    ? 'VERSION'
    : specVersion
      ? 'SPEC'
      : null;
  if (!packageVersion) packageVersion = specVersion;
  return { packageVersion, specVersion, versionSource };
}

/** Which workflow files exist in the deployed copy (used by compat checks). */
export function readWorkflowInfo(root) {
  const dir = path.join(path.resolve(root), 'docs', 'subagent-workflow');
  const has = (rel) => exists(path.join(dir, rel));
  return {
    dir: exists(dir),
    spec: has('SPEC.md'),
    versionFile: has('VERSION'),
    attackGate: has('scripts/task-attack.mjs'),
    policyLib: has('scripts/lib/policy.mjs'),
    checkAcceptance: has('scripts/task-check-acceptance.mjs'),
    templates: has('templates/task.md'),
  };
}

function readOneTask(root, dir, { config, repoFiles, hashCache, baseline = null }) {
  const parseErrors = [];
  const files = {
    task: path.join(dir, 'task.md'),
    criteria: path.join(dir, 'criteria.json'),
    lock: path.join(dir, 'criteria.lock'),
    attack: path.join(dir, 'attack.json'),
    red: path.join(dir, 'red.json'),
    verify: path.join(dir, 'verify.json'),
    acceptance: path.join(dir, 'acceptance.json'),
  };
  const present = {};
  for (const [name, file] of Object.entries(files)) present[name] = exists(file);
  const taskMd = present.task ? readText(files.task) : null;
  const criteriaRaw = present.criteria ? readText(files.criteria) : null;
  const lockRaw = readJsonSafe(files.lock);
  if (lockRaw.error) parseErrors.push({ file: 'criteria.lock', message: lockRaw.error });
  const attackRaw = readJsonSafe(files.attack);
  if (attackRaw.error) parseErrors.push({ file: 'attack.json', message: attackRaw.error });
  const redRaw = readJsonSafe(files.red);
  if (redRaw.error) parseErrors.push({ file: 'red.json', message: redRaw.error });
  const verifyRaw = readJsonSafe(files.verify);
  if (verifyRaw.error) parseErrors.push({ file: 'verify.json', message: verifyRaw.error });
  const acceptanceRaw = readJsonSafe(files.acceptance);
  if (acceptanceRaw.error) parseErrors.push({ file: 'acceptance.json', message: acceptanceRaw.error });

  const metaResult = parseTaskMeta(taskMd);
  const id = String(metaResult.ok && metaResult.meta.id !== undefined ? metaResult.meta.id : path.basename(dir));
  const taskRel = toPosix(path.relative(root, dir));
  const protectedActual = metaResult.ok && lockRaw.value
    ? hashProtectedFiles(root, metaResult.meta, taskRel, { repoFiles, hashCache })
    : null;
  const attackSha256 = exists(path.join(dir, 'attack.json'))
    ? sha256Bytes(fs.readFileSync(path.join(dir, 'attack.json')))
    : null;

  return buildTaskState({
    id,
    dir: taskRel,
    regress: baseline && baseline.byTask ? baseline.byTask[String(id)] || null : null,
    taskMd,
    criteriaRaw,
    lock: lockRaw.value,
    attack: attackRaw.value,
    red: redRaw.value,
    verify: verifyRaw.value,
    acceptance: acceptanceRaw.value,
    present,
    attackSha256,
    protectedActual,
    config,
    head: null,
    gitLog: null,
    parseErrors,
  });
}

/**
 * regress.baseline.json (2.3.1): легализованный долг регресса.
 *
 * Панель — только чтение: сама она регресс не запускает (это ворота), и на диске
 * от него остаётся ровно этот файл. Читаем его, чтобы назвать статус задания и
 * срок пересмотра, а не выдумывать «регресс не проверялся».
 */
export function readBaseline(root) {
  const resolved = path.resolve(root);
  const file = path.join(resolved, 'regress.baseline.json');
  const rel = 'regress.baseline.json';
  const empty = { present: false, path: rel, generatedAt: null, version: null, entries: [], byTask: {}, expired: [], error: null };
  if (!exists(file)) return empty;
  let parsed;
  try {
    parsed = JSON.parse(readText(file));
  } catch (error) {
    return { ...empty, present: true, error: String(error && error.message ? error.message : error) };
  }
  const today = new Date().toISOString().slice(0, 10);
  const entries = (Array.isArray(parsed && parsed.entries) ? parsed.entries : [])
    .filter((entry) => entry && typeof entry.task === 'string' && typeof entry.status === 'string')
    .map((entry) => ({
      task: String(entry.task),
      status: String(entry.status),
      reason: String(entry.reason || ''),
      since: entry.since ? String(entry.since) : null,
      reviewBy: entry.reviewBy ? String(entry.reviewBy) : null,
      expired: Boolean(entry.reviewBy && String(entry.reviewBy).slice(0, 10) < today),
    }));
  const byTask = {};
  for (const entry of entries) if (!byTask[entry.task]) byTask[entry.task] = entry;
  return {
    present: true,
    path: rel,
    generatedAt: parsed && parsed.generatedAt ? String(parsed.generatedAt) : null,
    version: parsed && parsed.version !== undefined ? Number(parsed.version) || null : null,
    entries,
    byTask,
    expired: entries.filter((entry) => entry.expired),
    error: null,
  };
}

/** Read the whole repository: config, task list and every task's board state. */
export function readRepository(root, options = {}) {
  const resolved = path.resolve(root);
  const config = loadConfig(resolved);
  const tasksDirRel = toPosix(config.tasksDir || 'docs/tasks');
  const tasksDir = path.resolve(resolved, fromPosix(tasksDirRel));
  const repoFiles = listRepoFiles(resolved);
  const hashCache = new Map();
  const head = readGitHead(resolved);
  const packageInfo = readPackageInfo(resolved);
  const baseline = readBaseline(resolved);
  const tasks = [];
  const skipped = [];

  let entries = [];
  try {
    entries = fs.readdirSync(tasksDir, { withFileTypes: true });
  } catch (error) {
    skipped.push({ path: tasksDirRel, reason: 'каталог заданий не читается: ' + String(error.message || error) });
  }
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (entry.name.startsWith('.')) continue;
    const dir = path.join(tasksDir, entry.name);
    const rel = toPosix(path.join(tasksDirRel, entry.name));
    if (!entry.isDirectory()) {
      skipped.push({ path: rel, reason: 'плоский файл: формат v1.1, не v2' });
      continue;
    }
    if (!exists(path.join(dir, 'task.md'))) {
      skipped.push({ path: rel, reason: 'каталог без task.md' });
      continue;
    }
    tasks.push(readOneTask(resolved, dir, { config, repoFiles, hashCache, baseline }));
  }

  const order = new Map(STAGE_ORDER.map((code, index) => [code, index]));
  tasks.sort((a, b) => {
    const stage = (order.get(a.stage) || 0) - (order.get(b.stage) || 0);
    if (stage !== 0) return stage;
    return String(a.id).localeCompare(String(b.id), 'ru');
  });

  return {
    root: resolved,
    tasksDir: tasksDirRel,
    config,
    configPath: config.file,
    configLoaded: config.loaded,
    packageVersion: packageInfo.packageVersion,
    specVersion: packageInfo.specVersion,
    versionSource: packageInfo.versionSource,
    workflow: readWorkflowInfo(resolved),
    head,
    tasks: tasks.map(boardTask),
    counts: countStages(tasks),
    skipped,
    /* 0.4.0: долг регресса — на доске, а не только в терминале. */
    regress: {
      present: baseline.present,
      path: baseline.path,
      generatedAt: baseline.generatedAt,
      error: baseline.error,
      entries: baseline.entries.length,
      expired: baseline.expired.length,
    },
    tool: TOOL,
  };
}

/** Light repository header: config, paths, versions and HEAD, without tasks. */
export function readRepoInfo(root) {
  const resolved = path.resolve(root);
  const config = loadConfig(resolved);
  const info = readPackageInfo(resolved);
  return {
    root: resolved,
    tasksDir: toPosix(config.tasksDir || 'docs/tasks'),
    configPath: config.file,
    configLoaded: config.loaded,
    config,
    packageVersion: info.packageVersion,
    specVersion: info.specVersion,
    versionSource: info.versionSource,
    workflow: readWorkflowInfo(resolved),
    head: readGitHead(resolved),
  };
}

/** Read one task with the full card, including read-only git log. */
export function readTask(root, id) {
  const resolved = path.resolve(root);
  const config = loadConfig(resolved);
  const tasksDirRel = toPosix(config.tasksDir || 'docs/tasks');
  const tasksDir = path.resolve(resolved, fromPosix(tasksDirRel));
  const safeId = String(id);
  if (safeId.length === 0 || safeId !== path.basename(safeId) || safeId === '.' || safeId === '..') {
    return { error: 'некорректный id задачи', status: 400 };
  }
  const dir = path.resolve(tasksDir, safeId);
  if (!exists(path.join(dir, 'task.md'))) {
    return { error: 'задача не найдена: ' + safeId, status: 404 };
  }
  const repoFiles = listRepoFiles(resolved);
  const hashCache = new Map();
  const state = readOneTask(resolved, dir, { config, repoFiles, hashCache, baseline: readBaseline(resolved) });
  const taskRel = toPosix(path.relative(resolved, dir));
  const head = readGitHead(resolved);
  const log = readGitLog(resolved, [taskRel]);
  return {
    ...state,
    git: { head, log },
    packageVersion: readPackageInfo(resolved).packageVersion,
  };
}
