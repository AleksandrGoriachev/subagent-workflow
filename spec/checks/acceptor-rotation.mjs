#!/usr/bin/env node
/*
 * Задание 0081: выбор ключа приёмщика при ротации.
 *
 * Дефект: task-accept брал ПЕРВУЮ запись acceptors.json с нужным keyId. После
 * ротации в файле живут две записи с одним keyId (retired+legacy и активная), и
 * подпись активным ключом падала «приватный ключ не соответствует закреплённому».
 * sign.mjs selectAcceptorEntry учитывает окна activeFrom/retiredAt — приёмка
 * должна спрашивать его, а не искать «первую».
 *
 *   c1 — retired+active: активная запись обязана победить;
 *   c2 — только retired: отдаётся как legacy с причиной;
 *   c3 — неизвестный keyId: записи нет.
 */
import crypto from 'node:crypto';

const CASE = process.argv[2] || 'c1';

function pem(pair) {
  return pair.publicKey.export({ type: 'spki', format: 'pem' }).toString();
}
const retired = { keyId: 'agent-judge', kind: 'agent', publicKeyPem: pem(crypto.generateKeyPairSync('ed25519')), createdAt: '2026-01-01T00:00:00.000Z', retiredAt: '2026-02-01T00:00:00.000Z', legacy: true };
const active = { keyId: 'agent-judge', kind: 'agent', publicKeyPem: pem(crypto.generateKeyPairSync('ed25519')), createdAt: '2026-02-01T00:00:00.000Z', activeFrom: '2026-02-01T00:00:00.000Z' };
const now = '2026-06-01T00:00:00.000Z';

async function load() {
  try {
    const module = await import('../scripts/lib/accept-key.mjs');
    if (typeof module.pickAcceptorEntry !== 'function') return null;
    return module.pickAcceptorEntry;
  } catch {
    return null;
  }
}

function fail(message) {
  console.log('FAIL ' + CASE + ': ' + message);
  return 1;
}

const pick = await load();
if (!pick) {
  console.log('FAIL ' + CASE + ': выбор ключа при ротации не реализован — приёмка ищет первую запись по keyId');
  process.exitCode = 1;
} else if (CASE === 'c2') {
  const result = pick([retired], 'agent-judge', now);
  if (!result.entry || result.entry.publicKeyPem !== retired.publicKeyPem) process.exitCode = fail('ожидалась retired-запись как legacy');
  else if (!result.legacy || !result.reason) process.exitCode = fail('retired-запись отдана без пометки legacy/причины');
  else { console.log('ACCEPTOR ROTATION OK c2'); process.exitCode = 0; }
} else if (CASE === 'c3') {
  const result = pick([retired, active], 'unknown-key', now);
  if (result.entry) process.exitCode = fail('неизвестный keyId вернул запись');
  else { console.log('ACCEPTOR ROTATION OK c3'); process.exitCode = 0; }
} else {
  const result = pick([retired, active], 'agent-judge', now);
  if (!result.entry) process.exitCode = fail('активная запись не найдена');
  else if (result.entry.publicKeyPem !== active.publicKeyPem) process.exitCode = fail('выбрана retired-запись вместо активной');
  else if (result.legacy) process.exitCode = fail('активная запись помечена legacy');
  else { console.log('ACCEPTOR ROTATION OK c1'); process.exitCode = 0; }
}
