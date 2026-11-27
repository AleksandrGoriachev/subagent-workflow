/*
 * Решения и эффекты: digest, сводка, покрытие.
 *
 * 0181: часть spec/scripts/lib/common.mjs; публичный вход — common.mjs.
 */
import { toPosix, canonicalize, sha256 } from './fsio.mjs';
import { globToRegExp, matchesAny } from './glob.mjs';
import { isManual } from './journal.mjs';
export const DECISION_CLASSES = ['mechanical', 'semantic', 'contract'];
export const DECISION_IMPACTS = ['internal', 'user-visible', 'public-contract'];
export const DECISION_EVIDENCE_KINDS = ['criterion', 'spec', 'customer', 'human'];

export function decisionsDigest(decisions) {
  const list = Array.isArray(decisions) ? decisions : [];
  return sha256(canonicalize(JSON.stringify(list)));
}

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

/*
 * Покрытие: каждый изменённый файл кода обязан попасть под covers хотя бы одного
 * критерия. Документация и артефакты задания исключены: у них нет поведения.
 */
export function computeCoverage(meta, criteria, changed, taskRel) {
  const covers = [];
  for (const criterion of criteria.criteria) {
    for (const pattern of (Array.isArray(criterion.covers) ? criterion.covers : [])) {
      covers.push({ id: String(criterion.id), pattern: String(pattern) });
    }
  }
  const exempt = [
    taskRel + '/**',
    '.git/**',
    ...(Array.isArray(meta.hashExclude) ? meta.hashExclude : []),
    '**/*.md',
  ];
  const covered = [];
  const uncovered = [];
  for (const file of changed || []) {
    const rel = toPosix(file);
    if (matchesAny(rel, exempt)) continue;
    const hit = covers.find((cover) => globToRegExp(cover.pattern).test(rel));
    if (hit) covered.push({ path: rel, criterion: hit.id });
    else uncovered.push(rel);
  }
  return { declared: covers.length, covered, uncovered };
}

/*
 * Эффект (I-31, 2.3.0): критерий описывает наблюдаемое состояние или порог у
 * пользователя, а не факт вызова. Требуется, когда среди решений есть влияние на
 * пользователя или внешний контракт.
 */
export function userFacingDecisions(decisions) {
  return (Array.isArray(decisions) ? decisions : []).filter(
    (decision) => decision && (decision.impact === 'user-visible' || decision.impact === 'public-contract'),
  );
}

/*
 * I-34 (2.4.0): доказательство решения и эффект — одна цепь. Решение с влиянием
 * на пользователя, опирающееся на исполняемый критерий, обязано ссылаться на
 * носитель эффекта или на его измеритель. Иначе решение «доказано» одним
 * критерием, а эффект объявлен на другом, и связи между ними нет.
 */
export function effectLinks(decisions, criteriaList, effects) {
  const byId = new Map((criteriaList || []).map((criterion) => [String(criterion.id), criterion]));
  const chains = (effects || []).map((effect) => ({
    carrier: String(effect.criterion),
    measuredBy: String(effect.measuredBy),
  }));
  const applicable = (Array.isArray(decisions) ? decisions : [])
    .filter((decision) => isEffectLinkApplicable(decision, byId));
  const checked = applicable.length > 0;
  if (chains.length === 0) return { checked, issues: [], links: [] };
  const issues = [];
  const links = [];
  for (const decision of applicable) {
    const ref = String(decision.evidence.ref).trim();
    const matched = chains.filter((chain) => chain.carrier === ref || chain.measuredBy === ref);
    if (matched.length === 0) {
      issues.push('решение ' + decision.id + ': evidence.ref=' + ref + ' не входит в цепь эффекта ('
        + chains.map((chain) => chain.carrier + '→' + chain.measuredBy).join(', ')
        + ') — укажите в решении критерий из цепи');
      continue;
    }
    for (const chain of matched) {
      links.push({ decision: String(decision.id), criterion: ref, carrier: chain.carrier, measuredBy: chain.measuredBy });
    }
  }
  return { checked, issues, links };
}

export function isEffectLinkApplicable(decision, byId) {
  if (!decision || typeof decision !== 'object' || Array.isArray(decision)) return false;
  if (typeof decision.id !== 'string' || decision.id.trim() === '') return false;
  if (decision.class !== 'semantic' && decision.class !== 'contract') return false;
  if (decision.impact !== 'user-visible' && decision.impact !== 'public-contract') return false;
  const evidence = decision.evidence;
  if (!evidence || typeof evidence !== 'object' || Array.isArray(evidence)) return false;
  if (evidence.kind !== 'criterion' || typeof evidence.ref !== 'string') return false;
  const criterion = byId.get(evidence.ref.trim());
  return Boolean(criterion) && !isManual(criterion);
}

export function evaluateEffects(meta, criteria) {
  const required = userFacingDecisions(meta && meta.decisions).length > 0;
  const issues = [];
  const effects = [];
  const validEffects = [];
  for (const criterion of criteria.criteria) {
    if (criterion.effect === undefined) continue;
    const effect = criterion.effect;
    const label = 'criterion ' + criterion.id + ': effect';
    if (!effect || typeof effect !== 'object' || Array.isArray(effect)) {
      issues.push(label + ' должен быть объектом { observable, threshold }');
      continue;
    }
    let valid = true;
    if (typeof effect.observable !== 'string' || effect.observable.trim() === '') {
      issues.push(label + ': observable обязателен');
      valid = false;
    }
    if (typeof effect.threshold !== 'string' || effect.threshold.trim() === '') {
      issues.push(label + ': threshold обязателен');
      valid = false;
    }
    const measuredBy = typeof effect.measuredBy === 'string' ? effect.measuredBy.trim() : '';
    if (measuredBy === '') {
      issues.push(label + ': measuredBy обязателен — назовите критерий, который измеряет эффект');
      valid = false;
    } else if (measuredBy === String(criterion.id)) {
      /*
       * 2.3.1: измеритель не может быть тем же критерием. Иначе «эффект» и
       * проверка — один и тот же оператор, и подмена остаётся возможной.
       */
      issues.push(label + ': measuredBy не может указывать на сам критерий ' + measuredBy + ' — нужен другой критерий');
      valid = false;
    } else {
      const target = criteria.criteria.find((item) => String(item.id) === measuredBy);
      if (!target) {
        issues.push(label + ': measuredBy ссылается на неизвестный критерий ' + measuredBy);
        valid = false;
      } else if (isManual(target)) {
        issues.push(label + ': measuredBy указывает на manual-критерий ' + measuredBy + ' — измеритель должен быть исполняемым');
        valid = false;
      }
    }
    effects.push({ criterion: String(criterion.id), observable: effect.observable, threshold: effect.threshold, measuredBy });
    if (valid) validEffects.push({ criterion: String(criterion.id), measuredBy });
  }
  if (required && effects.length === 0) {
    issues.push('есть решение с impact user-visible/public-contract, но ни один критерий не объявляет effect { observable, threshold }');
  }
  const consistency = effectLinks(meta && meta.decisions, criteria.criteria, validEffects);
  issues.push(...consistency.issues);
  return {
    required,
    effects,
    checked: consistency.checked,
    links: consistency.links,
    consistencyIssues: consistency.issues,
    issues,
  };
}

/**
 * Красный прогон обязан совпасть с ожиданием задания: какие критерии должны упасть,
 * какие остаться зелёными и по какой причине. «Хоть что-то упало» — не доказательство.
 *
 * 0057 (WC-35): доказательству не хватало двух вещей. 0055→0056 — критерий падал
 * собственной ReferenceError (require в ESM) и не мог позеленеть ни при какой
 * реализации, а красный считался доказанным. structure (их 0052) — причина совпадала
 * подстрокой в любом месте вывода, поэтому «правильная» причина в начале маскировала
 * чужую. Отсюда: отказ с необработанной ReferenceError/TypeError/SyntaxError (со
 * стеком) — дефект проверки, а не красный; причина ищется в вердиктной зоне —
 * последних reasonWindow непустых строках вывода, а не где угодно.
 */
/** Окно вердиктной зоны по умолчанию: последние 25 непустых строк вывода критерия. */
