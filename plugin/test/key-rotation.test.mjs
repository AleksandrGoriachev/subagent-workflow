/**
 * 0162: ротация ключа приёмщика.
 *
 * c1: ключ выбирается по дате подписи (старая эпоха → legacy);
 * c2: для новой записи берётся действующий ключ и подпись сходится;
 * c3: историческая запись не считается подделкой — проверка даёт WARN, не ERROR.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { selectAcceptorEntry, signRecord, verifyRecord, publicKeyFingerprint } from '../../spec/scripts/sign.mjs';

function fixture() {
  const { publicKey, privateKey } = cryptoKeys();
  return {
    oldEntry: { keyId: 'agent-judge', kind: 'agent', publicKeyPem: 'old', fingerprint: 'old000', retiredAt: '2026-11-11T00:00:00Z', legacy: true },
    newEntry: { keyId: 'agent-judge', kind: 'agent', publicKeyPem: publicKey, fingerprint: publicKeyFingerprint(publicKey), activeFrom: '2026-11-11T00:00:00Z' },
    privateKey,
  };
}

function cryptoKeys() {
  const pair = crypto.generateKeyPairSync('ed25519');
  return {
    publicKey: pair.publicKey.export({ type: 'spki', format: 'pem' }),
    privateKey: pair.privateKey.export({ type: 'pkcs8', format: 'pem' }),
  };
}

test('c1: старая эпоха выбирается как legacy', () => {
  const f = fixture();
  const picked = selectAcceptorEntry([f.oldEntry, f.newEntry], 'agent-judge', '2026-10-30T10:00:00Z');
  assert.equal(picked.entry.fingerprint, 'old000');
  assert.equal(picked.legacy, true);
});

test('c2: новая запись подписывается и проверяется действующим ключом', () => {
  const f = fixture();
  const record = signRecord({ hash: 'h', by: 'acceptor', at: '2026-11-11T01:00:00Z', status: 'accepted' }, { privateKeyPem: f.privateKey, keyId: 'agent-judge' });
  const picked = selectAcceptorEntry([f.oldEntry, f.newEntry], 'agent-judge', record.at);
  assert.equal(picked.legacy, false);
  assert.equal(verifyRecord(record, picked.entry.publicKeyPem), true);
});

test('c3: после ротации историческая запись даёт legacy, а не подделку', () => {
  const f = fixture();
  const picked = selectAcceptorEntry([f.oldEntry, f.newEntry], 'agent-judge', '2026-11-10T10:00:00Z');
  assert.equal(picked.legacy, true);
  assert.match(String(picked.reason), /утерян/u);
});