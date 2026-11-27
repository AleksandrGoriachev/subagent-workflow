/*
 * Замок: снимок контракта, хеши, проверка, записи приёмки, дайджест дерева.
 *
 * 0181: часть spec/scripts/lib/common.mjs; публичный вход — common.mjs.
 */
import path from 'node:path';
import { TOOL } from './engine-version.mjs';
import { fail } from './cli.mjs';
import { fromPosix, relPosix, exists, readJson, canonicalize, sha256, sha256File } from './fsio.mjs';
import { git } from './git-base.mjs';
import { checkContractCommitted } from './contract-git.mjs';
import { matchesAny, listRepoFiles, protectedManifest } from './glob.mjs';
import { headDrift } from './git-status.mjs';
import { extractCriteriaBlock, taskFiles } from './task-contract.mjs';
import { truncate } from './secrets.mjs';
export function stableJsonValue(value) {
  if (Array.isArray(value)) return '[' + value.map(stableJsonValue).join(',') + ']';
  if (value && typeof value === 'object') {
    return '{' + Object.keys(value)
      .sort()
      .map((key) => JSON.stringify(key) + ':' + stableJsonValue(value[key]))
      .join(',') + '}';
  }
  return JSON.stringify(value === undefined ? null : value);
}

export function sortedStrings(value) {
  if (!Array.isArray(value)) return null;
  return value.map((item) => String(item)).sort();
}

export function normalizeContractSnapshot(snapshot) {
  const raw = snapshot && typeof snapshot === 'object' && !Array.isArray(snapshot) ? snapshot : {};
  const list = Array.isArray(raw.criteria) ? raw.criteria : [];
  return {
    allowedPaths: sortedStrings(raw.allowedPaths) || [],
    protectedPaths: sortedStrings(raw.protectedPaths) || [],
    redAllowDirty: sortedStrings(raw.redAllowDirty) || [],
    criteria: list
      .filter((criterion) => criterion && typeof criterion === 'object' && !Array.isArray(criterion))
      .map((criterion) => ({
        id: criterion.id === undefined || criterion.id === null ? null : String(criterion.id),
        command: criterion.command === undefined ? null : criterion.command,
        cwd: criterion.cwd === undefined ? null : criterion.cwd,
        timeoutMs: criterion.timeoutMs === undefined ? null : criterion.timeoutMs,
        expect: criterion.expect === undefined ? null : criterion.expect,
        covers: sortedStrings(criterion.covers),
        tags: sortedStrings(criterion.tags),
      })),
  };
}

export function relockAllowed(prev, next) {
  const before = normalizeContractSnapshot(prev);
  const after = normalizeContractSnapshot(next);
  const changed = [];
  const violations = [];
  for (const key of ['allowedPaths', 'protectedPaths', 'redAllowDirty']) {
    if (stableJsonValue(before[key]) !== stableJsonValue(after[key])) changed.push(key);
  }
  const left = before.criteria;
  const right = after.criteria;
  const leftIds = left.map((criterion) => criterion.id);
  const rightIds = right.map((criterion) => criterion.id);
  const sameSet = left.length === right.length
    && stableJsonValue(leftIds.slice().sort()) === stableJsonValue(rightIds.slice().sort());
  if (left.length !== right.length) {
    violations.push('число критериев меняется: было ' + left.length + ', стало ' + right.length);
  } else if (!sameSet) {
    violations.push('набор критериев меняется: ' + (leftIds.join(', ') || '—') + ' → ' + (rightIds.join(', ') || '—'));
  } else if (stableJsonValue(leftIds) !== stableJsonValue(rightIds)) {
    violations.push('порядок критериев меняется: ' + leftIds.join(', ') + ' → ' + rightIds.join(', '));
  }
  if (sameSet) {
    const rightById = new Map(right.map((criterion) => [criterion.id, criterion]));
    for (const criterion of left) {
      const nextCriterion = rightById.get(criterion.id);
      if (!nextCriterion) continue;
      const label = 'критерий ' + (criterion.id === null ? '?' : criterion.id) + ': ';
      if (stableJsonValue(criterion.command) !== stableJsonValue(nextCriterion.command)) violations.push(label + 'меняется команда');
      if (stableJsonValue(criterion.cwd) !== stableJsonValue(nextCriterion.cwd)) violations.push(label + 'меняется cwd');
      if (stableJsonValue(criterion.timeoutMs) !== stableJsonValue(nextCriterion.timeoutMs)) violations.push(label + 'меняется timeoutMs');
      if (stableJsonValue(criterion.expect) !== stableJsonValue(nextCriterion.expect)) violations.push(label + 'меняется ожидание (expect)');
      if (stableJsonValue(criterion.covers) !== stableJsonValue(nextCriterion.covers)) changed.push(label + 'покрытие covers');
      if (stableJsonValue(criterion.tags) !== stableJsonValue(nextCriterion.tags)) changed.push(label + 'теги tags');
    }
  }
  if (violations.length > 0) {
    return {
      ok: false,
      reason: 're-lock отклонён: ' + violations.join('; ')
        + ' — это новый номер задания, а не re-lock (re-lock правит только allowedPaths/protectedPaths/redAllowDirty и covers/tags)',
      changed: [...changed, ...violations],
    };
  }
  return { ok: true, changed };
}

/**
 * Нормализованный снимок контракта для criteria.lock: ровно те поля, которые
 * re-lock обязан сравнивать (и covers/tags — чтобы отчёт назвал разрешённую
 * правку). Заголовок, effect и прочие поля критерия в снимок не входят: их
 * правка не меняет ни команды, ни ожидания.
 */
export function contractSnapshot(meta, criteriaList) {
  const source = meta && typeof meta === 'object' ? meta : {};
  const list = Array.isArray(criteriaList)
    ? criteriaList
    : (criteriaList && Array.isArray(criteriaList.criteria) ? criteriaList.criteria : []);
  const patterns = (value) => (Array.isArray(value) ? value.map((item) => String(item)) : []);
  return {
    allowedPaths: patterns(source.allowedPaths),
    protectedPaths: patterns(source.protectedPaths),
    redAllowDirty: patterns(source.redAllowDirty),
    criteria: list.map((criterion) => {
      const item = criterion && typeof criterion === 'object' && !Array.isArray(criterion) ? criterion : {};
      const snapshot = {
        id: item.id === undefined || item.id === null ? null : String(item.id),
        command: item.command === undefined ? null : item.command,
        cwd: item.cwd === undefined ? null : item.cwd,
        timeoutMs: item.timeoutMs === undefined ? null : item.timeoutMs,
        expect: item.expect === undefined ? null : item.expect,
      };
      if (Array.isArray(item.covers)) snapshot.covers = sortedStrings(item.covers);
      if (Array.isArray(item.tags)) snapshot.tags = sortedStrings(item.tags);
      return snapshot;
    }),
  };
}

export function hashProtectedFiles(repo, patterns, exclude = [], options = {}) {
  if (!patterns || patterns.length === 0) return [];
  const files = listRepoFiles(repo, { includeUntracked: true, exclude });
  const manifest = protectedManifest(files.filter((f) => matchesAny(f, patterns)), options);
  return manifest.map((f) => {
    const abs = path.join(repo, fromPosix(f));
    return { path: f, sha256: exists(abs) ? sha256File(abs) : null };
  });
}

export function computeLock(repo, taskDir, meta, taskMd, criteria, contractCommit = null) {
  const block = extractCriteriaBlock(taskMd);
  const taskRel = relPosix(repo, taskDir);
  const attackFile = path.join(taskDir, 'attack.json');
  const attackSha256 = exists(attackFile) ? sha256File(attackFile) : null;
  const exclude = [
    '.git/**', 'node_modules/**',
    taskRel + '/**',
    ...(Array.isArray(meta.hashExclude) ? meta.hashExclude : []),
  ];
  const protectedFiles = hashProtectedFiles(repo, meta.protectedPaths || [], exclude, {
    locksEngine: meta.locksEngine === true,
  });
  return {
    version: 3,
    task: String(meta.id),
    taskFileSha256: sha256(canonicalize(taskMd)),
    criteriaSha256: sha256(canonicalize(block)),
    criteriaJsonSha256: sha256(canonicalize(criteria.raw)),
    attackSha256,
    contractCommit: contractCommit || null,
    protected: protectedFiles,
    contract: contractSnapshot(meta, criteria.criteria),
    createdAt: new Date().toISOString(),
    tool: TOOL,
  };
}

/**
 * Запись приёмки считается состоявшейся, только если это валидный JSON с
 * status === 'accepted'. Факт наличия файла основанием не является: пустой или
 * битый acceptance.json не должен снимать ни одну проверку (2.4.9).
 *
 * Принадлежность (2.6.7): запись принадлежит заданию. Если передан expectedTask,
 * record.task обязан совпасть с ним строкой; запись без task или с task другого
 * задания основанием не является. Иначе копия acceptance.json от соседнего
 * задания снимала contractCommit в verifyLock и переводила ERROR lint в WARN —
 * задание выглядело принятым, не будучи проверенным. Вызов без expectedTask
 * сохраняет прежнее поведение: старые потребители не ломаются, но все
 * внутренние вызовы передают id задания.
 *
 * Один предикат на двух потребителей (2.6.2): verifyLock ослабляет
 * contractCommit, а task-lint переводит диагностику принятого задания в WARN.
 * Копия правила в lint разошлась бы с воротами молча — ровно так ослабление
 * 2.4.8 и стало дырой.
 */
export function hasAcceptedRecord(file, expectedTask) {
  if (!exists(file)) return false;
  let record;
  try { record = readJson(file); } catch { return false; }
  if (!record || typeof record !== 'object' || Array.isArray(record)) return false;
  if (record.status !== 'accepted') return false;
  if (expectedTask !== undefined && expectedTask !== null) {
    if (typeof record.task !== 'string' || record.task !== String(expectedTask)) return false;
  }
  return true;
}

/*
 * 0130 (2.6.107): «зависло» — отдельный вердикт, а не отказ проверки. Приёмка 0127
 * зависла в selftest на 13 минут (ребёнок task-check-acceptance без прогресса), и
 * снаружи это выглядело пустым логом. Функция даёт общий текст для throw/report.
 */
export function hungMessage(result, label, timeoutMs) {
  if (!result) return null;
  const status = result.status === undefined ? null : result.status;
  if (status !== null) return null;
  const signal = typeof result.signal === 'string' && result.signal !== '' ? result.signal : null;
  const error = result.error && result.error.message ? String(result.error.message) : '';
  const seconds = Math.round(Number(timeoutMs || 0) / 1000);
  return '«' + label + '» не ответил за ' + seconds + ' с (signal=' + (signal || 'нет')
    + (error ? ', error=' + error.slice(0, 120) : '') + ') — это зависание, а не отказ проверки';
}

/*
 * 0124 (2.6.105): повторная приёмка того же контракта — не штатный цикл.
 * Замер structure: 16 лишних прогонов review/accept. Повтор разрешён только с
 * явной причиной (--rework, попадает в notes записи) или --force; смена контракта —
 * обычная работа, а не переделка.
 */
export function acceptanceRepeatGuard(previous, contractCommit, options = {}) {
  const rework = typeof options.rework === 'string' ? options.rework.trim() : '';
  const force = options.force === true;
  if (!previous || typeof previous !== 'object' || Array.isArray(previous)) return { action: 'allow', rework };
  if (previous.status !== 'accepted') return { action: 'allow', rework };
  const same = String(previous.contractCommit || '') === String(contractCommit || '');
  if (!same) return { action: 'allow', rework };
  if (rework !== '') return { action: 'rework', rework };
  if (force) return { action: 'force', rework: '' };
  return { action: 'refuse', rework: '' };
}

/** Пометки записи приёмки: причина обхода и причина переделки — в одном поле. */
export function acceptanceNotes(note, rework) {
  const parts = [];
  if (typeof note === 'string' && note.trim() !== '') parts.push(note.trim());
  if (typeof rework === 'string' && rework.trim() !== '') parts.push('rework: ' + rework.trim());
  return parts.join('; ');
}

export function verifyLock(repo, taskDir, meta, taskMd, criteria, options = {}) {
  const files = taskFiles(taskDir);
  /*
   * 0167: лёгкой задаче замок не нужен: фиксировать criteria.json нечего, проверки
   * заморожены контрактным коммитом. Ожидание всё равно вычисляется (criteria
   * синтетические, criteriaJsonSha256 — от синтеза), чтобы verify/приёмка видели
   * те же поля, что и у обычной задачи.
   */
  if (meta && typeof meta === 'object' && String(meta.mode || '') === 'light') {
    /* 0170: локальный режим (vcs=none) не требует git: база — хеши task.md и checks. */
    if (String(meta.vcs || '') === 'none') {
      const localExpected = {
        version: 3,
        task: String(meta.id),
        taskFileSha256: sha256(canonicalize(taskMd)),
        criteriaSha256: sha256(canonicalize(extractCriteriaBlock(taskMd))),
        criteriaJsonSha256: sha256(canonicalize(criteria.raw)),
        attackSha256: null,
        contractCommit: null,
        local: true,
        createdAt: new Date().toISOString(),
        tool: TOOL,
      };
      return { ok: true, errors: [], notes: ['локальный режим (vcs=none): git не используется, база — хеши контракта'], expected: localExpected, actual: null, light: true, local: true };
    }
    const lightContract = checkContractCommitted(repo, taskDir, meta);
    if (!lightContract.ok) {
      return { ok: false, errors: ['контракт не зафиксирован в git: ' + lightContract.errors.join('; ')], expected: null, actual: null, light: true };
    }
    const lightExpected = computeLock(repo, taskDir, meta, taskMd, criteria, lightContract.contractCommit);
    return { ok: true, errors: [], notes: ['лёгкая задача (mode=light): criteria.lock не требуется'], expected: lightExpected, actual: null, light: true };
  }
  if (!exists(files.lock)) return { ok: false, errors: ['criteria.lock отсутствует — выполните task-hash --write'], expected: null, actual: null };
  let lock;
  try { lock = readJson(files.lock); } catch (err) { return { ok: false, errors: [err.message], expected: null, actual: null }; }
  const contract = checkContractCommitted(repo, taskDir, meta);
  const actual = computeLock(repo, taskDir, meta, taskMd, criteria, contract.contractCommit);
  const errors = [];
  const notes = [];
  if (lock.version !== 3) errors.push('criteria.lock: версия ' + lock.version + ' устарела, нужна 3 — выполните task-hash --write');
  /*
   * `contractCommit` — это HEAD в момент, когда контракт заперт. Равенство с
   * текущим HEAD обязательно до приёмки, и стоит оно вот на чём: task-red пишет в
   * red.json базу, которую task-verify сверяет с contractCommit (red.baseSha ===
   * lock.contractCommit), task-verify берёт contractCommit как базу diff для
   * проверки границ («изменения вне разрешённых путей»), а task-accept сравнивает
   * verify.headSha с lock.contractCommit — текущий HEAD он не читает, поэтому
   * сдвиг HEAD после verify видит именно verifyLock, сравнивая замок с actual.
   *
   * У принятого задания HEAD уходит всегда — metadata-коммит приёмки, потом
   * обычная работа, — и требовать равенства вечно значит держать каждое закрытое
   * задание в ошибке. Это видели на 0001 здесь и на 0103 в ws-school-app:
   * «ожидалось ecc9f41…, сейчас 72c490e…» при полностью корректной записи.
   *
   * Послабление (2.4.8, ужесточено в 2.4.9) узкое с двух сторон:
   * 1) только при options.acceptedTolerant === true — его передаёт один task-lint;
   *    task-verify, task-accept, task-red и task-hash работают строго;
   * 2) только при валидной записи приёмки: файл есть, разбирается как JSON,
   *    record.status === 'accepted'. Пустой/битый файл или чужой статус — не
   *    основание: иначе пустой acceptance.json снимал бы инвариант «HEAD не
   *    двигался после verify» одним касанием (находка ревью 2.4.9).
   */
  const accepted = options.acceptedTolerant === true && hasAcceptedRecord(files.acceptance, meta.id);
  /* 0110 (2.6.98): сдвиг HEAD чужими коммитами допустим, если не задел пути задания. */
  const drift = lock.contractCommit !== actual.contractCommit
    ? headDrift(repo, lock.contractCommit, meta, taskDir)
    : { drift: false, ok: true, from: lock.contractCommit, to: actual.contractCommit, foreignCommits: 0, paths: [] };
  for (const key of ['task', 'taskFileSha256', 'criteriaSha256', 'criteriaJsonSha256', 'attackSha256', 'contractCommit']) {
    if (lock[key] === actual[key]) continue;
    if (key === 'contractCommit' && accepted) {
      notes.push('contractCommit: замок на ' + lock[key] + ', HEAD сейчас ' + actual[key] + ' — задание уже принято, сдвиг HEAD ожидаем (metadata-коммит и последующая работа)');
      continue;
    }
    if (key === 'contractCommit' && drift.ok) {
      notes.push('headDrift: контракт на ' + String(lock[key]).slice(0, 12) + ', HEAD ' + String(actual[key]).slice(0, 12)
        + '; чужих коммитов ' + drift.foreignCommits + ', пути вне задания: ' + (drift.paths.join(', ') || 'нет'));
      continue;
    }
    errors.push(key + ': ожидалось ' + lock[key] + ', сейчас ' + actual[key] + (key === 'contractCommit' && drift.errors ? '; ' + drift.errors.join('; ') : ''));
  }
  const lockMap = new Map((lock.protected || []).map((x) => [x.path, x.sha256]));
  const actualMap = new Map(actual.protected.map((x) => [x.path, x.sha256]));
  for (const [p, h] of actualMap) {
    if (!lockMap.has(p)) errors.push('защищённый файл появился: ' + p);
    else if (lockMap.get(p) !== h) errors.push('защищённый файл изменён: ' + p);
  }
  for (const p of lockMap.keys()) if (!actualMap.has(p)) errors.push('защищённый файл исчез: ' + p);
  for (const error of contract.errors) errors.push('контракт: ' + error);
  return { ok: errors.length === 0, errors, notes, expected: lock, actual, drift };
}

/*
 * 0060 (WC-40): подсказка порядка коммитов в точке отказа.
 *
 * Сторонний агент после task-red закоммитил criteria.lock: HEAD ушёл, следующий
 * прогон упал с «lock: contractCommit: ожидалось X, сейчас Y». Правило живёт в
 * SPEC (§«Порядок коммитов») и в шаблоне задания, но не в точке отказа, поэтому
 * из сообщения не видно, что делать. Функция чистая: решает по lockCheck.errors
 * и возвращает текст подсказки или null, печатает вызывающий. Сдвиг — только
 * ошибка contractCommit: остальные расхождения замка (версия, хеши, защищённые
 * файлы) к порядку коммитов отношения не имеют.
 *
 * 0064 (WC-47): текст один на все случаи, и сторонний оркестратор, собиравшийся
 * закоммитить КОД перед приёмкой, получал диагноз про артефакты — неверный. У нас
 * код не коммитит никто: кандидата создаёт task-accept, ветку двигает архитектор
 * после metadata. Поэтому подсказка называет три причины сдвига HEAD (артефакт
 * задания, код исполнителя, metadata приёмки), правило для каждой и, если
 * вызывающий передал список, сами изменённые пути. Решение «это сдвиг»
 * по-прежнему только по ошибке contractCommit: — функция остаётся чистой и
 * ничего не запускает; diff считают task-red и task-verify.
 */
export function shiftPathKind(file) {
  const p = String(file).replaceAll(String.fromCharCode(92), '/');
  const base = p.split('/').pop();
  if (base === 'acceptance.json') return 'metadata приёмки — ожидаемый сдвиг';
  if (p.startsWith('docs/tasks/')) return 'артефакт задания — коммитить нельзя';
  return 'код исполнителя — коммитить нельзя, кандидата создаёт task-accept';
}

export function lockOrderHint(lockCheck, changedPaths) {
  const errors = lockCheck && Array.isArray(lockCheck.errors) ? lockCheck.errors : [];
  const shifted = errors.some((error) => String(error).indexOf('contractCommit:') === 0);
  if (!shifted) return null;
  const NL = String.fromCharCode(10);
  const paths = Array.isArray(changedPaths)
    ? changedPaths.map((p) => String(p)).filter((p) => p.trim() !== '')
    : [];
  const lines = [
    'Подсказка: HEAD сдвинулся после замка — кандидат отвязан от contractCommit. Причина — один из трёх видов коммита:',
    '  1) артефакт задания (criteria.lock, red.json, gates.jsonl) — артефакты не коммитятся до приёмки: они не кандидат.',
    '  2) код исполнителя — код не коммитится: кандидата создаёт task-accept, ветку двигает архитектор после metadata приёмки.',
    '  3) metadata приёмки (acceptance.json) — у принятого задания сдвиг HEAD ожидаем.',
    'Порядок коммитов: контракт → task-hash --write → task-red → работа → task-verify → task-accept.',
    'Кандидат — коммит, на котором task-red доказал красный; его SHA обязан совпадать с contractCommit в criteria.lock.',
  ];
  if (Array.isArray(changedPaths)) {
    lines.push('Изменённые пути (git diff --name-only <contractCommit> HEAD):');
    if (paths.length === 0) lines.push('  (нет)');
    for (const p of paths) lines.push('  ' + p + ' — ' + shiftPathKind(p));
  }
  return lines.join(NL);
}

/**
 * 0060 (WC-41): причина фатального отказа — одной строкой в stdout с префиксом
 * '<gate>: ', подробности остаются в stderr. Под обёрткой pwsh «пустой stdout +
 * exit 1» выглядел молчаливым отказом: у первого task-red не было ни строки
 * stdout. options.stderr === false не дублирует подробности, которые вызывающий
 * уже напечатал сам; options.json === true оставляет stdout машинным — причина
 * уходит объектом { ok: false, errors }, как в catch ворот.
 */

export function assertInsideRepo(repo, p, label) {
  const abs = path.resolve(repo, p);
  const rel = path.relative(repo, abs);
  if (rel.startsWith('..') || path.isAbsolute(rel)) fail(label + ' выходит за пределы репозитория: ' + p);
  return abs;
}

export function stableResults(results) {
  return results.map((r) => ({
    id: r.id,
    command: r.command,
    exitCode: r.exitCode,
    durationMs: r.durationMs,
    passed: r.passed,
    timedOut: r.timedOut,
    /* 0057 (WC-35): дефект проверки — часть артефакта, а не вывод, который теряется. */
    checkDefect: r.checkDefect === undefined ? null : r.checkDefect,
    reasons: r.reasons,
    stdoutSha256: sha256(r.stdout),
    stderrSha256: sha256(r.stderr),
    stdoutPreview: truncate(r.stdout, 4000),
    stderrPreview: truncate(r.stderr, 4000),
  }));
}

export function computeWorktreeDigest(repo, taskDir, meta) {
  const taskRel = relPosix(repo, taskDir);
  const exclude = [
    '.git/**', 'node_modules/**', taskRel + '/**',
    'dist/**', 'build/**', 'coverage/**', '.next/**', 'target/**',
    ...(Array.isArray(meta.hashExclude) ? meta.hashExclude : []),
  ];
  const files = listRepoFiles(repo, { includeUntracked: true, exclude });
  const input = files.map((f) => f + String.fromCharCode(0) + sha256File(path.join(repo, fromPosix(f)))).join(String.fromCharCode(10));
  return sha256(input);
}


/*
 * Виды источника актора (2.6.0). Вид — это не украшение записи, а граница
 * доверия: harness и runner дают идентификатор сессии из окружения (attestedBy:
 * env → уровень separate-session), ci и manual — заявление (declared, не выше
 * declared). DSH — один из видов, а не единственный: пакет не требует харнесса.
 */
