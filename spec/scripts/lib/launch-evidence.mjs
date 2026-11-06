/**
 * Свидетельство запуска узла (контракт «запуск ↔ актор», 0084/2.6.38).
 *
 * Плагин structure пишет append-only журнал запусков:
 *   <store>/runs/<12-hex sha256(abs root)>/launches.jsonl
 * строки {v:1, runId, at, root, task, node, childId, provider, model, depth, state}
 * и {v:1, runId, at, state:'settled', ok, endedAt[, errorCode]}.
 *
 * Движок только читает. Единственная проверка, которую нельзя подделать из argv:
 * childId записи обязан совпасть с DSH_SESSION_ID приёмщика (его ставит харнесс).
 * Второй источник — health.json плагина: при structurePolicy=fail и
 * preExecuteSubscribed=false императив не исполняется, и приёмка не проходит.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';

/** Каталог стора: WF_LAUNCH_STORE для тестов, иначе хранилище плагина structure. */
export function storeRoot() {
  const fromEnv = process.env.WF_LAUNCH_STORE;
  if (typeof fromEnv === 'string' && fromEnv.trim() !== '') return path.resolve(fromEnv.trim());
  /* Стор плагина structure: журналы запусков лежат в <store>/runs/<hash>/. */
  return path.join(os.homedir(), '.dsh', 'project-graph');
}

/** Файл запусков корня: 12 hex sha256 от абсолютного пути. */
export function launchesFile(root, store = storeRoot()) {
  const hash = crypto.createHash('sha256').update(path.resolve(String(root))).digest('hex').slice(0, 12);
  return path.join(store, 'runs', hash, 'launches.jsonl');
}

/** health.json плагина: <store>/health.json (store — родитель runs). */
export function healthFile(store = storeRoot()) {
  return path.join(store, 'health.json');
}

/**
 * Все записи журнала (обе строки одного запуска остаются раздельными).
 * Битые строки пропускаются: журнал пишет другой процесс.
 */
export function readLaunches(root, store = storeRoot()) {
  const file = launchesFile(root, store);
  let text = '';
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch {
    return { file, exists: false, records: [] };
  }
  const records = [];
  for (const line of text.split('\n')) {
    if (line.trim() === '') continue;
    try {
      const row = JSON.parse(line);
      if (row && typeof row === 'object') records.push(row);
    } catch {
      /* пропускаем */
    }
  }
  return { file, exists: true, records };
}

/** Сведение записей по runId: старт + settled. */
export function runsOf(records) {
  const map = new Map();
  for (const row of Array.isArray(records) ? records : []) {
    if (!row || typeof row.runId !== 'string') continue;
    const current = map.get(row.runId) || { runId: row.runId };
    for (const [key, value] of Object.entries(row)) {
      if (value !== undefined && value !== null) current[key] = value;
    }
    map.set(row.runId, current);
  }
  return [...map.values()];
}

/**
 * Найти запуск приёмщика: childId == sessionId, node == acceptorNode
 * (или явный runId, который обязан совпасть по childId).
 *
 * @returns {{ok: boolean, code: string|null, message: string, record: object|null}}
 */
export function findAcceptorLaunch({ root, sessionId, node, runId, store = storeRoot() }) {
  const { file, exists, records } = readLaunches(root, store);
  if (!exists) {
    return {
      ok: false,
      code: 'acceptor-not-launched',
      message: 'нет журнала запусков ' + file + ': приёмщик не является запущенным узлом',
      record: null,
    };
  }
  const runs = runsOf(records);
  if (typeof runId === 'string' && runId.trim() !== '') {
    const record = runs.find((item) => item.runId === runId.trim()) || null;
    if (!record) {
      return { ok: false, code: 'run-not-found', message: 'запуск ' + runId + ' не найден в ' + file, record: null };
    }
    if (typeof record.childId !== 'string' || record.childId === '' || record.childId !== sessionId) {
      return {
        ok: false,
        code: 'run-mismatch',
        message: 'запуск ' + runId + ' принадлежит сессии ' + (record.childId || '(пусто)') + ', а приёмщик — ' + (sessionId || '(нет сессии)'),
        record,
      };
    }
    if (record.node !== node) {
      return {
        ok: false,
        code: 'run-mismatch',
        message: 'запуск ' + runId + ' — узел ' + record.node + ', а приёмщик объявлен как ' + node,
        record,
      };
    }
    return { ok: true, code: null, message: '', record };
  }
  if (typeof sessionId !== 'string' || sessionId === '') {
    return {
      ok: false,
      code: 'acceptor-not-launched',
      message: 'нет сессии приёмщика (DSH_SESSION_ID): свидетельства запуска нет',
      record: null,
    };
  }
  const record = runs.find((item) => item.childId === sessionId && item.node === node) || null;
  if (!record) {
    return {
      ok: false,
      code: 'acceptor-not-launched',
      message: 'сессия ' + sessionId + ' не запускалась как узел ' + node + ': --node — объявление, а не доказательство',
      record: null,
    };
  }
  return { ok: true, code: null, message: '', record };
}

/**
 * Модель приёмщика из записи против объявления.
 * @returns {'matched'|'mismatch'|'unknown'}
 */
export function modelVerdict(record, declared) {
  const declaredModel = declared && typeof declared === 'object' ? String(declared.model || '').trim() : '';
  const recordModel = record && typeof record.model === 'string' ? record.model.trim() : '';
  if (declaredModel === '' || recordModel === '') return 'unknown';
  return declaredModel === recordModel ? 'matched' : 'mismatch';
}

/** health.json плагина, или null. */
export function readHealth(store = storeRoot()) {
  const file = healthFile(store);
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    return parsed && typeof parsed === 'object' ? { ...parsed, file } : null;
  } catch {
    return null;
  }
}

/**
 * Императив исполняется? При structurePolicy=fail и снятой подписке — нет.
 * @returns {{ok: boolean, code: string|null, message: string, health: object|null}}
 */
export function policyEnforced(config, store = storeRoot()) {
  const block = config && config.enforcement && typeof config.enforcement === 'object' ? config.enforcement : {};
  const mode = block.structurePolicy;
  if (mode !== 'fail') return { ok: true, code: null, message: '', health: null };
  const health = readHealth(store);
  if (health && health.preExecuteSubscribed === false) {
    return {
      ok: false,
      code: 'policy-not-enforced',
      message: 'structurePolicy=fail, но подписка tools/pre-execute не удалась'
        + (health.error ? ' (' + health.error + ')' : '') + ': обход структуры не блокируется',
      health,
    };
  }
  return { ok: true, code: null, message: '', health };
}

/**
 * Объявление модели узла в структуре проекта: <root>/structure/*.json,
 * фрагменты графа. Нет каталога/узла/модели — пустое объявление, и тогда
 * modelVerdict возвращает 'unknown' (легаси-проекты без модели узла).
 *
 * @param {string} root корень проекта
 * @param {string} nodeId узел
 * @returns {{model: string|null, source: string|null}}
 */
export function acceptorModelDeclaration(root, nodeId) {
  const dir = path.join(path.resolve(String(root)), 'structure');
  let entries = [];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true }).filter((item) => item.isFile() && /\.json$/u.test(item.name));
  } catch {
    return { model: null, source: null };
  }
  for (const entry of entries) {
    const file = path.join(dir, entry.name);
    let parsed;
    try {
      parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch {
      continue;
    }
    const nodes = Array.isArray(parsed && parsed.nodes) ? parsed.nodes : [];
    const node = nodes.find((item) => item && item.id === nodeId);
    if (node && typeof node.model === 'string' && node.model.trim() !== '') {
      return { model: node.model.trim(), source: file };
    }
  }
  return { model: null, source: null };
}
