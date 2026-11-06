import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';

export const TOOL = 'subagent-workflow/2.6.40';
export const TASK_ARTIFACTS = new Set([
  'task.md', 'criteria.json', 'criteria.lock', 'red.json', 'red.log',
  'verify.json', 'verify.executor.json', 'verify.log', 'acceptance.json', 'report.md', 'report.json',
]);

export function fail(message, exitCode = 1) {
  const err = new Error(message);
  err.exitCode = exitCode;
  throw err;
}

export function parseArgv(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--') { out._.push(...argv.slice(i + 1)); break; }
    if (a.startsWith('--')) {
      const eq = a.indexOf('=');
      if (eq !== -1) out[a.slice(2, eq)] = a.slice(eq + 1);
      else {
        const next = argv[i + 1];
        if (next !== undefined && !next.startsWith('--')) { out[a.slice(2)] = next; i += 1; }
        else out[a.slice(2)] = true;
      }
    } else out._.push(a);
  }
  return out;
}

export function toPosix(p) { return String(p).replace(/\\/g, '/'); }
export function fromPosix(p) { return String(p).split('/').join(path.sep); }
export function relPosix(from, to) { return toPosix(path.relative(from, to)); }
export function resolvePath(p, base = process.cwd()) { return path.resolve(base, p); }

export function exists(p) { try { fs.accessSync(p); return true; } catch { return false; } }
export function readText(file) {
  const text = fs.readFileSync(file, 'utf8');
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}
export function readJson(file) {
  try { return JSON.parse(readText(file)); }
  catch (err) { fail('Не читается JSON ' + file + ': ' + err.message); }
}
export function writeText(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text, 'utf8');
}
export function writeJson(file, value) { writeText(file, JSON.stringify(value, null, 2) + '\n'); }

export function canonicalize(text) {
  return String(text)
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.replace(/[ \t]+$/g, ''))
    .join('\n')
    .replace(/^\n+/, '')
    .replace(/\n+$/, '') + '\n';
}
export function sha256(text) { return crypto.createHash('sha256').update(String(text), 'utf8').digest('hex'); }
export function sha256File(file) { return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'); }

export function quoteArg(arg) {
  const s = String(arg);
  return /^[A-Za-z0-9_./:@%+=,\-]+$/.test(s) ? s : '"' + s.replace(/"/g, '\\"') + '"';
}

export function runSync(command, opts = {}) {
  const started = Date.now();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-cmd-'));
  const outFile = path.join(dir, 'stdout');
  const errFile = path.join(dir, 'stderr');
  let ofd;
  let efd;
  let res;
  try {
    ofd = fs.openSync(outFile, 'w');
    efd = fs.openSync(errFile, 'w');
    const childEnv = { ...process.env, ...(opts.env || {}) };
    for (const key of opts.unsetEnv || []) delete childEnv[key];
    res = spawnSync(command, {
      shell: true,
      cwd: opts.cwd || process.cwd(),
      timeout: opts.timeoutMs || 120000,
      env: childEnv,
      windowsHide: true,
      stdio: ['ignore', ofd, efd],
    });
  } finally {
    if (ofd !== undefined) { try { fs.closeSync(ofd); } catch { /* ignore */ } }
    if (efd !== undefined) { try { fs.closeSync(efd); } catch { /* ignore */ } }
  }
  let stdout = '';
  let stderr = '';
  try { stdout = fs.readFileSync(outFile, 'utf8'); } catch { /* ignore */ }
  try { stderr = fs.readFileSync(errFile, 'utf8'); } catch { /* ignore */ }
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
  return {
    exitCode: res && res.status !== null ? res.status : (res && res.error ? 127 : (res && res.signal ? 124 : 0)),
    stdout,
    stderr,
    signal: res ? res.signal || null : null,
    timedOut: Boolean(res && res.error && (res.error.code === 'ETIMEDOUT' || res.error.killed)),
    durationMs: Date.now() - started,
    error: res ? res.error || null : null,
  };
}

/*
 * Синхронный запуск без пайпов (0059, WC-37). В ограниченной песочнице DSH
 * процесс не может открыть именованный канал: spawnSync с stdio 'pipe' (в том
 * числе по умолчанию) падает с EPERM. Здесь вывод ребёнка идёт в два временных
 * файла, которые отдаются в stdio ['ignore', ofd, efd], после завершения
 * читаются и удаляются.
 *
 * Результат совместим со spawnSync: { status, stdout, stderr, signal, error }.
 * Поддержаны cwd, env, timeout, windowsHide и encoding: 'utf8' даёт строки,
 * 'buffer' или отсутствие encoding — Buffer, как у spawnSync по умолчанию.
 * Отсутствующий бинарник не бросает: status: null и заполненный error.
 */
export function spawnSyncPipeFree(command, args, options = {}) {
  const opts = options && typeof options === 'object' ? options : {};
  const list = Array.isArray(args) ? args : [];
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-spawn-'));
  const outFile = path.join(dir, 'stdout');
  const errFile = path.join(dir, 'stderr');
  let ofd;
  let efd;
  let res = null;
  let launchError = null;
  try {
    ofd = fs.openSync(outFile, 'w');
    efd = fs.openSync(errFile, 'w');
    res = spawnSync(command, list, {
      cwd: opts.cwd || process.cwd(),
      env: opts.env && typeof opts.env === 'object' ? opts.env : process.env,
      timeout: opts.timeout,
      windowsHide: opts.windowsHide === true,
      stdio: ['ignore', ofd, efd],
    });
  } catch (error) {
    launchError = error;
  } finally {
    if (ofd !== undefined) { try { fs.closeSync(ofd); } catch { /* ignore */ } }
    if (efd !== undefined) { try { fs.closeSync(efd); } catch { /* ignore */ } }
  }
  const asText = opts.encoding === 'utf8';
  const read = (file) => {
    try {
      const data = fs.readFileSync(file);
      return asText ? data.toString('utf8') : data;
    } catch {
      return asText ? '' : Buffer.alloc(0);
    }
  };
  const stdout = read(outFile);
  const stderr = read(errFile);
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
  return {
    status: res && res.status !== undefined ? res.status : null,
    stdout,
    stderr,
    signal: res ? res.signal || null : null,
    error: launchError || (res ? res.error || null : null),
  };
}

export function git(repo, args, opts = {}) {
  const cmd = 'git ' + args.map(quoteArg).join(' ');
  return runSync(cmd, { ...opts, cwd: repo });
}

export function headCommit(repo) {
  const r = git(repo, ['rev-parse', '--verify', 'HEAD']);
  return r.exitCode === 0 ? r.stdout.trim() : null;
}

export function filesAtCommit(repo, rev) {
  const r = git(repo, ['ls-tree', '-r', '--name-only', '-z', rev]);
  if (r.exitCode !== 0) return null;
  return r.stdout.split('\0').filter(Boolean).map(toPosix).sort();
}

/**
 * Контракт задания — task.md, criteria.json и защищённые файлы — обязан быть закоммичен
 * до красного прогона. Иначе исполнитель может переписать проверки и перезамкнуть их
 * (README, раздел «Замок»).
 */
export function checkContractCommitted(repo, taskDir, meta) {
  const head = headCommit(repo);
  if (!head) {
    return { ok: false, errors: ['в репозитории нет HEAD: контракт задания не закоммичен'], files: [], contractCommit: null };
  }
  const taskRel = relPosix(repo, taskDir);
  const headFiles = filesAtCommit(repo, head) || [];
  const workFiles = listRepoFiles(repo, { includeUntracked: true });
  const protectedPatterns = Array.isArray(meta.protectedPaths) ? meta.protectedPaths : [];
  const isArtifact = (file) => file.startsWith(taskRel + '/') && TASK_ARTIFACTS.has(file.split('/').pop());
  const files = new Set([taskRel + '/task.md', taskRel + '/criteria.json']);
  /*
   * Тот же манифест, что попадёт в criteria.lock (2.6.18): движок
   * (docs/subagent-workflow/**) контрактом задания не считается, если задание не
   * объявило locksEngine. Иначе деплой пакета в чужом окне даёт «файл контракта
   * изменён после коммита» — ровно та красная чужая правка, из-за которой re-lock
   * и появился.
   */
  const protectedManifestFiles = protectedManifest(
    [...workFiles, ...headFiles].filter((file) => !isArtifact(file) && matchesAny(file, protectedPatterns)),
    { locksEngine: meta.locksEngine === true },
  );
  for (const file of protectedManifestFiles) files.add(file);
  const errors = [];
  const present = [];
  for (const file of [...files].sort()) {
    if (!headFiles.includes(file)) { errors.push('файл контракта не закоммичен: ' + file); continue; }
    if (!workFiles.includes(file)) { errors.push('файл контракта удалён из рабочего дерева: ' + file); continue; }
    present.push(file);
  }
  /*
   * Один git diff на пачку, а не на файл: у задачи может быть сотня защищённых
   * тестов, а запуск git на Windows стоит ~150 мс.
   */
  const changed = new Set();
  for (let i = 0; i < present.length; i += 100) {
    const chunk = present.slice(i, i + 100);
    const diff = git(repo, ['diff', '--name-only', '-z', 'HEAD', '--', ...chunk]);
    if (diff.exitCode !== 0) {
      for (const file of chunk) errors.push('файл контракта изменён после коммита: ' + file);
      continue;
    }
    for (const file of diff.stdout.split('\0')) if (file) changed.add(toPosix(file));
  }
  for (const file of present) if (changed.has(file)) errors.push('файл контракта изменён после коммита: ' + file);
  return { ok: errors.length === 0, errors, files: [...files].sort(), contractCommit: head };
}

export function sameLockContract(a, b) {
  if (!a || !b) return false;
  const shape = (lock) => JSON.stringify({
    task: lock.task,
    taskFileSha256: lock.taskFileSha256,
    criteriaSha256: lock.criteriaSha256,
    criteriaJsonSha256: lock.criteriaJsonSha256,
    contractCommit: lock.contractCommit || null,
    protected: (lock.protected || []).map((x) => [x.path, x.sha256]).sort(),
  });
  return shape(a) === shape(b);
}

export function findRepoRoot(start) {
  let dir = path.resolve(start);
  for (;;) {
    if (exists(path.join(dir, '.git'))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

export function repoRoot(start) {
  const root = findRepoRoot(start);
  if (root) return root;
  const res = git(start, ['rev-parse', '--show-toplevel']);
  return res.exitCode === 0 ? res.stdout.trim() : path.resolve(start);
}

export function parseTaskMeta(taskMd) {
  const m = taskMd.match(/<!--\s*TASK-META\s*([\s\S]*?)-->/);
  if (!m) fail('В task.md нет блока <!-- TASK-META ... -->');
  let meta;
  try { meta = JSON.parse(m[1].trim()); }
  catch (err) { fail('TASK-META не является JSON: ' + err.message); }
  /*
   * 0068 (WC-43): узлы ролей — часть контракта, а не украшение. JSON.parse их и
   * так сохраняет, но нормализуем значения здесь: строка из одних пробелов не
   * должна выглядеть как указанный узел. Задача без узлов остаётся без них.
   */
  if (meta && typeof meta === 'object' && !Array.isArray(meta)) {
    for (const key of ['executorNode', 'acceptorNode']) {
      if (typeof meta[key] === 'string') meta[key] = meta[key].trim();
    }
  }
  return meta;
}

/*
 * 0068 (WC-43): привязка роли к узлу структуры.
 *
 * Приёмки 0063-0067 сделал нативный subagent вместо узла judge: подпись и
 * отдельная сессия были, а прогона в журнале структуры и Node: в письмах — нет.
 * Обход стал возможен потому, что движок не спрашивал про узел вовсе. Правило
 * должно отвечать машиной, а не дисциплиной.
 *
 * attributionGap(record) — вердикт по записи приёмки: null, если actor.node
 * указан; warn с причиной, если узла нет, но deviation объясняет отсутствие;
 * error для risk medium/high без узла и без объяснения; warn для low.
 */
export function attributionGap(record) {
  const source = record && typeof record === 'object' && !Array.isArray(record) ? record : {};
  const actor = source.actor && typeof source.actor === 'object' && !Array.isArray(source.actor) ? source.actor : {};
  const node = typeof actor.node === 'string' ? actor.node.trim() : '';
  if (node !== '') return null;
  const deviation = typeof source.deviation === 'string' ? source.deviation.trim() : '';
  if (deviation !== '') {
    return { level: 'warn', message: 'приёмка без actor.node объяснена отклонением: ' + deviation };
  }
  const risk = String(source.risk || '').toLowerCase();
  const hint = 'укажите узел (--node <узел> или WF_ACTOR_NODE) или объясните отсутствие (--deviation "<причина>")';
  if (risk === 'medium' || risk === 'high') {
    return { level: 'error', message: 'в записи нет actor.node, а risk=' + risk + ' требует узла: ' + hint };
  }
  return { level: 'warn', message: 'в записи нет actor.node: ' + hint };
}

/*
 * metaAttributionGap(meta) — то же для контракта: приёмщик-субагент без
 * acceptorNode должен быть назван либо узлом, либо deviation. Нативный subagent
 * допустим (политика структуры — warn), но отсутствие узла видно до работы.
 */
export function metaAttributionGap(meta) {
  const source = meta && typeof meta === 'object' && !Array.isArray(meta) ? meta : {};
  const node = typeof source.acceptorNode === 'string' ? source.acceptorNode.trim() : '';
  if (node !== '') return null;
  const deviation = typeof source.deviation === 'string' ? source.deviation.trim() : '';
  if (deviation !== '') return null;
  const acceptor = typeof source.acceptor === 'string' ? source.acceptor.trim() : '';
  if (!/^subagent/i.test(acceptor)) return null;
  return {
    level: 'warn',
    message: 'acceptor ' + acceptor + ' — нативный subagent без acceptorNode: укажите acceptorNode (узел) или deviation (причина)',
  };
}

/*
 * nodeConsistency(meta, record) — 0070: узел в записи — доказательство, а не
 * намерение контракта.
 *
 * acceptorNode в TASK-META объявляет, кто должен принимать, а не кто принимал.
 * Поэтому сверка идёт между объявлением и записью, а подставлять объявленный
 * узел в запись нельзя: при отказе узла judge запись 0069 утверждала приёмку
 * узлом, которого не было. Вердикты: совпадение — null; запись без узла, но с
 * deviation — null (отсутствие объяснено); запись без узла без объяснения —
 * warn с именем объявленного узла; другой узел в записи — warn о расхождении.
 */
export function nodeConsistency(meta, record) {
  const contract = meta && typeof meta === 'object' && !Array.isArray(meta) ? meta : {};
  const declared = typeof contract.acceptorNode === 'string' ? contract.acceptorNode.trim() : '';
  if (declared === '') return null;
  const source = record && typeof record === 'object' && !Array.isArray(record) ? record : {};
  const actor = source.actor && typeof source.actor === 'object' && !Array.isArray(source.actor) ? source.actor : {};
  const node = typeof actor.node === 'string' ? actor.node.trim() : '';
  const hint = 'укажите узел (--node <узел> или WF_ACTOR_NODE) или объясните отсутствие (--deviation "<причина>")';
  if (node === '') {
    const deviation = typeof source.deviation === 'string' ? source.deviation.trim() : '';
    if (deviation !== '') return null;
    return {
      level: 'warn',
      message: 'контракт объявляет acceptorNode "' + declared + '", а в записи узла нет: ' + hint,
    };
  }
  if (node === declared) return null;
  return {
    level: 'warn',
    message: 'acceptorNode контракта "' + declared + '" не совпадает с узлом записи "' + node
      + '": объясните расхождение (--deviation "<причина>") или принимайте под объявленным узлом',
  };
}

export function extractCriteriaBlock(taskMd) {
  const m = taskMd.match(/<!--\s*CRITERIA:BEGIN\s*-->([\s\S]*?)<!--\s*CRITERIA:END\s*-->/);
  if (!m) fail('В task.md нет блока <!-- CRITERIA:BEGIN --> ... <!-- CRITERIA:END -->');
  return m[1];
}

export function parseCriteria(taskDir) {
  const file = path.join(taskDir, 'criteria.json');
  if (!exists(file)) fail('Нет criteria.json в ' + taskDir);
  const raw = readText(file);
  const parsed = JSON.parse(raw);
  const criteria = Array.isArray(parsed) ? parsed : parsed.criteria;
  if (!Array.isArray(criteria) || criteria.length === 0) fail('criteria.json: пустой список criteria');
  return {
    raw,
    parsed,
    criteria,
    redExpect: parsed.redExpect,
    setup: Array.isArray(parsed.setup) ? parsed.setup : [],
    teardown: Array.isArray(parsed.teardown) ? parsed.teardown : [],
  };
}

export function taskFiles(taskDir) {
  return {
    taskMd: path.join(taskDir, 'task.md'),
    criteriaJson: path.join(taskDir, 'criteria.json'),
    lock: path.join(taskDir, 'criteria.lock'),
    red: path.join(taskDir, 'red.json'),
    redLog: path.join(taskDir, 'red.log'),
    verify: path.join(taskDir, 'verify.json'),
    verifyLog: path.join(taskDir, 'verify.log'),
    acceptance: path.join(taskDir, 'acceptance.json'),
    report: path.join(taskDir, 'report.md'),
  };
}

/*
 * Журнал вердиктов ворот (2.6.18, 0051): append-only docs/tasks/<id>/gates.jsonl.
 *
 * Замер structure (письмо --127): «сколько раз ворота отказали и сколько это
 * стоило — сейчас неизмеримо; цена переделок считается косвенно, по git log».
 * red.log/verify.log пишут только успешный прогон целиком, поэтому отказ и его
 * причина исчезают: JSON-артефакт пишется один раз и перезаписывается, а
 * журнал — дописывается. Одна строка на прогон ворот: время (+03:00, как в
 * остальных артефактах), вид ворот, задание, HEAD, критерии с exit/ms/причинами,
 * вердикт, обходы, сводка выхода.
 *
 * Запись не бросает: сбой журнала — WARN вызывающего, а не падение ворот
 * (инвариант 3 задания). Порядок строк — порядок прогонов, прежние строки не
 * переписываются (инвариант 2).
 */
export const GATE_JOURNAL = 'gates.jsonl';

export function gateJournalFile(taskDir) {
  return path.join(taskDir, GATE_JOURNAL);
}

/* Смещение журнала: +03:00, как в red.json/verify.json этого пакета. */
const GATE_OFFSET_MINUTES = 180;

function padGateTime(value, width = 2) {
  return String(value).padStart(width, '0');
}

function formatGateTime(date) {
  const shifted = new Date(date.getTime() + GATE_OFFSET_MINUTES * 60000);
  return shifted.getUTCFullYear() + '-' + padGateTime(shifted.getUTCMonth() + 1) + '-' + padGateTime(shifted.getUTCDate())
    + 'T' + padGateTime(shifted.getUTCHours()) + ':' + padGateTime(shifted.getUTCMinutes()) + ':' + padGateTime(shifted.getUTCSeconds())
    + '.' + padGateTime(shifted.getUTCMilliseconds(), 3) + '+03:00';
}

/**
 * Время записи журнала. Строка с явным смещением (Z или ±hh:mm) сохраняется
 * дословно: её мог передать вызывающий, и переписывать чужие часы не наше дело.
 * Всё остальное (Date, число, строка без смещения, мусор) приводится к ISO со
 * смещением +03:00; отсутствие времени — «сейчас».
 */
export function gateAt(value) {
  const text = typeof value === 'string' ? value.trim() : '';
  if (text !== '' && /(?:Z|[+-]\d{2}:\d{2})$/u.test(text) && !Number.isNaN(Date.parse(text))) return text;
  if (text !== '') {
    const parsed = Date.parse(text);
    return Number.isNaN(parsed) ? text : formatGateTime(new Date(parsed));
  }
  if (value instanceof Date && !Number.isNaN(value.getTime())) return formatGateTime(value);
  if (typeof value === 'number' && Number.isFinite(value)) return formatGateTime(new Date(value));
  return formatGateTime(new Date());
}

function gateNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/**
 * Один критерий в записи: id, exitCode, durationMs, passed и причины отказа.
 * Причины — то, что нельзя восстановить по git log; пустой список не пишется,
 * чтобы успешный критерий не выглядел как «причина была, но потерялась».
 */
function normalizeGateCriterion(criterion) {
  const source = criterion && typeof criterion === 'object' && !Array.isArray(criterion) ? criterion : {};
  const out = {
    id: source.id === undefined || source.id === null ? '' : String(source.id),
    exitCode: gateNumber(source.exitCode),
    durationMs: gateNumber(source.durationMs),
    passed: source.passed === true,
  };
  const reasons = Array.isArray(source.reasons)
    ? source.reasons.map((reason) => String(reason)).filter((reason) => reason !== '')
    : [];
  if (reasons.length > 0) out.reasons = reasons;
  return out;
}

/** Строки результатов ворот ({ id, exitCode, durationMs, passed, reasons }) → критерии записи. */
export function gateCriteriaOf(results) {
  return (Array.isArray(results) ? results : []).map((result) => normalizeGateCriterion(result));
}

/**
 * Нормализованная запись журнала вердиктов:
 * { at, kind, task, head, criteria, verdict, bypasses?, exitSummary? }.
 * Функция чистая: ничего не читает и не пишет, поэтому ею же пользуется проверка.
 */
export function gateRecord(record) {
  const source = record && typeof record === 'object' && !Array.isArray(record) ? record : {};
  const entry = {
    at: gateAt(source.at),
    kind: source.kind === undefined || source.kind === null ? '' : String(source.kind),
    task: source.task === undefined || source.task === null ? '' : String(source.task),
    head: source.head === undefined || source.head === null ? null : String(source.head),
    criteria: Array.isArray(source.criteria) ? source.criteria.map((item) => normalizeGateCriterion(item)) : [],
    verdict: source.verdict === undefined || source.verdict === null ? null : String(source.verdict),
  };
  if (source.bypasses && typeof source.bypasses === 'object' && !Array.isArray(source.bypasses)) entry.bypasses = source.bypasses;
  if (source.exitSummary !== undefined && source.exitSummary !== null) entry.exitSummary = source.exitSummary;
  return entry;
}

/**
 * Append-only запись одной строки JSONL. Каталог и файл создаются при первом
 * прогоне, прежние строки не читаются и не переписываются. Ошибка записи НЕ
 * бросает: возвращается { ok: false, error }, чтобы ворота напечатали WARN и
 * сохранили свой код возврата.
 */
export function appendGateRecord(file, record) {
  try {
    const target = path.resolve(String(file));
    const entry = gateRecord(record);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    /*
     * Файл, дописанный не нами и оборванный без перевода строки, склеил бы две
     * записи в одну. Добавляем только разделитель — содержимое не трогаем.
     */
    let prefix = '';
    if (exists(target)) {
      const size = fs.statSync(target).size;
      if (size > 0) {
        const fd = fs.openSync(target, 'r');
        try {
          const last = Buffer.alloc(1);
          fs.readSync(fd, last, 0, 1, size - 1);
          if (last[0] !== 0x0a) prefix = String.fromCharCode(10);
        } finally {
          fs.closeSync(fd);
        }
      }
    }
    const line = prefix + JSON.stringify(entry) + String.fromCharCode(10);
    fs.appendFileSync(target, line, 'utf8');
    return { ok: true, file: target, kind: entry.kind, at: entry.at, bytes: Buffer.byteLength(line, 'utf8') };
  } catch (error) {
    return { ok: false, error: error && error.message ? String(error.message) : String(error) };
  }
}

export function readTask(taskDir) {
  const files = taskFiles(taskDir);
  if (!exists(files.taskMd)) fail('Нет task.md в ' + taskDir);
  const taskMd = readText(files.taskMd);
  const meta = parseTaskMeta(taskMd);
  const criteria = parseCriteria(taskDir);
  return { files, taskMd, meta, criteria };
}

export function globToRegExp(pattern) {
  const p = toPosix(pattern);
  let re = '^';
  for (let i = 0; i < p.length; i += 1) {
    const c = p[i];
    if (c === '*') {
      if (p[i + 1] === '*') {
        i += 1;
        if (p[i + 1] === '/') { i += 1; re += '(?:.*/)?'; }
        else re += '.*';
      } else re += '[^/]*';
    } else if (c === '?') re += '[^/]';
    else if (c === '[') {
      const end = p.indexOf(']', i + 1);
      if (end === -1) re += '\\[';
      else { re += p.slice(i, end + 1); i = end; }
    } else re += c.replace(/[.+^\${}()|\\]/g, '\\$&');
  }
  re += '$';
  return new RegExp(re);
}

export function matchesAny(file, patterns) {
  const p = toPosix(file);
  return (patterns || []).some((pattern) => globToRegExp(pattern).test(p));
}

/*
 * Пересечение двух шаблонов путей (2.6.4, F-7): существует ли путь, который
 * попадает и под один, и под другой. Нужно lint, чтобы увидеть, что путь из
 * allowedPaths защищён protectedPaths: `src/**` и `src/app.js` пересекаются,
 * `src/**` и `checks/**` — нет.
 *
 * Отдельная функция, а не `globToRegExp(q).test(p)`: проверка одного шаблона
 * регуляркой другого не симметрична и пропускает ровно наш самый частый дефект
 * контракта — «разрешён каталог, защищён файл внутри него» (0012, 0014, 0017).
 */
function hasWildcard(segment) { return /[*?[]/.test(segment); }
function literalPrefix(segment) {
  const match = segment.match(/^[^*?[]*/);
  return match ? match[0] : '';
}
function literalSuffix(segment) {
  const match = segment.match(/[^*?[]*$/);
  return match ? match[0] : '';
}
function segmentsOverlap(left, right) {
  const leftFixed = !hasWildcard(left);
  const rightFixed = !hasWildcard(right);
  if (leftFixed && rightFixed) return left === right;
  if (leftFixed) return globToRegExp(right).test(left);
  if (rightFixed) return globToRegExp(left).test(right);
  /*
   * Оба сегмента с шаблоном: точного пересечения регулярных языков здесь не
   * строим. Совместимы, если литеральные префикс и суффикс одного продолжают
   * (или содержатся в) другом — этого хватает, чтобы `*.md` и `*.json` не
   * считались пересечением, а `*.js` и `a*.js` — считались.
   */
  const leftPrefix = literalPrefix(left);
  const rightPrefix = literalPrefix(right);
  const leftSuffix = literalSuffix(left);
  const rightSuffix = literalSuffix(right);
  const prefixOk = leftPrefix.startsWith(rightPrefix) || rightPrefix.startsWith(leftPrefix);
  const suffixOk = leftSuffix.endsWith(rightSuffix) || rightSuffix.endsWith(leftSuffix);
  return prefixOk && suffixOk;
}

export function patternsIntersect(patternA, patternB) {
  const split = (pattern) => {
    const posix = toPosix(pattern);
    return (posix.startsWith('./') ? posix.slice(2) : posix).split('/').filter((part) => part !== '');
  };
  const left = split(patternA);
  const right = split(patternB);
  const memo = new Map();
  const walk = (i, j) => {
    const key = i + ':' + j;
    if (memo.has(key)) return memo.get(key);
    let result;
    if (i === left.length && j === right.length) result = true;
    else if (i === left.length) result = right.slice(j).every((part) => part === '**');
    else if (j === right.length) result = left.slice(i).every((part) => part === '**');
    else if (left[i] === '**' && right[j] === '**') result = walk(i + 1, j) || walk(i, j + 1);
    else if (left[i] === '**') result = walk(i + 1, j) || walk(i, j + 1);
    else if (right[j] === '**') result = walk(i, j + 1) || walk(i + 1, j);
    else result = segmentsOverlap(left[i], right[j]) && walk(i + 1, j + 1);
    memo.set(key, result);
    return result;
  };
  return walk(0, 0);
}

export function walkFiles(root, opts = {}) {
  const out = [];
  const skipDirs = new Set(['.git', 'node_modules', '.venv', 'venv', '__pycache__']);
  const walk = (dir, rel) => {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      const childRel = rel ? rel + '/' + entry.name : entry.name;
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        if (skipDirs.has(entry.name)) continue;
        if (opts.exclude && matchesAny(childRel, opts.exclude)) continue;
        walk(path.join(dir, entry.name), childRel);
      } else if (entry.isFile()) {
        if (opts.exclude && matchesAny(childRel, opts.exclude)) continue;
        out.push(childRel);
      }
    }
  };
  walk(root, '');
  return out;
}

export function listRepoFiles(repo, opts = {}) {
  const exclude = opts.exclude || [];
  const set = new Set();
  const add = (text) => {
    for (const p of text.split('\0')) {
      if (!p) continue;
      const rel = toPosix(p);
      if (exclude.length && matchesAny(rel, exclude)) continue;
      set.add(rel);
    }
  };
  const tracked = git(repo, ['ls-files', '-z']);
  if (tracked.exitCode === 0) {
    add(tracked.stdout);
    if (opts.includeUntracked !== false) {
      const untracked = git(repo, ['ls-files', '--others', '--exclude-standard', '-z']);
      if (untracked.exitCode === 0) add(untracked.stdout);
    }
    return [...set].sort();
  }
  return walkFiles(repo, { exclude });
}

/*
 * Движок вне замка задания (2.6.18, 0050).
 *
 * `docs/subagent-workflow/**` — развёрнутая копия пакета, а не проверки задания:
 * её меняет `init --force` и обычный деплой. Пока эти файлы попадали в
 * protected-манифест, замок активной задачи краснел на чужой правке — за сутки
 * пять прерываний цикла (письмо structure --127). Поэтому манифест по умолчанию
 * движок не включает; задание, которое действительно держит его в хеше (редкий,
 * осознанный случай), объявляет `locksEngine: true` в TASK-META.
 */
export const ENGINE_DIR_PATTERNS = ['docs/subagent-workflow/**'];

export function protectedManifest(files, options = {}) {
  const list = Array.isArray(files) ? files : [];
  const locksEngine = options.locksEngine === true;
  const enginePatterns = Array.isArray(options.enginePatterns) && options.enginePatterns.length > 0
    ? options.enginePatterns.map(toPosix)
    : ENGINE_DIR_PATTERNS;
  const seen = new Set();
  for (const file of list) {
    if (typeof file !== 'string' || file.trim() === '') continue;
    const rel = toPosix(file);
    if (!locksEngine && matchesAny(rel, enginePatterns)) continue;
    seen.add(rel);
  }
  return [...seen].sort();
}

/*
 * Re-lock (2.6.18, 0050): правка контракта после доказанного красного без нового
 * номера задания.
 *
 * Разрешено менять только границы — allowedPaths, protectedPaths, redAllowDirty в
 * TASK-META — и покрытие критериев (covers, tags). Команда, ожидание, id, cwd,
 * timeoutMs, число и порядок критериев — это смысл проверки: их правка после
 * красного означает подгонку под результат, а не правку границ, и остаётся
 * новым номером задания.
 *
 * Функция чистая: сравнивает нормализованные снимки контракта и ничего не
 * читает с диска. Игнорируемые поля в снимке не обязаны присутствовать —
 * `task-hash --write` кладёт снимок в `criteria.lock` (`contract`).
 */
function stableJsonValue(value) {
  if (Array.isArray(value)) return '[' + value.map(stableJsonValue).join(',') + ']';
  if (value && typeof value === 'object') {
    return '{' + Object.keys(value)
      .sort()
      .map((key) => JSON.stringify(key) + ':' + stableJsonValue(value[key]))
      .join(',') + '}';
  }
  return JSON.stringify(value === undefined ? null : value);
}

function sortedStrings(value) {
  if (!Array.isArray(value)) return null;
  return value.map((item) => String(item)).sort();
}

function normalizeContractSnapshot(snapshot) {
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

export function verifyLock(repo, taskDir, meta, taskMd, criteria, options = {}) {
  const files = taskFiles(taskDir);
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
  for (const key of ['task', 'taskFileSha256', 'criteriaSha256', 'criteriaJsonSha256', 'attackSha256', 'contractCommit']) {
    if (lock[key] === actual[key]) continue;
    if (key === 'contractCommit' && accepted) {
      notes.push('contractCommit: замок на ' + lock[key] + ', HEAD сейчас ' + actual[key] + ' — задание уже принято, сдвиг HEAD ожидаем (metadata-коммит и последующая работа)');
      continue;
    }
    errors.push(key + ': ожидалось ' + lock[key] + ', сейчас ' + actual[key]);
  }
  const lockMap = new Map((lock.protected || []).map((x) => [x.path, x.sha256]));
  const actualMap = new Map(actual.protected.map((x) => [x.path, x.sha256]));
  for (const [p, h] of actualMap) {
    if (!lockMap.has(p)) errors.push('защищённый файл появился: ' + p);
    else if (lockMap.get(p) !== h) errors.push('защищённый файл изменён: ' + p);
  }
  for (const p of lockMap.keys()) if (!actualMap.has(p)) errors.push('защищённый файл исчез: ' + p);
  for (const error of contract.errors) errors.push('контракт: ' + error);
  return { ok: errors.length === 0, errors, notes, expected: lock, actual };
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
function shiftPathKind(file) {
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
export function reportFatal(gate, message, options = {}) {
  const NL = String.fromCharCode(10);
  const prefix = String(gate) + ': ';
  const text = message === undefined || message === null ? '' : String(message);
  if (options.stderr !== false) console.error(prefix + text);
  const lines = text.split(NL).map((line) => line.trim()).filter((line) => line !== '');
  if (options.json === true) {
    console.log(JSON.stringify({ ok: false, errors: lines.length > 0 ? lines : [text] }, null, 2));
    return;
  }
  if (lines.length > 0) console.log(prefix + lines[0]);
}

export function dirtyPaths(repo) {
  const set = new Set();
  for (const args of [
    ['diff', '--name-only', '-z'],
    ['diff', '--cached', '--name-only', '-z'],
    ['ls-files', '--others', '--exclude-standard', '-z'],
  ]) {
    const r = git(repo, args);
    if (r.exitCode !== 0) continue;
    for (const p of r.stdout.split('\0')) if (p) set.add(toPosix(p));
  }
  return [...set].sort();
}

export function diffPaths(repo, base) {
  const set = new Set();
  const r = git(repo, ['diff', '--name-only', '-z', base, '--']);
  if (r.exitCode === 0) for (const p of r.stdout.split('\0')) if (p) set.add(toPosix(p));
  const untracked = git(repo, ['ls-files', '--others', '--exclude-standard', '-z']);
  if (untracked.exitCode === 0) for (const p of untracked.stdout.split('\0')) if (p) set.add(toPosix(p));
  return [...set].sort();
}

export function readDiffText(repo, base) {
  const parts = [];
  const a = git(repo, ['diff', '--no-color', base, '--']);
  if (a.exitCode === 0) parts.push(a.stdout);
  const b = git(repo, ['diff', '--no-color', '--cached', '--']);
  if (b.exitCode === 0) parts.push(b.stdout);
  /*
   * Полный текст добавляем только неотслеживаемым файлам: у изменённых он уже есть
   * в диффе выше. Иначе скан секретов читает предсуществующие строки изменённого
   * файла и валит задачу за то, чего работа не касалась (1.4.2).
   */
  const untracked = new Set(
    (git(repo, ['ls-files', '--others', '--exclude-standard', '-z']).stdout || '')
      .split('\0')
      .filter(Boolean)
      .map(toPosix),
  );
  for (const rel of dirtyPaths(repo)) {
    if (!untracked.has(rel)) continue;
    if (rel.startsWith('docs/tasks/')) continue;
    const abs = path.join(repo, fromPosix(rel));
    if (exists(abs) && fs.statSync(abs).isFile()) {
      try { parts.push('+++ ' + rel + '\n' + readText(abs)); } catch { /* ignore binary */ }
    }
  }
  return parts.join('\n');
}

export const SECRET_PATTERNS = [
  { name: 'telegram_bot_token', re: /\b\d{8,10}:[A-Za-z0-9_-]{30,}\b/g },
  { name: 'aws_access_key', re: /\bAKIA[0-9A-Z]{16}\b/g },
  { name: 'github_token', re: /\bgh[pousr]_[A-Za-z0-9]{20,}\b/g },
  { name: 'private_key', re: /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/g },
  { name: 'bearer_token', re: /\bBearer\s+[A-Za-z0-9._-]{20,}/g },
  /*
   * Значение, за которым сразу идёт «(», — вызов функции, а не секрет:
   * `const apiKey = validateProviderApiKey(...)` не должен блокировать прогон.
   */
  { name: 'generic_secret', re: /\b(?:api[_-]?key|secret|password|passwd|token)\b\s*[:=]\s*["']?([A-Za-z0-9_\-./+=]{16,})(?![A-Za-z0-9_\-./+=])["']?(?!\s*\()/gi },
];

export function scanSecrets(text) {
  const hits = [];
  const lines = String(text).split('\n');
  for (const { name, re } of SECRET_PATTERNS) {
    for (let i = 0; i < lines.length; i += 1) {
      re.lastIndex = 0;
      let m;
      while ((m = re.exec(lines[i])) !== null) {
        const value = (m[1] || m[0] || '').trim();
        if (/^(<.*>|\$\{.*\}|example|your|xxx+|changeme|redacted|\*+)$/i.test(value)) continue;
        if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) continue;
        hits.push({ name, line: i + 1, excerpt: lines[i].trim().slice(0, 160) });
        if (hits.length >= 20) return hits;
      }
    }
  }
  return hits;
}

export function truncate(text, max = 20000) {
  const s = String(text);
  return s.length <= max ? s : s.slice(0, max) + '\n…[truncated ' + (s.length - max) + ' chars]';
}

export function runCommand(command, opts = {}) {
  return new Promise((resolve) => {
    const started = Date.now();
    const maxOutput = opts.maxOutput || 5 * 1024 * 1024;
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-cmd-'));
    const outFile = path.join(dir, 'stdout');
    const errFile = path.join(dir, 'stderr');
    let ofd;
    let efd;
    let child;
    let timer;
    let timedOut = false;
    let done = false;

    const finalize = (code, signal, error) => {
      if (done) return;
      done = true;
      if (timer) clearTimeout(timer);
      if (ofd !== undefined) { try { fs.closeSync(ofd); } catch { /* ignore */ } }
      if (efd !== undefined) { try { fs.closeSync(efd); } catch { /* ignore */ } }
      let stdout = '';
      let stderr = '';
      let outputTruncated = false;
      try {
        const outSize = fs.statSync(outFile).size;
        const errSize = fs.statSync(errFile).size;
        outputTruncated = outSize > maxOutput || errSize > maxOutput;
        stdout = fs.readFileSync(outFile).subarray(0, maxOutput).toString('utf8');
        stderr = fs.readFileSync(errFile).subarray(0, maxOutput).toString('utf8');
      } catch { /* ignore */ }
      if (error) stderr = (stderr ? stderr + String.fromCharCode(10) : '') + error.message;
      try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
      resolve({
        exitCode: error ? 127 : (code === null ? 124 : code),
        stdout, stderr, signal: signal || null, timedOut,
        durationMs: Date.now() - started, outputTruncated, error: error || null,
      });
    };

    try {
      ofd = fs.openSync(outFile, 'w');
      efd = fs.openSync(errFile, 'w');
      const childEnv = { ...process.env, ...(opts.env || {}) };
      for (const key of opts.unsetEnv || []) delete childEnv[key];
      child = spawn(command, {
        shell: true,
        cwd: opts.cwd || process.cwd(),
        env: childEnv,
        windowsHide: true,
        stdio: ['ignore', ofd, efd],
      });
    } catch (error) {
      finalize(127, null, error);
      return;
    }

    timer = setTimeout(() => { timedOut = true; try { child.kill('SIGTERM'); } catch { /* ignore */ } }, opts.timeoutMs || 120000);
    child.on('error', (error) => finalize(127, null, error));
    child.on('close', (code, signal) => finalize(timedOut && code === null ? 124 : code, signal, null));
  });
}

/*
 * Пул критериев (0045, WC-12): независимые проверки ворот идут параллельно.
 *
 * 0041: три прогона ворот по 189 с при max(критерий) = 115 с — 74 с чистой
 * суммы на каждом прогоне. Критерии не делят состояние (runCheck изолирует
 * временные корни), поэтому прогон идёт по max, а не по сумме, а порядок строк
 * остаётся прежним — по списку criteria.json, а не по порядку завершения.
 *
 * Степень параллелизма: options.concurrency → WF_CRITERIA_PARALLEL → 4.
 * Значение 1 — строго последовательно, прежнее поведение. Нечисло или число
 * меньше 1 не валит ворота: берётся следующее по приоритету значение.
 */
export function criteriaConcurrency(options = {}) {
  const parse = (value) => {
    if (value === undefined || value === null || value === '') return null;
    const n = Number(value);
    if (!Number.isFinite(n) || n < 1) return null;
    return Math.floor(n);
  };
  const declared = parse(options.concurrency);
  if (declared !== null) return declared;
  const fromEnv = parse(process.env.WF_CRITERIA_PARALLEL);
  return fromEnv === null ? 4 : fromEnv;
}

/**
 * Запускает критерии пулом и возвращает строки в порядке входного списка.
 *
 * Каждый критерий идёт через runCommand с cwd из c.cwd (относительно
 * options.cwd/options.repo), timeoutMs из c.timeoutMs (иначе options.timeoutMs,
 * иначе 120000) и env из options/env. Падение одного критерия не отменяет и не
 * обрывает остальные: исключение runCommand превращается в строку с
 * exitCode !== 0 и текстом ошибки в output, а не в reject пула.
 *
 * Строка: { id, command, exitCode, output, durationMs } плюс stdout/stderr/
 * timedOut — ворота пишут по ним лог и причины, не запуская критериев заново.
 * Manual-критерии не исполняются и строк не дают.
 */
export async function runCriteria(criteria, options = {}) {
  const list = Array.isArray(criteria) ? criteria.slice() : [];
  const base = path.resolve(options.cwd || options.repo || process.cwd());
  const env = options.env && typeof options.env === 'object' ? { ...options.env } : {};
  const defaultTimeoutMs = Number(options.timeoutMs) > 0 ? Number(options.timeoutMs) : 120000;
  const multiplier = Number(options.timeoutMultiplier) > 0 ? Number(options.timeoutMultiplier) : 1;
  const rows = new Array(list.length).fill(null);
  let next = 0;

  const runOne = async (index) => {
    const criterion = list[index] && typeof list[index] === 'object' ? list[index] : {};
    if (isManual(criterion) || criterion.command === undefined || criterion.command === null) return;
    const id = String(criterion.id);
    const command = String(criterion.command);
    const cwd = criterion.cwd ? path.resolve(base, String(criterion.cwd)) : base;
    const declaredTimeout = Number(criterion.timeoutMs) > 0 ? Number(criterion.timeoutMs) : defaultTimeoutMs;
    const timeoutMs = Math.max(1, Math.round(declaredTimeout * multiplier));
    const childEnv = {
      ...env,
      ...(criterion.env && typeof criterion.env === 'object' ? criterion.env : {}),
    };
    const started = Date.now();
    let result;
    try {
      result = await runCommand(command, { cwd, env: childEnv, timeoutMs, maxOutput: options.maxOutput });
    } catch (error) {
      result = {
        exitCode: 127,
        stdout: '',
        stderr: error && error.message ? String(error.message) : String(error),
        timedOut: false,
        durationMs: Date.now() - started,
      };
    }
    const stdout = result && result.stdout !== undefined && result.stdout !== null ? String(result.stdout) : '';
    const stderr = result && result.stderr !== undefined && result.stderr !== null ? String(result.stderr) : '';
    rows[index] = {
      id,
      command,
      exitCode: result && typeof result.exitCode === 'number' ? result.exitCode : 127,
      output: stderr === '' ? stdout : stdout + String.fromCharCode(10) + stderr,
      durationMs: result && typeof result.durationMs === 'number' ? result.durationMs : Date.now() - started,
      stdout,
      stderr,
      timedOut: Boolean(result && result.timedOut),
    };
  };

  const width = Math.max(1, Math.min(criteriaConcurrency(options), Math.max(1, list.length)));
  const workers = [];
  for (let i = 0; i < width; i += 1) {
    workers.push((async () => {
      for (;;) {
        const index = next;
        next += 1;
        if (index >= list.length) return;
        await runOne(index);
      }
    })());
  }
  await Promise.all(workers);
  return rows.filter((row) => row !== null);
}

export function evaluateExpectation(expect, result) {
  const reasons = [];
  const e = expect && Object.keys(expect).length ? expect : { exitCode: 0 };
  if ('exitCode' in e && result.exitCode !== e.exitCode) {
    reasons.push('exit code ' + result.exitCode + ' != ' + e.exitCode);
  }
  const contains = e.stdoutContains === undefined ? [] : (Array.isArray(e.stdoutContains) ? e.stdoutContains : [e.stdoutContains]);
  for (const s of contains) if (!result.stdout.includes(s)) reasons.push('stdout не содержит: ' + s);
  const stderrContains = e.stderrContains === undefined ? [] : (Array.isArray(e.stderrContains) ? e.stderrContains : [e.stderrContains]);
  for (const s of stderrContains) if (!result.stderr.includes(s)) reasons.push('stderr не содержит: ' + s);
  if (e.stdoutRegex) {
    try { if (!new RegExp(e.stdoutRegex, 'm').test(result.stdout)) reasons.push('stdout не соответствует /' + e.stdoutRegex + '/m'); }
    catch (err) { reasons.push('некорректный stdoutRegex: ' + err.message); }
  }
  if (e.stderrRegex) {
    try { if (!new RegExp(e.stderrRegex, 'm').test(result.stderr)) reasons.push('stderr не соответствует /' + e.stderrRegex + '/m'); }
    catch (err) { reasons.push('некорректный stderrRegex: ' + err.message); }
  }
  if (e.json) {
    try {
      const value = JSON.parse(result.stdout);
      const actual = String(e.json.path || '').split('.').filter(Boolean).reduce((acc, key) => (acc == null ? acc : acc[key]), value);
      if ('equals' in e.json && JSON.stringify(actual) !== JSON.stringify(e.json.equals)) {
        reasons.push('json ' + e.json.path + ' = ' + JSON.stringify(actual) + ' != ' + JSON.stringify(e.json.equals));
      }
      if (e.json.matches) {
        try { if (!new RegExp(e.json.matches, 'm').test(String(actual))) reasons.push('json ' + e.json.path + ' не соответствует /' + e.json.matches + '/'); }
        catch (err) { reasons.push('некорректный json.matches: ' + err.message); }
      }
    } catch (err) { reasons.push('stdout не JSON: ' + err.message); }
  }
  return { passed: reasons.length === 0, reasons };
}

export function formatMs(ms) {
  if (ms < 1000) return ms + ' ms';
  if (ms < 60000) return (ms / 1000).toFixed(1) + ' s';
  return (ms / 60000).toFixed(1) + ' min';
}

/*
 * 0055 (WC-24): ворота печатают exit-код и длительность каждого критерия.
 *
 * Замер критика: приёмщик 0039–0048 добирал эти числа ручными прогонами (≈980 с
 * дублей за семь приёмок) — в stdout было только `PASS  C1  5.5 s`, без кода
 * возврата и без общей картины. Формат строки побайтно задан контрактом задания:
 * `PASS  <id>  exit <code>  <ms> ms` (два пробела между полями). Функции чистые:
 * ничего не читают и не пишут, поэтому ими же пользуется проверка формата.
 */
function gateRowParts(row) {
  const source = row && typeof row === 'object' && !Array.isArray(row) ? row : {};
  const exitCode = Number(source.exitCode);
  const durationMs = Number(source.durationMs);
  return {
    id: source.id === undefined || source.id === null ? '' : String(source.id),
    code: Number.isFinite(exitCode) ? String(exitCode) : '—',
    ms: Number.isFinite(durationMs) ? String(Math.round(durationMs)) : '—',
    passed: source.passed === true,
  };
}

export function formatGateRow(row) {
  const parts = gateRowParts(row);
  return (parts.passed ? 'PASS' : 'FAIL') + '  ' + parts.id + '  exit ' + parts.code + '  ' + parts.ms + ' ms';
}

/* Итог одной строкой: «Итог: C1 exit 0 530 ms; C2 exit 3 1200 ms». */
export function formatGateSummary(rows) {
  const list = Array.isArray(rows) ? rows : [];
  if (list.length === 0) return 'Итог: исполняемых проверок нет';
  return 'Итог: ' + list.map((row) => {
    const parts = gateRowParts(row);
    return parts.id + ' exit ' + parts.code + ' ' + parts.ms + ' ms';
  }).join('; ');
}

export function isManual(criterion) {
  return criterion.manual === true || (Array.isArray(criterion.tags) && criterion.tags.includes('manual'));
}

/*
 * Решения задания (2.1.0). Семантическое решение — это выбор, который нельзя
 * проверить командой: «что считается доставкой», «что видит пользователь».
 * Такое решение обязано либо опираться на исполняемый критерий, либо быть
 * подтверждено человеком; иначе оно записывается как assumed и закрывает выпуск.
 */
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

function isEffectLinkApplicable(decision, byId) {
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
export const RED_REASON_WINDOW = 25;
/** Классы ошибок, означающих дефект самой проверки, а не отказ проверяемого кода. */
export const CHECK_DEFECT_NAMES = ['ReferenceError', 'TypeError', 'SyntaxError'];

function outputLines(text) {
  return String(text === undefined || text === null ? '' : text)
    .replaceAll(String.fromCharCode(13), '')
    .split(String.fromCharCode(10));
}

/** Непустые строки вывода: пустые строки вердиктную зону не раздувают. */
function nonEmptyLines(text) {
  return outputLines(text).map((line) => line.trim()).filter((line) => line !== '');
}

/**
 * Дефект проверки (0057, WC-35): у отказавшего критерия строка
 * `ReferenceError: …` (допустим префикс `Uncaught `) и в следующих 7 строках —
 * кадр стека (`    at …` или `node:internal`). Такой отказ означает ошибку в самой
 * проверке: она не позеленеет ни при какой реализации. Зелёный критерий не
 * сканируется вовсе, поэтому ожидаемый сбой негативного критерия дефектом не
 * становится. Возвращает null | { name, line } (line — обрезанная строка ошибки).
 */
export function detectCheckDefect(result) {
  if (!result || result.passed === true) return null;
  const text = String(result.stdout === undefined || result.stdout === null ? '' : result.stdout)
    + String.fromCharCode(10)
    + String(result.stderr === undefined || result.stderr === null ? '' : result.stderr);
  const lines = outputLines(text);
  for (let i = 0; i < lines.length; i += 1) {
    const match = /^\s*(?:Uncaught\s+)?(ReferenceError|TypeError|SyntaxError):\s*(?:\S|$)/u.exec(lines[i]);
    if (!match) continue;
    const frames = lines.slice(i + 1, i + 8);
    const hasFrame = frames.some((line) => /^\s+at\s+/u.test(line) || line.includes('node:internal'));
    if (hasFrame) return { name: match[1], line: lines[i].trim() };
  }
  return null;
}

/**
 * Сопоставление причины красного с вердиктной зоной вывода (0057, WC-35).
 *
 * Окно — последние windowSize непустых строк (CRLF терпим, пустые строки не
 * считаются). Строка обязана содержать причину подстрокой, не обязательно с
 * начала. Ищется последнее вхождение: ранняя «правильная» причина не должна
 * прикрывать чужую, потому что вердикт печатается в конце. distance — сколько
 * непустых строк после найденной; ok только при distance < windowSize.
 * Возвращает { ok, found, distance, total, line }, line — номер найденной
 * строки среди непустых (1-based), total — число непустых строк.
 */
export function matchRedReason(text, reason, windowSize) {
  const window = Number.isInteger(windowSize) && windowSize >= 1 && windowSize <= 10000 ? windowSize : RED_REASON_WINDOW;
  const lines = nonEmptyLines(text);
  const total = lines.length;
  const needle = String(reason === undefined || reason === null ? '' : reason);
  let index = -1;
  for (let i = 0; i < lines.length; i += 1) if (lines[i].includes(needle)) index = i;
  if (index < 0) return { ok: false, found: false, distance: null, total, line: null };
  const distance = total - index - 1;
  return { ok: distance < window, found: true, distance, total, line: index + 1 };
}

/**
 * Размер вердиктного окна (0057, WC-35): redExpect.reasonWindow, если это целое
 * 1..10000, иначе RED_REASON_WINDOW. Некорректное значение отвергает task-lint;
 * здесь оно не роняет ворота, а даёт окно по умолчанию.
 */
export function redReasonWindow(redExpect) {
  const value = redExpect && typeof redExpect === 'object' && !Array.isArray(redExpect) ? redExpect.reasonWindow : undefined;
  return Number.isInteger(value) && value >= 1 && value <= 10000 ? value : RED_REASON_WINDOW;
}

export function evaluateRedExpectation(redExpect, results) {
  const list = Array.isArray(results) ? results : [];
  const shape = (checkDefects, reasonChecks, window) => ({ checkDefects, reasonChecks, reasonWindow: window });
  if (redExpect === undefined || redExpect === null) {
    return {
      configured: false, ok: list.some((r) => !r.passed), errors: [], mustFail: [], mustPass: [],
      ...shape([], [], RED_REASON_WINDOW),
    };
  }
  if (typeof redExpect !== 'object' || Array.isArray(redExpect)) {
    return {
      configured: true, ok: false, errors: ['redExpect должен быть объектом'], mustFail: [], mustPass: [],
      ...shape([], [], RED_REASON_WINDOW),
    };
  }
  const mustFail = Array.isArray(redExpect.mustFail) ? redExpect.mustFail.map(String) : [];
  const mustPass = Array.isArray(redExpect.mustPass) ? redExpect.mustPass.map(String) : [];
  const reasons = redExpect.reasons && typeof redExpect.reasons === 'object' ? redExpect.reasons : {};
  const window = redReasonWindow(redExpect);
  const byId = new Map(list.map((r) => [r.id, r]));
  const errors = [];
  const checkDefects = [];
  const reasonChecks = [];
  /*
   * Дефект проверки важнее совпадения причины: если проверка падает собственной
   * ReferenceError/TypeError/SyntaxError, красный не доказывает ничего, даже когда
   * ожидаемая причина в выводе есть.
   */
  for (const result of list) {
    if (!result || result.passed === true) continue;
    const defect = detectCheckDefect(result);
    if (!defect) continue;
    const entry = { id: String(result.id), name: defect.name, line: defect.line };
    checkDefects.push(entry);
    errors.push('дефект проверки: критерий ' + entry.id + ' — ' + entry.name + ': ' + entry.line
      + '. Отказ самой проверки, а не доказанный красный: устраните ошибку в проверке.');
  }
  if (mustFail.length === 0) errors.push('redExpect.mustFail пуст: неясно, что обязано упасть');
  for (const id of mustFail) {
    const result = byId.get(id);
    if (!result) { errors.push('redExpect: нет критерия ' + id); continue; }
    if (result.passed) { errors.push('redExpect: критерий ' + id + ' обязан упасть, а он зелёный'); continue; }
    const reason = reasons[id];
    if (typeof reason !== 'string' || reason === '') continue;
    const text = String(result.stdout || '') + String.fromCharCode(10) + String(result.stderr || '');
    const match = matchRedReason(text, reason, window);
    reasonChecks.push({ id, ok: match.ok, distance: match.distance, total: match.total, window });
    if (!match.found) {
      errors.push('redExpect: критерий ' + id + ' упал не по ожидаемой причине (' + reason + ')');
    } else if (!match.ok) {
      errors.push('redExpect: критерий ' + id + ' — причина «' + reason + '» есть только в строке '
        + match.line + ' из ' + match.total + ' непустых, а вердиктная зона — последние '
        + window + ' непустых строк вывода. Расширяйте reasonWindow осознанно, если причина'
        + ' законно напечатана выше зоны');
    }
  }
  for (const id of mustPass) {
    const result = byId.get(id);
    if (!result) { errors.push('redExpect: нет критерия ' + id); continue; }
    if (!result.passed) errors.push('redExpect: критерий ' + id + ' обязан быть зелёным на базе');
  }
  const declared = new Set([...mustFail, ...mustPass]);
  for (const result of list) {
    if (!declared.has(result.id)) errors.push('redExpect: критерий ' + result.id + ' не указан ни в mustFail, ни в mustPass');
  }
  return {
    configured: true, ok: errors.length === 0, errors, mustFail, mustPass,
    ...shape(checkDefects, reasonChecks, window),
  };
}

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
export const ACTOR_SOURCE_KINDS = ['harness', 'runner', 'ci', 'manual'];

/**
 * Нормализация блока actor (2.6.0).
 *
 * Правила:
 * 1. Непустой actor.sources — источник истины. Невалидные записи отбрасываются,
 *    текст ошибки складывается в actor.errors: молча «починить» конфиг нельзя,
 *    иначе неизвестный вид источника тихо стал бы разрешённым.
 * 2. Без sources (legacy) поведение прежнее: primaryEnv → harness, fallbackEnv →
 *    manual; уровень остаётся env/separate-session и declared соответственно.
 * 3. Файла конфига нет — дефолт нового пакета: DSH как harness, WF_ACTOR_SESSION
 *    как runner (обёртка проекта, а не DSH).
 * 4. Старые поля primaryEnv/fallbackEnv/modelEnv сохраняются без изменений:
 *    их читает панель и конфиги проектов.
 */
export function normalizeActorConfig(rawActor, { fileExists = true } = {}) {
  const raw = rawActor && typeof rawActor === 'object' && !Array.isArray(rawActor) ? rawActor : {};
  const errors = [];
  /* Старые поля живут в объекте всегда: их читает панель, а конфиг без них не должен падать. */
  const legacy = {
    primaryEnv: typeof raw.primaryEnv === 'string' && raw.primaryEnv.trim() !== '' ? raw.primaryEnv : 'DSH_SESSION_ID',
    fallbackEnv: typeof raw.fallbackEnv === 'string' && raw.fallbackEnv.trim() !== '' ? raw.fallbackEnv : 'TASK_ACTOR_SESSION',
    modelEnv: typeof raw.modelEnv === 'string' && raw.modelEnv.trim() !== '' ? raw.modelEnv : 'DSH_MODEL',
  };
  let sources;
  const declaredSources = raw.sources;
  if (Array.isArray(declaredSources) && declaredSources.length > 0) {
    sources = [];
    for (const [index, entry] of declaredSources.entries()) {
      const label = 'actor.sources[' + index + ']';
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
        errors.push(label + ': запись должна быть объектом { env, kind }');
        continue;
      }
      const env = typeof entry.env === 'string' ? entry.env.trim() : '';
      if (env === '') {
        errors.push(label + ': env должен быть непустой строкой — именем переменной окружения');
        continue;
      }
      if (!ACTOR_SOURCE_KINDS.includes(entry.kind)) {
        errors.push(label + ' (' + env + '): вид ' + JSON.stringify(entry.kind) + ' неизвестен, допустимы ' + ACTOR_SOURCE_KINDS.join(' | '));
        continue;
      }
      sources.push({ env, kind: entry.kind });
    }
  } else if (declaredSources !== undefined && !Array.isArray(declaredSources)) {
    errors.push('actor.sources должен быть массивом записей { env, kind }');
    sources = [];
  } else if (fileExists) {
    sources = [
      { env: legacy.primaryEnv, kind: 'harness' },
      { env: legacy.fallbackEnv, kind: 'manual' },
    ];
  } else {
    sources = [
      { env: 'DSH_SESSION_ID', kind: 'harness' },
      { env: 'WF_ACTOR_SESSION', kind: 'runner' },
    ];
  }
  const declaredModels = Array.isArray(raw.modelSources)
    ? raw.modelSources
      .filter((name) => typeof name === 'string' && name.trim() !== '')
      .map((name) => name.trim())
    : [];
  const modelSources = declaredModels.length > 0
    ? declaredModels
    : [legacy.modelEnv, 'WF_ACTOR_MODEL'];
  return { ...raw, ...legacy, sources, modelSources, errors };
}

/**
 * Конфигурация рабочего пространства. Лежит в репозитории, поэтому пути и
 * политика логирования одинаковы у всех, кто запускает ворота.
 */
export function loadConfig(repo, fileName = 'docs/subagent-workflow/workflow.config.json') {
  const file = path.join(repo, fileName);
  const defaults = {
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
  if (!exists(file)) return { ...defaults, actor: normalizeActorConfig({}, { fileExists: false }), loaded: false, file };
  const raw = readJson(file);
  return {
    ...defaults,
    ...raw,
    actor: normalizeActorConfig(raw.actor, { fileExists: true }),
    policy: { ...defaults.policy, ...(raw.policy || {}), roles: { ...defaults.policy.roles, ...((raw.policy || {}).roles || {}) } },
    models: { ...defaults.models, ...(raw.models || {}) },
    roles: { ...defaults.roles, ...(raw.roles || {}) },
    loaded: true,
    file,
  };
}
