import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';

export const TOOL = 'subagent-workflow/2.4.3';
export const TASK_ARTIFACTS = new Set([
  'task.md', 'criteria.json', 'criteria.lock', 'red.json', 'red.log',
  'verify.json', 'verify.log', 'acceptance.json', 'report.md', 'report.json',
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
  for (const file of [...workFiles, ...headFiles]) {
    if (isArtifact(file)) continue;
    if (matchesAny(file, protectedPatterns)) files.add(file);
  }
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
  try { return JSON.parse(m[1].trim()); }
  catch (err) { fail('TASK-META не является JSON: ' + err.message); }
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

export function hashProtectedFiles(repo, patterns, exclude = []) {
  if (!patterns || patterns.length === 0) return [];
  const files = listRepoFiles(repo, { includeUntracked: true, exclude });
  const matched = files.filter((f) => matchesAny(f, patterns));
  return matched.sort().map((f) => {
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
  const protectedFiles = hashProtectedFiles(repo, meta.protectedPaths || [], exclude);
  return {
    version: 3,
    task: String(meta.id),
    taskFileSha256: sha256(canonicalize(taskMd)),
    criteriaSha256: sha256(canonicalize(block)),
    criteriaJsonSha256: sha256(canonicalize(criteria.raw)),
    attackSha256,
    contractCommit: contractCommit || null,
    protected: protectedFiles,
    createdAt: new Date().toISOString(),
    tool: TOOL,
  };
}

export function verifyLock(repo, taskDir, meta, taskMd, criteria) {
  const files = taskFiles(taskDir);
  if (!exists(files.lock)) return { ok: false, errors: ['criteria.lock отсутствует — выполните task-hash --write'], expected: null, actual: null };
  let lock;
  try { lock = readJson(files.lock); } catch (err) { return { ok: false, errors: [err.message], expected: null, actual: null }; }
  const contract = checkContractCommitted(repo, taskDir, meta);
  const actual = computeLock(repo, taskDir, meta, taskMd, criteria, contract.contractCommit);
  const errors = [];
  if (lock.version !== 3) errors.push('criteria.lock: версия ' + lock.version + ' устарела, нужна 3 — выполните task-hash --write');
  for (const key of ['task', 'taskFileSha256', 'criteriaSha256', 'criteriaJsonSha256', 'attackSha256', 'contractCommit']) {
    if (lock[key] !== actual[key]) errors.push(key + ': ожидалось ' + lock[key] + ', сейчас ' + actual[key]);
  }
  const lockMap = new Map((lock.protected || []).map((x) => [x.path, x.sha256]));
  const actualMap = new Map(actual.protected.map((x) => [x.path, x.sha256]));
  for (const [p, h] of actualMap) {
    if (!lockMap.has(p)) errors.push('защищённый файл появился: ' + p);
    else if (lockMap.get(p) !== h) errors.push('защищённый файл изменён: ' + p);
  }
  for (const p of lockMap.keys()) if (!actualMap.has(p)) errors.push('защищённый файл исчез: ' + p);
  for (const error of contract.errors) errors.push('контракт: ' + error);
  return { ok: errors.length === 0, errors, expected: lock, actual };
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
 */
export function evaluateRedExpectation(redExpect, results) {
  if (redExpect === undefined || redExpect === null) {
    return { configured: false, ok: results.some((r) => !r.passed), errors: [], mustFail: [], mustPass: [] };
  }
  if (typeof redExpect !== 'object' || Array.isArray(redExpect)) {
    return { configured: true, ok: false, errors: ['redExpect должен быть объектом'], mustFail: [], mustPass: [] };
  }
  const mustFail = Array.isArray(redExpect.mustFail) ? redExpect.mustFail.map(String) : [];
  const mustPass = Array.isArray(redExpect.mustPass) ? redExpect.mustPass.map(String) : [];
  const reasons = redExpect.reasons && typeof redExpect.reasons === 'object' ? redExpect.reasons : {};
  const byId = new Map(results.map((r) => [r.id, r]));
  const errors = [];
  if (mustFail.length === 0) errors.push('redExpect.mustFail пуст: неясно, что обязано упасть');
  for (const id of mustFail) {
    const result = byId.get(id);
    if (!result) { errors.push('redExpect: нет критерия ' + id); continue; }
    if (result.passed) { errors.push('redExpect: критерий ' + id + ' обязан упасть, а он зелёный'); continue; }
    const reason = reasons[id];
    if (typeof reason === 'string' && reason !== '') {
      const text = String(result.stdout || '') + '\n' + String(result.stderr || '');
      if (!text.includes(reason)) errors.push('redExpect: критерий ' + id + ' упал не по ожидаемой причине (' + reason + ')');
    }
  }
  for (const id of mustPass) {
    const result = byId.get(id);
    if (!result) { errors.push('redExpect: нет критерия ' + id); continue; }
    if (!result.passed) errors.push('redExpect: критерий ' + id + ' обязан быть зелёным на базе');
  }
  const declared = new Set([...mustFail, ...mustPass]);
  for (const result of results) {
    if (!declared.has(result.id)) errors.push('redExpect: критерий ' + result.id + ' не указан ни в mustFail, ни в mustPass');
  }
  return { configured: true, ok: errors.length === 0, errors, mustFail, mustPass };
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
  if (!exists(file)) return { ...defaults, loaded: false, file };
  const raw = readJson(file);
  return {
    ...defaults,
    ...raw,
    actor: { ...defaults.actor, ...(raw.actor || {}) },
    policy: { ...defaults.policy, ...(raw.policy || {}), roles: { ...defaults.policy.roles, ...((raw.policy || {}).roles || {}) } },
    models: { ...defaults.models, ...(raw.models || {}) },
    roles: { ...defaults.roles, ...(raw.roles || {}) },
    loaded: true,
    file,
  };
}
