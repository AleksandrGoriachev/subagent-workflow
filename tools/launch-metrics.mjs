#!/usr/bin/env node
/**
 * launch-metrics — снапшот метрик эффективности узлов по журналам хоста.
 *
 * Зачем: 2.6.88 вводит бюджеты хода, маршрут вместо отказа ожидания, сторож
 * повторов и обязательный «образ результата». Чтобы говорить «стало лучше»,
 * нужен одинаковый замер до и после: одни и те же поля, один и тот же разбор.
 *
 * Источник: ~/.dsh/sessions/<воркспейс>/<сессия>/session.v4.jsonl.zstd (многокадровый zstd).
 * Репозитории воркспейсов не читаются — только журналы хоста.
 *
 * Использование:
 *   node tools/launch-metrics.mjs [--out <файл>] [--compare <baseline.json>] [--workspaces a,b]
 *                                 [--sessions <n>] [--json]
 *
 * --sessions <n>  брать последние n сессий каждого воркспейса по mtime (по умолчанию все).
 * --compare       напечатать изменения ключевых метрик против baseline (снимок до правок).
 *
 * Метрики — доли, а не абсолюты: объём журналов растёт, абсолютные числа несравнимы.
 * Коды выхода: 0 — снимок снят; 2 — нет каталога журналов; 3 — плохой baseline.
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import crypto from 'node:crypto';

export const SCHEMA = 1;
const DEFAULT_ROOT = path.join(process.env.USERPROFILE || process.env.HOME || '.', '.dsh', 'sessions');
const MAGIC = Buffer.from([0x28, 0xb5, 0x2f, 0xfd]);
const REFUSAL_RE = /запрещено политикой|exit code: 124|timed out|ETIMEDOUT|превышен тайм-?аут|Операция прервана|tool call timed out/i;
const LONG_TURN_MIN = 20;

function arg(name, fallback) {
  const i = process.argv.indexOf(name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}
const OUT = arg('--out', '');
/** 2.6.89: публикация снимка в воркспейс для панели ( /api/metrics ). */
const PUBLISH = arg('--publish', '');
const COMPARE = arg('--compare', '');
const ONLY = arg('--workspaces', '');
const LIMIT = Number(arg('--sessions', '0')) || 0;
const ROOT = arg('--root', DEFAULT_ROOT);

/* Ключ воркспейса — сырое имя каталога журналов (стабильно между снимками; разделители
 * пути в нём уже заменены на '-', восстановить нельзя, поэтому не «улучшаем»). */
const wsName = (dir) => dir.replace(/^--|--$/g, '');

/** Список журналов: воркспейс -> сессии (последние LIMIT по mtime). */
export function journalList(root = ROOT, only = ONLY, limit = LIMIT) {
  if (!fs.existsSync(root)) return null;
  const wanted = only ? only.split(',').map((s) => s.trim()).filter(Boolean) : [];
  const out = [];
  for (const w of fs.readdirSync(root)) {
    const wp = path.join(root, w);
    if (!fs.statSync(wp).isDirectory()) continue;
    const name = wsName(w);
    if (wanted.length > 0 && !wanted.some((x) => name.includes(x) || w.includes(x))) continue;
    const items = [];
    for (const s of fs.readdirSync(wp)) {
      const f = path.join(wp, s, 'session.v4.jsonl.zstd');
      if (fs.existsSync(f)) items.push({ session: s, file: f, mtime: fs.statSync(f).mtimeMs });
    }
    items.sort((a, b) => a.mtime - b.mtime);
    const keep = limit > 0 ? items.slice(-limit) : items;
    for (const it of keep) out.push({ workspace: name, ...it });
  }
  return out;
}

export function readEvents(file, onEvent) {
  const buf = fs.readFileSync(file);
  const offs = [];
  let i = buf.indexOf(MAGIC, 0);
  while (i !== -1) { offs.push(i); i = buf.indexOf(MAGIC, i + 4); }
  for (let k = 0; k < offs.length; k++) {
    const s = offs[k];
    const e = k + 1 < offs.length ? offs[k + 1] : buf.length;
    let text;
    try { text = zlib.zstdDecompressSync(buf.subarray(s, e)).toString('utf8'); } catch { continue; }
    for (const line of text.split('\n')) {
      if (!line.trim()) continue;
      let o;
      try { o = JSON.parse(line); } catch { continue; }
      onEvent(o);
    }
  }
}

const pct = (n, d) => (d > 0 ? +(n / d).toFixed(3) : 0);
const quantile = (arr, p) => (arr.length === 0 ? 0 : arr[Math.min(arr.length - 1, Math.floor(arr.length * p))]);

function emptyBucket(name) {
  return {
    workspace: name, sessions: 0, subagentSessions: 0, turns: 0,
    turnMinSum: 0, turnMins: [], longTurns20: 0,
    jobs: 0, jobMs: [], killed: 0, refusals: 0, llmRetries: 0, loops: 0,
  };
}

export function collect(entries) {
  const byWs = new Map();
  for (const e of entries) {
    if (!byWs.has(e.workspace)) byWs.set(e.workspace, emptyBucket(e.workspace));
    const b = byWs.get(e.workspace);
    b.sessions += 1;
    const openTurns = new Map();
    const seen = new Map();
    readEvents(e.file, (o) => {
      if (o.type === 'session' && o.origin === 'subagent') { b.subagentSessions += 1; return; }
      if (o.type === 'turn/start') { openTurns.set(o.data.turn, o.time); return; }
      if (o.type === 'turn/end') {
        b.turns += 1;
        const s = openTurns.get(o.data.turn);
        if (s) {
          const min = (o.time - s) / 60000;
          b.turnMinSum += min;
          b.turnMins.push(min);
          if (min >= LONG_TURN_MIN) b.longTurns20 += 1;
        }
        return;
      }
      if (o.type === 'llm/retry') { b.llmRetries += 1; return; }
      if (o.type === 'tool/call') {
        const sig = crypto.createHash('sha1').update(String(o.data.name) + '|' + String(o.data.arguments || '')).digest('hex').slice(0, 10);
        const rec = seen.get(sig) || { n: 0 };
        rec.n += 1;
        seen.set(sig, rec);
        return;
      }
      if (o.type === 'job/settled') {
        b.jobs += 1;
        const st = String(o.data.status || '');
        if (st === 'killed') b.killed += 1;
        if (o.data.startedAt && o.data.finishedAt) b.jobMs.push(o.data.finishedAt - o.data.startedAt);
        return;
      }
      if (o.type === 'tool/result') {
        const msg = o.data && o.data.message;
        const text = msg ? JSON.stringify(msg.content || '') : '';
        if (REFUSAL_RE.test(text)) b.refusals += 1;
        return;
      }
    });
    for (const rec of seen.values()) if (rec.n >= 3) b.loops += 1;
  }
  return [...byWs.values()].map((b) => {
    b.turnMins.sort((x, y) => x - y);
    b.jobMs.sort((x, y) => x - y);
    return {
      workspace: b.workspace,
      sessions: b.sessions,
      subagentSessions: b.subagentSessions,
      turns: b.turns,
      avgTurnMin: b.turns ? +(b.turnMinSum / b.turns).toFixed(2) : 0,
      p90TurnMin: +quantile(b.turnMins, 0.9).toFixed(1),
      maxTurnMin: +(b.turnMins[b.turnMins.length - 1] || 0).toFixed(1),
      longTurnRate: pct(b.longTurns20, b.turns),
      jobs: b.jobs,
      jobP50Sec: Math.round(quantile(b.jobMs, 0.5) / 1000),
      jobP90Sec: Math.round(quantile(b.jobMs, 0.9) / 1000),
      killedRate: pct(b.killed, b.jobs),
      refusalsPerSession: pct(b.refusals, b.sessions),
      loopsPerSession: pct(b.loops, b.sessions),
      llmRetriesPerTurn: pct(b.llmRetries, b.turns),
    };
  }).sort((a, b) => b.sessions - a.sessions);
}

/** Сравнение двух снимков: изменения только по сопоставимым воркспейсам. */
export function compare(baseline, current) {
  const key = (s) => s.workspace;
  const rows = [];
  for (const cur of current) {
    const base = baseline.workspaces.find((w) => key(w) === key(cur));
    if (!base) continue;
    rows.push({
      workspace: cur.workspace,
      longTurnRate: [base.longTurnRate, cur.longTurnRate],
      killedRate: [base.killedRate, cur.killedRate],
      refusalsPerSession: [base.refusalsPerSession, cur.refusalsPerSession],
      loopsPerSession: [base.loopsPerSession, cur.loopsPerSession],
      avgTurnMin: [base.avgTurnMin, cur.avgTurnMin],
      p90TurnMin: [base.p90TurnMin, cur.p90TurnMin],
    });
  }
  return rows;
}

function main() {
  const entries = journalList();
  if (entries === null) { console.error('launch-metrics: нет каталога журналов ' + ROOT); return 2; }
  const workspaces = collect(entries);
  const snapshot = {
    schema: SCHEMA,
    root: ROOT,
    generatedAt: new Date().toISOString(),
    sessionsScanned: entries.length,
    workspaces,
  };
  if (PUBLISH) {
    /* Панель читает только этот файл: тяжёлый пересчёт в браузере не нужен. */
    const target = path.join(path.resolve(PUBLISH), '.dsh', 'workflow');
    fs.mkdirSync(target, { recursive: true });
    fs.writeFileSync(path.join(target, 'metrics.json'), JSON.stringify(snapshot, null, 2) + '\n');
    console.log('launch-metrics: снимок опубликован в ' + path.join(target, 'metrics.json'));
  }
  if (OUT) { fs.mkdirSync(path.dirname(path.resolve(OUT)), { recursive: true }); fs.writeFileSync(OUT, JSON.stringify(snapshot, null, 2) + '\n'); }
  if (COMPARE) {
    if (!fs.existsSync(COMPARE)) { console.error('launch-metrics: нет baseline ' + COMPARE); return 3; }
    const base = JSON.parse(fs.readFileSync(COMPARE, 'utf8'));
    const rows = compare(base, workspaces);
    console.log('воркспейс | длинные ходы | killed | отказы/сессия | петли/сессия | средний ход | p90 хода');
    for (const r of rows) {
      const f = (pair, digits = 2) => pair[0].toFixed(digits) + ' → ' + pair[1].toFixed(digits);
      console.log(r.workspace + ' | ' + f(r.longTurnRate, 3) + ' | ' + f(r.killedRate, 3) + ' | '
        + f(r.refusalsPerSession) + ' | ' + f(r.loopsPerSession, 3) + ' | '
        + f(r.avgTurnMin, 1) + ' мин | ' + f(r.p90TurnMin, 1) + ' мин');
    }
    return 0;
  }
  console.log('сессий в снимке: ' + entries.length);
  for (const w of workspaces) {
    console.log(w.workspace.padEnd(20) + ' сессий ' + String(w.sessions).padStart(4)
      + ' | ходов ' + String(w.turns).padStart(4)
      + ' | средний ' + String(w.avgTurnMin).padStart(5) + ' мин'
      + ' | p90 ' + String(w.p90TurnMin).padStart(5) + ' мин'
      + ' | длинных ' + w.longTurnRate
      + ' | killed ' + w.killedRate
      + ' | отказы/сессия ' + w.refusalsPerSession
      + ' | петли/сессия ' + w.loopsPerSession);
  }
  return 0;
}

if (process.argv[1] && fileURLToPathSafe()) {
  process.exit(main());
}

function fileURLToPathSafe() {
  return String(process.argv[1]).endsWith('launch-metrics.mjs');
}
