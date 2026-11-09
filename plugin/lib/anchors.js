/**
 * 0111 (WC-77): утверждение якорей из DSH, а не из PowerShell.
 *
 * Решение заказчика 09.11: подпись якорей делает человек, но действие должно
 * жить в панели — переход в терминал ломает процесс и превращает утверждение в
 * ритуал. Ключ при этом остаётся человеческим (kind=human) и лежит вне
 * репозитория; панель лишь исполняет подпись по нажатию.
 *
 * Состояние читается той же проверкой движка (spec/checks/anchor-freshness.mjs),
 * чтобы панель и релизный гейт не разошлись в трактовке.
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { pathToFileURL } from 'node:url';

/** Путь с раскрытием %USERPROFILE% и ~ — конфиг не должен зависеть от шелла. */
export function expandPath(value) {
  const text = String(value || '').trim();
  if (text === '') return '';
  if (text.startsWith('~')) return path.join(os.homedir(), text.slice(1));
  return text.replace(/%([A-Z_]+)%/gu, (match, name) => (process.env[name] ? process.env[name] : match));
}

/** Где лежат якоря: конфиг панели перекрывает умолчания. */
export function anchorsConfig(root, config) {
  const base = path.resolve(String(root || '.'));
  const raw = config && typeof config.anchors === 'object' && config.anchors !== null ? config.anchors : {};
  /*
   * 0120: абсолютный fallback (ключ в профиле пользователя) нельзя склеивать с корнем
   * воркспейса — получался несуществующий путь, подпись молча не проходила.
   */
  const pick = (key, fallback) => {
    if (typeof raw[key] === 'string' && raw[key].trim() !== '') return expandPath(raw[key]);
    const expanded = expandPath(fallback);
    return path.isAbsolute(expanded) ? expanded : path.join(base, expanded);
  };
  return {
    file: pick('file', path.join('subagent-workflow-v2', 'docs', 'anchors.json')),
    approval: pick('approval', path.join('subagent-workflow-v2', 'docs', 'anchors.approval.json')),
    keyFile: pick('keyFile', path.join(os.homedir(), '.dsh', 'keys', 'human-user.key.pem')),
    keyId: typeof raw.keyId === 'string' && raw.keyId.trim() !== '' ? raw.keyId.trim() : 'human-user',
    acceptors: pick('acceptors', path.join('docs', 'subagent-workflow', 'acceptors.json')),
    scope: typeof raw.scope === 'string' && raw.scope.trim() !== '' ? raw.scope.trim() : 'project',
    /* 0130: словарь гейта structure (0194/1.0.68): layer, sides (область), enforcedBy. */
    layer: typeof raw.layer === 'string' && raw.layer.trim() !== '' ? raw.layer.trim() : 'contour',
    sides: typeof raw.sides === 'string' && raw.sides.trim() !== '' ? raw.sides.trim() : 'contour',
    enforcedBy: typeof raw.enforcedBy === 'string' && raw.enforcedBy.trim() !== '' ? raw.enforcedBy.trim() : 'both',
  };
}

/** sha256 файла: канон утверждения — байты как на диске. */
export function hashFile(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

/** Канон подписи — как в spec/scripts/sign.mjs: ключи объектов отсортированы. */
export function canonicalize(value) {
  if (Array.isArray(value)) return '[' + value.map(canonicalize).join(',') + ']';
  if (value !== null && typeof value === 'object') {
    const keys = Object.keys(value).sort();
    return '{' + keys.map((key) => JSON.stringify(key) + ':' + canonicalize(value[key])).join(',') + '}';
  }
  return JSON.stringify(value);
}

/** Проверка подписи по публичному ключу из acceptors.json. */
export function verifyApproval(approval, acceptors) {
  if (!approval || typeof approval !== 'object') return { ok: false, reason: 'нет утверждения' };
  /* 0130: keyId и значение подписи — в плоской (0.2) или вложенной (0.3) форме. */
  const nested = approval.signature && typeof approval.signature === 'object';
  const keyId = approval.keyId || (nested ? approval.signature.keyId : '');
  if (!keyId) return { ok: false, reason: 'в утверждении нет keyId' };
  const key = (Array.isArray(acceptors) ? acceptors : []).find((item) => item && item.keyId === keyId);
  if (!key) return { ok: false, reason: 'ключ ' + keyId + ' не найден в acceptors.json' };
  if (key.kind !== 'human') return { ok: false, reason: 'якоря утверждает человек (kind=human), а ключ ' + keyId + ' — ' + key.kind };
  try {
    /* 0130: вложенная форма покрывает ровно hash+by+at, плоская — весь документ. */
    const body = nested
      ? canonicalize({ hash: approval.hash, by: approval.by, at: approval.at })
      : canonicalize(Object.fromEntries(Object.entries(approval).filter(([field]) => !['signature', 'signatureAlgorithm', 'keyId', 'publicKeyFingerprint'].includes(field))));
    const value = nested ? approval.signature.value : approval.signature;
    if (nested && approval.signature.covers !== 'hash+by+at') return { ok: false, reason: 'signature.covers не покрывает hash+by+at' };
    const ok = crypto.verify(null, Buffer.from(body, 'utf8'), crypto.createPublicKey(key.publicKeyPem), Buffer.from(String(value || ''), 'base64'));
    return ok ? { ok: true, keyId } : { ok: false, reason: 'подпись не сходится с ключом ' + keyId };
  } catch (error) {
    return { ok: false, reason: 'подпись не проверяется: ' + (error && error.message ? error.message : String(error)) };
  }
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/u, ''));
  } catch {
    return null;
  }
}

/** Состояние утверждения для панели. */
export function anchorsStatus(root, config) {
  const cfg = anchorsConfig(root, config);
  if (!fs.existsSync(cfg.file)) {
    return { ok: false, approved: false, config: cfg, problems: ['якоря не найдены: ' + cfg.file] };
  }
  const hash = hashFile(cfg.file);
  /*
   * 0114: подписывать вслепую нельзя — панель отдаёт сам список, чтобы человек
   * прочитал его перед подписью. Плюс явно говорим, чьи это правила: они
   * принадлежат движку контура, а не проекту в корне.
   */
  const parsed = readJson(cfg.file) || {};
  const list = Array.isArray(parsed.anchors) ? parsed.anchors.map((anchor) => ({
    id: anchor && anchor.id ? String(anchor.id) : '',
    claim: anchor && anchor.claim ? String(anchor.claim) : '',
    /* 0124: схема 0.3 — панель показывает слой и исполнителя проверки, а не только «область». */
    layer: anchor && anchor.layer ? String(anchor.layer) : '',
    enforcedBy: anchor && anchor.enforcedBy ? String(anchor.enforcedBy) : '',
    sides: anchor && anchor.sides ? String(anchor.sides) : (anchor && anchor.scope ? String(anchor.scope) : ''),
    scope: anchor && anchor.scope ? String(anchor.scope) : '',
    status: anchor && anchor.status ? String(anchor.status) : '',
    confirmed: anchor && anchor.confirmed ? anchor.confirmed : null,
    check: anchor && anchor.check ? String(anchor.check) : '',
    owner: anchor && anchor.owner ? String(anchor.owner) : '',
  })) : [];
  const approval = readJson(cfg.approval);
  const acceptorsRaw = readJson(cfg.acceptors);
  const acceptors = acceptorsRaw && Array.isArray(acceptorsRaw.acceptors) ? acceptorsRaw.acceptors : [];
  if (!approval) {
    return { ok: true, approved: false, hash, file: cfg.file, approvalFile: cfg.approval, anchors: list, config: cfg, problems: ['якоря не утверждены: нет ' + path.basename(cfg.approval)] };
  }
  const signed = verifyApproval(approval, acceptors);
  const hashMatches = String(approval.hash || '') === hash;
  const approved = signed.ok && hashMatches;
  const problems = [];
  if (!signed.ok) problems.push(signed.reason);
  if (!hashMatches) problems.push('хеш утверждения не совпадает с anchors.json — якоря правились после подписи');
  return {
    ok: true,
    approved,
    hash,
    file: cfg.file,
    approvalFile: cfg.approval,
    anchors: list,
    keyId: approval.keyId || (approval.signature && typeof approval.signature === 'object' ? approval.signature.keyId : null) || null,
    at: approval.at || null,
    scope: approval.scope || null,
    config: cfg,
    problems,
  };
}

/**
 * Подписать утверждение человеческим ключом. Ключ читается с диска и не
 * покидает процесс; панель не хранит приватный материал.
 */
export function approveAnchors(root, config) {
  const cfg = anchorsConfig(root, config);
  const status = anchorsStatus(root, config);
  if (status.ok !== true || !status.hash) return { ok: false, problems: status.problems || ['якоря не читаются'] };
  if (!fs.existsSync(cfg.keyFile)) {
    return { ok: false, problems: ['нет человеческого ключа: ' + cfg.keyFile + ' — создайте его через sign.mjs keygen'] };
  }
  const acceptorsRaw = readJson(cfg.acceptors);
  const acceptors = acceptorsRaw && Array.isArray(acceptorsRaw.acceptors) ? acceptorsRaw.acceptors : [];
  const own = acceptors.find((item) => item && item.keyId === cfg.keyId);
  if (!own) return { ok: false, problems: ['ключ ' + cfg.keyId + ' не зарегистрирован в acceptors.json'] };
  if (own.kind !== 'human') return { ok: false, problems: ['ключ ' + cfg.keyId + ' имеет вид ' + own.kind + ': утверждать якоря может только человек'] };
  /*
   * 0130: форма утверждения — общая с гейтом structure (0194/1.0.68):
   * signature.covers = 'hash+by+at', подпись покрывает ровно эти три поля.
   * Плоская форма 0.2 читается как раньше — старые утверждения не ломаются.
   */
  const payload = { hash: status.hash, by: ['пользователь'], at: new Date().toISOString() };
  const privateKey = crypto.createPrivateKey(fs.readFileSync(cfg.keyFile, 'utf8'));
  const value = crypto.sign(null, Buffer.from(canonicalize(payload), 'utf8'), privateKey).toString('base64');
  const record = {
    version: 2,
    anchors: path.relative(path.dirname(path.dirname(cfg.file)), cfg.file).split(path.sep).join('/'),
    algo: 'sha256',
    hash: payload.hash,
    bytes: fs.statSync(cfg.file).size,
    layer: cfg.layer,
    sides: cfg.sides,
    enforcedBy: cfg.enforcedBy,
    by: payload.by,
    at: payload.at,
    publicKeyFingerprint: crypto.createHash('sha256').update(crypto.createPublicKey(privateKey).export({ type: 'spki', format: 'der' })).digest('hex').slice(0, 16),
    signature: { keyId: cfg.keyId, algo: 'ed25519', covers: 'hash+by+at', value },
  };
  fs.mkdirSync(path.dirname(cfg.approval), { recursive: true });
  fs.writeFileSync(cfg.approval, JSON.stringify(record, null, 2) + '\n');
  /* 0120: панель показывает состояние по верхним полям — отдаём их, а не только вложенный dashboard. */
  const dashboard = anchorsStatus(root, config);
  return { ...dashboard, ok: true, signed: true, hash: record.hash, keyId: cfg.keyId, at: record.at, file: cfg.approval, dashboard };
}

/** Прогон релизной проверки движка, если она доступна рядом. */
export async function runEngineCheck(root, config) {
  const cfg = anchorsConfig(root, config);
  const candidates = [
    path.join(path.dirname(path.dirname(cfg.file)), 'spec', 'checks', 'anchor-freshness.mjs'),
    path.join(path.resolve(String(root || '.')), 'docs', 'subagent-workflow', 'checks', 'anchor-freshness.mjs'),
  ];
  for (const candidate of candidates) {
    if (!fs.existsSync(candidate)) continue;
    try {
      const module = await import(pathToFileURL(candidate).href);
      return { ok: true, result: module.checkRepo(path.dirname(path.dirname(cfg.file))) };
    } catch (error) {
      return { ok: false, error: error && error.message ? error.message : String(error) };
    }
  }
  return { ok: false, error: 'проверка движка не найдена рядом с якорями' };
}
