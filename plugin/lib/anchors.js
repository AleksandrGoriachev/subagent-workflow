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
  const pick = (key, fallback) => (typeof raw[key] === 'string' && raw[key].trim() !== '' ? expandPath(raw[key]) : path.join(base, fallback));
  return {
    file: pick('file', path.join('subagent-workflow-v2', 'docs', 'anchors.json')),
    approval: pick('approval', path.join('subagent-workflow-v2', 'docs', 'anchors.approval.json')),
    keyFile: pick('keyFile', path.join(os.homedir(), '.dsh', 'keys', 'human-user.key.pem')),
    keyId: typeof raw.keyId === 'string' && raw.keyId.trim() !== '' ? raw.keyId.trim() : 'human-user',
    acceptors: pick('acceptors', path.join('docs', 'subagent-workflow', 'acceptors.json')),
    scope: typeof raw.scope === 'string' && raw.scope.trim() !== '' ? raw.scope.trim() : 'project',
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
  const keyId = approval.keyId || (approval.signature && approval.signature.keyId);
  if (!keyId) return { ok: false, reason: 'в утверждении нет keyId' };
  const key = (Array.isArray(acceptors) ? acceptors : []).find((item) => item && item.keyId === keyId);
  if (!key) return { ok: false, reason: 'ключ ' + keyId + ' не найден в acceptors.json' };
  if (key.kind !== 'human') return { ok: false, reason: 'якоря утверждает человек (kind=human), а ключ ' + keyId + ' — ' + key.kind };
  try {
    const copy = { ...approval };
    for (const field of ['signature', 'signatureAlgorithm', 'keyId', 'publicKeyFingerprint']) delete copy[field];
    const body = canonicalize(copy);
    const ok = crypto.verify(null, Buffer.from(body, 'utf8'), crypto.createPublicKey(key.publicKeyPem), Buffer.from(String(approval.signature || ''), 'base64'));
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
  const approval = readJson(cfg.approval);
  const acceptorsRaw = readJson(cfg.acceptors);
  const acceptors = acceptorsRaw && Array.isArray(acceptorsRaw.acceptors) ? acceptorsRaw.acceptors : [];
  if (!approval) {
    return { ok: true, approved: false, hash, file: cfg.file, approvalFile: cfg.approval, config: cfg, problems: ['якоря не утверждены: нет ' + path.basename(cfg.approval)] };
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
    keyId: approval.keyId || null,
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
  const body = {
    version: 1,
    anchors: path.relative(path.dirname(path.dirname(cfg.file)), cfg.file).split(path.sep).join('/'),
    algo: 'sha256',
    hash: status.hash,
    bytes: fs.statSync(cfg.file).size,
    scope: cfg.scope,
    by: ['пользователь'],
    at: new Date().toISOString(),
  };
  const privateKey = crypto.createPrivateKey(fs.readFileSync(cfg.keyFile, 'utf8'));
  const signature = crypto.sign(null, Buffer.from(canonicalize(body), 'utf8'), privateKey).toString('base64');
  const record = {
    ...body,
    signatureAlgorithm: 'ed25519',
    keyId: cfg.keyId,
    publicKeyFingerprint: crypto.createHash('sha256').update(crypto.createPublicKey(privateKey).export({ type: 'spki', format: 'der' })).digest('hex').slice(0, 16),
    signature,
  };
  fs.mkdirSync(path.dirname(cfg.approval), { recursive: true });
  fs.writeFileSync(cfg.approval, JSON.stringify(record, null, 2) + '\n');
  return { ok: true, hash: record.hash, keyId: record.keyId, at: record.at, file: cfg.approval, dashboard: anchorsStatus(root, config) };
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
