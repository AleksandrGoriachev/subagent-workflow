/**
 * 0137 (P1): политика гейтов — чистая функция из спецификации v0.2, C5.
 *
 * policy(ruleset, task.risk) → множество обязательных гейтов. Каждый гейт обязан
 * иметь факт evidence(kind=gate_run, gate=g, exit=0). Это и есть адаптивная
 * строгость: обязательность набора зависит от риска, но механизм один.
 *
 * Инвариант (решение заказчика, 10.11): decisions/red и verify НИКОГДА не
 * понижаются — это базовая связность приёмки. Понижаться могут только attack и
 * modelFamily, и только явно, через ruleset.policy.
 */

/** Классы риска, которые понимает политика. */
export const RISK_CLASSES = ['low', 'medium', 'high', 'critical'];

/** Гейты, производимые текущим процессом и записываемые в журнал. */
export const GATE_NAMES = ['red', 'verify', 'attack', 'modelFamily'];

/** Нормализовать уровень строгости: warn → off для набора обязательных гейтов. */
function isFail(level) {
  return String(level || '').toLowerCase() === 'fail';
}

/**
 * Обязательные гейты для класса риска при данных правилах.
 *
 * @param {object|null} ruleset — { policy?: { attack?, roles?: { modelFamily? } } }
 * @param {string} risk — low|medium|high|critical
 * @returns {string[]} имена гейтов в порядке применения.
 */
export function mandatoryGates(ruleset, risk) {
  const r = RISK_CLASSES.includes(String(risk)) ? String(risk) : 'medium';
  const policy = ruleset && ruleset.policy && typeof ruleset.policy === 'object' ? ruleset.policy : {};
  /* База: red (доказательство, что критерий умеет падать) и verify (свежий прогон приёмщика). */
  const gates = ['red', 'verify'];
  /* Атака спецификации: обязательна для высокого риска, только если policy.attack=fail. */
  if ((r === 'high' || r === 'critical') && isFail(policy.attack)) gates.push('attack');
  /* Независимость модели приёмщика: обязательна для высокого риска при fail. */
  const modelFamily = policy.roles && policy.roles.modelFamily ? policy.roles.modelFamily : 'warn';
  if ((r === 'high' || r === 'critical') && isFail(modelFamily)) gates.push('modelFamily');
  return gates;
}

/**
 * Оценка C5: все обязательные гейты покрыты успешным фактом evidence.
 * @param {object[]} evidence — строки facts (kind=evidence).
 * @param {string[]} gates — из mandatoryGates.
 * @returns {{status: 'pass'|'fail'|'not-applicable', detail: string, missing: string[]}}
 */
export function evaluateGates(evidence, gates, rulesetPresent) {
  /*
   * 0144 (находка Grok): конфликт доказательств проверяется ДО ruleset. Иначе без
   * политики «pass и fail одновременно» проходили как not-applicable, а итог был
   * accepted. Конфликт — это факт о данных, а не о политике.
   */
  const byGateAny = new Map();
  const conflictedAny = new Set();
  for (const row of Array.isArray(evidence) ? evidence : []) {
    const gate = String(row.gate || '');
    if (gate === '') continue;
    if (!byGateAny.has(gate)) byGateAny.set(gate, row);
    else if (byGateAny.get(gate).exit !== row.exit) conflictedAny.add(gate);
  }
  if (conflictedAny.size > 0) {
    return { status: 'fail', detail: 'конфликтные доказательства гейтов: ' + [...conflictedAny].join(', '), missing: [...conflictedAny] };
  }
  if (rulesetPresent !== true) {
    return { status: 'not-applicable', detail: 'ruleset не задан — политику оценивать не из чего', missing: [] };
  }
  if (gates.length === 0) {
    return { status: 'pass', detail: 'обязательных гейтов нет', missing: [] };
  }
  /*
   * 0143: конфликтные доказательства одного гейта (и pass, и fail) — отказ.
   * «Выбрать успешный дубль» — это и есть способ пройти гейт задним числом.
   */
  const byGate = new Map();
  const conflicted = new Set();
  for (const row of evidence) {
    const gate = String(row.gate || '');
    if (gate === '') continue;
    const previous = byGate.get(gate);
    if (!previous) { byGate.set(gate, row); continue; }
    if (previous.exit !== row.exit) conflicted.add(gate);
    else if (row.exit === 0 && previous.exit !== 0) byGate.set(gate, row);
  }
  if (conflicted.size > 0) {
    return { status: 'fail', detail: 'конфликтные доказательства гейтов: ' + [...conflicted].join(', '), missing: [...conflicted] };
  }
  const missing = gates.filter((gate) => {
    const row = byGate.get(gate);
    return !row || row.exit !== 0;
  });
  if (missing.length > 0) {
    return { status: 'fail', detail: 'гейты без успешного доказательства: ' + missing.join(', '), missing };
  }
  return { status: 'pass', detail: 'все обязательные гейты покрыты: ' + gates.join(', '), missing: [] };
}