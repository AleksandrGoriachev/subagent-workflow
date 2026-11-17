#!/usr/bin/env node
/*
 * 2.6.31 (0072, WC-54): сторож в пакете — job start/wait вместо длинных ожиданий.
 *
 * Почему: агенты ждут завершения тяжёлых прогонов сном (Start-Sleep, длинный wait
 * в инструменте). Это тратит шаг и не даёт остановиться. Сторож — процесс,
 * который блокируется на состоянии задания и возвращается ровно по его концу.
 *
 * Обязательства:
 *  - c1: job start возвращает управление сразу и печатает "JOB <id>"; job wait
 *        возвращает "DONE <id> exit=7" не раньше, чем через 1200 мс, и exit-код
 *        ребёнка не теряется;
 *  - c2: job wait --timeout на незавершённом задании печатает "TIMEOUT" и выходит
 *        с 0 (вердикт в stdout, не кодом — код фоновых заданий харнесс нормализует);
 *  - c3: job kill переводит задание в терминальное состояние (не RUNNING);
 *  - c4: убитый сторож даёт вердикт STALE (wait и status), а не вечное RUNNING;
 *  - c5: живой pid, но устаревший heartbeat — тоже STALE с причиной.
 *
 * Вне пакета — SKIP (конвенция deployed-copy).
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSyncPipeFree } from '../scripts/lib/common.mjs';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PKG = path.resolve(HERE, '..', '..');

if (!fs.existsSync(path.join(PKG, 'spec'))) {
  console.log('SKIP: проверка пакета вне пакета');
  process.exit(0);
}

const JOB = path.join(PKG, 'spec', 'scripts', 'job.mjs');
const JOBS = path.join(PKG, '.tmp', 'jobs');
const truthy = (value, label) => { if (!value) throw new Error(label); };

function job(args, timeout = 60000) {
  truthy(fs.existsSync(JOB), 'нет spec/scripts/job.mjs');
  const res = spawnSyncPipeFree(process.execPath, [JOB, ...args], { cwd: PKG, encoding: 'utf8', timeout });
  truthy(!res.error, 'job.mjs не запускается: ' + (res.error && res.error.message));
  return { code: res.status, out: String(res.stdout || '') + String(res.stderr || '') };
}

function startId(out) {
  const m = /JOB\s+(\S+)/.exec(out);
  truthy(m, 'start не напечатал "JOB <id>": ' + out.trim().slice(0, 300));
  return m[1];
}

function c1() {
  const started = Date.now();
  const child = process.execPath;
  const s = job(['start', '--', child, '-e', 'setTimeout(()=>process.exit(7),1500)']);
  truthy(s.code === 0, 'start exit ' + s.code + ': ' + s.out.trim().slice(0, 300));
  const id = startId(s.out);
  const w = job(['wait', id, '--timeout', '30', '--interval', '0.2'], 60000);
  const wall = Date.now() - started;
  truthy(w.code === 0, 'wait exit ' + w.code + ': ' + w.out.trim().slice(0, 300));
  truthy(new RegExp('DONE\\s+' + id + '\\s+exit=7').test(w.out), 'wait не напечатал DONE ... exit=7: ' + w.out.trim().slice(0, 300));
  truthy(wall >= 1200, 'wait вернулся раньше конца задания: ' + wall + ' мс');
  console.log('JOBRUN OK c1');
}

function c2() {
  const s = job(['start', '--', process.execPath, '-e', 'setTimeout(()=>{},8000)']);
  truthy(s.code === 0, 'start exit ' + s.code + ': ' + s.out.trim().slice(0, 300));
  const id = startId(s.out);
  try {
    const w = job(['wait', id, '--timeout', '1', '--interval', '0.2'], 30000);
    truthy(w.code === 0, 'таймаут не должен давать ненулевой код: ' + w.code);
    truthy(/TIMEOUT/.test(w.out), 'нет вердикта TIMEOUT: ' + w.out.trim().slice(0, 300));
  } finally {
    job(['kill', id], 30000);
  }
  console.log('JOBRUN OK c2');
}

function c3() {
  const s = job(['start', '--', process.execPath, '-e', 'setTimeout(()=>{},30000)']);
  truthy(s.code === 0, 'start exit ' + s.code + ': ' + s.out.trim().slice(0, 300));
  const id = startId(s.out);
  const k = job(['kill', id], 30000);
  truthy(k.code === 0, 'kill exit ' + k.code + ': ' + k.out.trim().slice(0, 300));
  const st = job(['status', id], 30000);
  truthy(st.code === 0, 'status exit ' + st.code + ': ' + st.out.trim().slice(0, 300));
  truthy(!/RUNNING/.test(st.out), 'после kill задание всё ещё RUNNING: ' + st.out.trim().slice(0, 300));
  console.log('JOBRUN OK c3');
}

function readJobState(id) {
  return JSON.parse(fs.readFileSync(path.join(JOBS, id + '.json'), 'utf8'));
}

/* c4: сторож убит — задание обязано стать STALE, а не RUNNING навсегда. */
function c4() {
  const started = Date.now();
  const s = job(['start', '--', process.execPath, '-e', 'setTimeout(()=>{},30000)']);
  truthy(s.code === 0, 'start exit ' + s.code + ': ' + s.out.trim().slice(0, 300));
  const id = startId(s.out);
  const state = readJobState(id);
  truthy(Number.isInteger(state.pid), 'в состоянии нет pid сторожа: ' + JSON.stringify(state).slice(0, 200));
  try { process.kill(state.pid); } catch { /* уже завершён */ }
  const w = job(['wait', id, '--timeout', '15', '--interval', '0.2'], 40000);
  const wall = Date.now() - started;
  truthy(w.code === 0, 'wait exit ' + w.code + ': ' + w.out.trim().slice(0, 300));
  truthy(new RegExp('STALE\\s+' + id).test(w.out), 'нет вердикта STALE: ' + w.out.trim().slice(0, 300));
  truthy(/сторож не жив|heartbeat/.test(w.out), 'STALE без причины: ' + w.out.trim().slice(0, 300));
  truthy(wall < 15000, 'STALE пришёл слишком поздно: ' + wall + ' мс');
  const st = job(['status', id], 30000);
  truthy(/STALE/.test(st.out), 'status не показал STALE: ' + st.out.trim().slice(0, 300));
  try { process.kill(state.childPid); } catch { /* ребёнок уже завершён или недоступен */ }
  console.log('JOBRUN OK c4');
}

/* c5: heartbeat устарел при живом pid — тоже STALE. */
function c5() {
  fs.mkdirSync(JOBS, { recursive: true });
  const id = 'checkstale' + Date.now().toString(16);
  const now = Date.now();
  fs.writeFileSync(path.join(JOBS, id + '.json'), JSON.stringify({
    id,
    command: 'проверка heartbeat',
    cwd: PKG,
    status: 'RUNNING',
    pid: process.pid,
    childPid: null,
    startedAt: new Date(now - 3600000).toISOString(),
    startedMs: now - 3600000,
    heartbeatAt: new Date(now - 3600000).toISOString(),
  }, null, 2) + '\n');
  try {
    const st = job(['status', id], 30000);
    truthy(new RegExp('STALE\\s+' + id).test(st.out), 'status не показал STALE по heartbeat: ' + st.out.trim().slice(0, 300));
    truthy(/heartbeat/.test(st.out), 'причина STALE не называет heartbeat: ' + st.out.trim().slice(0, 300));
  } finally {
    fs.rmSync(path.join(JOBS, id + '.json'), { force: true });
  }
  console.log('JOBRUN OK c5');
}

const table = { c1, c2, c3, c4, c5 };
const which = process.argv[2];
if (!table[which]) {
  console.log('usage: node spec/checks/job-runner.mjs c1|c2|c3|c4|c5');
  process.exit(2);
}
try {
  table[which]();
} catch (error) {
  console.log('JOBRUN FAIL ' + which + ': ' + (error && error.message ? error.message : error));
  process.exit(1);
}
