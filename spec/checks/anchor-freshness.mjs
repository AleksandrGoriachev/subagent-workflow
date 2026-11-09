#!/usr/bin/env node
/**
 * 0107 (WC-70): свежесть и утверждение якорей — механическая проверка.
 *
 * Зачем: якорь, который никто не перепроверяет, через месяц врёт; якоря без
 * утверждения — это текст, который правит любой. Проверка делает оба состояния
 * видимыми машине:
 *
 *  1. anchors.approval.json обязан существовать и его hash обязан совпадать с
 *     sha256(anchors.json) — иначе якоря не утверждены (правка = переутверждение);
 *  2. якорь в статусе auto/semi не должен быть старше порога из freshness
 *     (дни и релизы); версия подтверждения сравнивается с тегами репозитория;
 *  3. якорь без confirm у auto/semi — ошибка; inWork в счёт не идёт, но виден
 *     в отчёте как незакрытый.
 *
 * Ответственность (решение заказчика 09.11): соблюдение якорей — на координаторе,
 * проверку соблюдения исполняют узлы (аудитор/ревьювер), эта проверка — механический
 * минимум для релиза.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { verifyRecord, loadAcceptors } from '../scripts/sign.mjs';

export const ANCHORS_FILE = 'docs/anchors.json';
export const APPROVAL_FILE = 'docs/anchors.approval.json';

/** sha256 файла: канон утверждения — байты как на диске. */
export function sha256File(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

/** Разбор версии в числа: 2.6.10 > 2.6.9. */
export function versionParts(value) {
  const text = String(value === null || value === undefined ? '' : value).trim().replace(/^v/iu, '');
  if (text === '') return null;
  return text.split('.').map((part) => {
    const number = Number.parseInt(part, 10);
    return Number.isFinite(number) ? number : 0;
  });
}

/** Сравнение версий: -1 | 0 | 1. Пустая версия считается меньшей. */
export function compareVersions(left, right) {
  const a = versionParts(left);
  const b = versionParts(right);
  if (a === null && b === null) return 0;
  if (a === null) return -1;
  if (b === null) return 1;
  const length = Math.max(a.length, b.length);
  for (let i = 0; i < length; i += 1) {
    const l = a[i] || 0;
    const r = b[i] || 0;
    if (l < r) return -1;
    if (l > r) return 1;
  }
  return 0;
}

/** Теги релизов из git: без сети, без догадок. */
export function releaseTags(root) {
  try {
    const out = execFileSync('git', ['tag', '--list', 'v*'], { cwd: root, encoding: 'utf8' });
    return out.split('\n').map((line) => line.trim()).filter(Boolean);
  } catch {
    return [];
  }
}

/** Сколько релизов вышло после указанной версии. */
export function releasesSince(tags, version) {
  if (!version) return null;
  return tags.filter((tag) => compareVersions(tag, version) > 0).length;
}

/**
 * Проверка одного набора.
 * @param {{anchors: object, approval: object|null, approvalHash: string|null, sha: string,
 *          now: Date, tags: string[], overrides?: object}} input
 * @returns {{ok: boolean, problems: string[], notes: string[], stale: string[], unconfirmed: string[]}}
 */
/**
 * 0110: утверждение подписывает человек. Хеш сам по себе копируется, поэтому
 * approval.json без валидной подписи human-ключа не считается утверждением.
 */
export function checkSignature(approval, acceptors) {
  if (!approval || typeof approval !== 'object') return { ok: false, reason: 'нет approval.json' };
  const keyId = approval.keyId || (approval.signature && approval.signature.keyId);
  if (!keyId) return { ok: false, reason: 'в approval.json нет keyId — подпись не привязана к ключу' };
  const list = Array.isArray(acceptors) ? acceptors : [];
  const key = list.find((item) => item && item.keyId === keyId);
  if (!key) return { ok: false, reason: 'ключ ' + keyId + ' не найден в acceptors.json' };
  if (key.kind !== 'human') return { ok: false, reason: 'утверждение якорей подписывает человек (kind=human), а ключ ' + keyId + ' — ' + key.kind };
  if (!verifyRecord(approval, key.publicKeyPem)) return { ok: false, reason: 'подпись approval.json не сходится с ключом ' + keyId };
  return { ok: true, keyId };
}

export function evaluateAnchors(input) {
  const problems = [];
  const notes = [];
  const stale = [];
  const unconfirmed = [];
  const anchors = input && input.anchors ? input.anchors : {};
  const list = Array.isArray(anchors.anchors) ? anchors.anchors : [];
  const thresholds = anchors.freshness && typeof anchors.freshness === 'object' ? anchors.freshness : {};
  const now = input.now instanceof Date ? input.now : new Date();

  if (list.length === 0) problems.push('anchors.json: нет ни одного якоря');
  if (!input.approval) problems.push('нет ' + APPROVAL_FILE + ': якоря не утверждены');
  else if (input.acceptors !== undefined) {
    const signed = checkSignature(input.approval, input.acceptors);
    if (!signed.ok) problems.push('approval: ' + signed.reason);
    else notes.push('approval подписан ключом ' + signed.keyId);
  }
  else if (!input.sha || !input.approvalHash) problems.push('approval: нет hash — утверждение не проверяемо');
  else if (input.sha !== input.approvalHash) {
    problems.push('approval: hash не совпадает с anchors.json (' + String(input.approvalHash).slice(0, 12) + '… != ' + String(input.sha).slice(0, 12) + '…) — якоря правились после утверждения');
  }

  for (const anchor of list) {
    const id = String(anchor && anchor.id ? anchor.id : '(без id)');
    const status = String(anchor && anchor.status ? anchor.status : '').trim();
    const confirmed = anchor && anchor.confirmed && typeof anchor.confirmed === 'object' ? anchor.confirmed : {};
    if (status === 'inWork') {
      notes.push(id + ': в работе, в счёт свежести не идёт');
      continue;
    }
    if (!confirmed.version || !confirmed.date) {
      problems.push(id + ': нет confirmed{version,date} при статусе ' + (status || '(пусто)'));
      unconfirmed.push(id);
      continue;
    }
    const rules = thresholds[status];
    if (!rules) {
      problems.push(id + ': неизвестный статус «' + status + '» — freshness не определён');
      continue;
    }
    const ageDays = Math.floor((now.getTime() - Date.parse(confirmed.date)) / 86400000);
    if (Number.isFinite(rules.maxAgeDays) && ageDays > rules.maxAgeDays) {
      stale.push(id + ': ' + ageDays + ' дней > ' + rules.maxAgeDays);
      problems.push(id + ': подтверждение старше ' + rules.maxAgeDays + ' дней (' + ageDays + ')');
    }
    const since = releasesSince(input.tags || [], confirmed.version);
    if (Number.isFinite(rules.maxReleases) && since !== null && since > rules.maxReleases) {
      stale.push(id + ': ' + since + ' релизов > ' + rules.maxReleases);
      problems.push(id + ': после подтверждения вышло ' + since + ' релизов (порог ' + rules.maxReleases + ')');
    }
  }
  return { ok: problems.length === 0, problems, notes, stale, unconfirmed };
}

/** Прочитать набор и утверждение из репозитория. */
export function loadRepo(root) {
  const repo = path.resolve(String(root || '.'));
  const anchorsFile = path.join(repo, ANCHORS_FILE);
  const approvalFile = path.join(repo, APPROVAL_FILE);
  const sha = sha256File(anchorsFile);
  const anchors = JSON.parse(fs.readFileSync(anchorsFile, 'utf8'));
  let approval = null;
  try {
    approval = JSON.parse(fs.readFileSync(approvalFile, 'utf8').replace(/^\uFEFF/u, ''));
  } catch {
    approval = null;
  }
  /*
   * Якоря живут в репозитории движка, а ключи приёмки — в развёрнутом
   * пространстве. Ищем по известным местам; WF_ACCEPTORS перекрывает поиск.
   */
  const candidates = [
    process.env.WF_ACCEPTORS,
    path.join(repo, 'docs', 'subagent-workflow', 'acceptors.json'),
    path.join(path.dirname(repo), 'docs', 'subagent-workflow', 'acceptors.json'),
    path.join(repo, 'docs', 'acceptors.json'),
  ].filter(Boolean);
  let acceptors = null;
  for (const candidate of candidates) {
    try {
      if (!fs.existsSync(candidate)) continue;
      acceptors = loadAcceptors(candidate);
      break;
    } catch {
      acceptors = null;
    }
  }
  return { repo, anchors, approval, acceptors, sha, approvalHash: approval && approval.hash ? String(approval.hash) : null, tags: releaseTags(repo) };
}

/**
 * Проверить репозиторий целиком.
 * @param {string} root
 * @param {{now?: Date, tags?: string[]}} [options]
 */
export function checkRepo(root, options = {}) {
  let loaded;
  try {
    loaded = loadRepo(root);
  } catch (error) {
    return { ok: false, problems: ['не читается набор якорей: ' + (error && error.message ? error.message : String(error))], notes: [], stale: [], unconfirmed: [] };
  }
  return evaluateAnchors({
    anchors: loaded.anchors,
    approval: loaded.approval,
    sha: loaded.sha,
    approvalHash: loaded.approvalHash,
    acceptors: loaded.acceptors,
    now: options.now instanceof Date ? options.now : new Date(),
    tags: Array.isArray(options.tags) ? options.tags : loaded.tags,
  });
}

function parseArgs(argv) {
  const result = { repo: process.cwd(), now: null, tags: null };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--repo' && argv[i + 1]) { result.repo = argv[i + 1]; i += 1; continue; }
    if (arg === '--now' && argv[i + 1]) { result.now = new Date(argv[i + 1]); i += 1; continue; }
    if (arg === '--releases' && argv[i + 1]) { result.tags = Array.from({ length: Number(argv[i + 1]) || 0 }, (_, index) => 'v99.' + index + '.0'); i += 1; continue; }
  }
  return result;
}

if (process.argv[1] && new URL(import.meta.url).href.endsWith(new URL('file://' + path.resolve(process.argv[1]).split(path.sep).join('/')).href.split('/').pop())) {
  const args = parseArgs(process.argv.slice(2));
  const result = checkRepo(args.repo, { now: args.now || undefined, tags: args.tags || undefined });
  for (const note of result.notes) console.log('NOTE ' + note);
  for (const problem of result.problems) console.log('ANCHORS ERROR ' + problem);
  if (result.ok) console.log('anchor-freshness: OK — якоря утверждены и не протухли');
  else process.exitCode = 1;
}