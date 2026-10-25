#!/usr/bin/env node
/*
 * Ed25519 для записи о приёмке.
 *
 * Подписывается каноническая форма записи без полей подписи: ключи объектов
 * сортируются лексикографически, отступов нет, UTF-8. Проверка возможна по
 * публичному ключу, без секрета — в этом смысл асимметричной подписи.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export function canonicalize(value) {
  if (Array.isArray(value)) return '[' + value.map(canonicalize).join(',') + ']';
  if (value !== null && typeof value === 'object') {
    const keys = Object.keys(value).sort();
    return '{' + keys.map((key) => JSON.stringify(key) + ':' + canonicalize(value[key])).join(',') + '}';
  }
  return JSON.stringify(value);
}

export function publicKeyFingerprint(publicKeyPem) {
  const key = crypto.createPublicKey(publicKeyPem);
  const der = key.export({ type: 'spki', format: 'der' });
  return crypto.createHash('sha256').update(der).digest('hex').slice(0, 16);
}

export function generateKeyPair() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  return {
    privateKeyPem: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
    publicKeyPem: publicKey.export({ type: 'spki', format: 'pem' }).toString(),
  };
}

const SIGNATURE_FIELDS = ['signature', 'signatureAlgorithm', 'keyId', 'publicKeyFingerprint'];

export function signingBody(record) {
  const copy = { ...record };
  for (const field of SIGNATURE_FIELDS) delete copy[field];
  return canonicalize(copy);
}

export function signRecord(record, { privateKeyPem, keyId }) {
  const publicKeyPem = crypto.createPublicKey(privateKeyPem).export({ type: 'spki', format: 'pem' }).toString();
  const body = signingBody(record);
  const signature = crypto
    .sign(null, Buffer.from(body, 'utf8'), crypto.createPrivateKey(privateKeyPem))
    .toString('base64');
  return {
    ...record,
    signatureAlgorithm: 'ed25519',
    keyId,
    publicKeyFingerprint: publicKeyFingerprint(publicKeyPem),
    signature,
  };
}

export function verifyRecord(record, publicKeyPem) {
  if (record.signatureAlgorithm !== 'ed25519') return false;
  if (typeof record.signature !== 'string' || record.signature.length === 0) return false;
  try {
    const body = signingBody(record);
    return crypto.verify(
      null,
      Buffer.from(body, 'utf8'),
      crypto.createPublicKey(publicKeyPem),
      Buffer.from(record.signature, 'base64'),
    );
  } catch {
    return false;
  }
}

export function readJsonFile(file) {
  /* Windows-инструменты любят писать BOM: JSON.parse на нём падает. */
  return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
}

export function loadAcceptors(file) {
  const parsed = readJsonFile(file);
  const list = Array.isArray(parsed) ? parsed : parsed.acceptors;
  if (!Array.isArray(list)) throw new Error('acceptors.json: ожидается { "acceptors": [...] }');
  for (const item of list) {
    if (!item.keyId || !item.publicKeyPem) throw new Error('acceptors.json: у ключа нет keyId или publicKeyPem');
    if (item.kind !== 'agent' && item.kind !== 'human') throw new Error('acceptors.json: kind должен быть agent или human (' + item.keyId + ')');
  }
  return list;
}

function fail(message) {
  console.error('sign: ' + message);
  process.exit(1);
}

function args(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith('--')) { out[a.slice(2)] = next; i += 1; }
      else out[a.slice(2)] = true;
    } else out._.push(a);
  }
  return out;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const argv = args(process.argv.slice(2));
  const cmd = argv._[0];
  if (cmd === 'keygen') {
    const outDir = path.resolve(argv['out-dir'] || '.keys');
    const id = String(argv.id || '');
    if (!/^[a-z0-9][a-z0-9-]{1,40}$/.test(id)) fail('--id: строчные латинские, цифры и дефис');
    const { privateKeyPem, publicKeyPem } = generateKeyPair();
    fs.mkdirSync(outDir, { recursive: true });
    const priv = path.join(outDir, id + '.key.pem');
    const pub = path.join(outDir, id + '.pub.pem');
    fs.writeFileSync(priv, privateKeyPem, { mode: 0o600 });
    fs.writeFileSync(pub, publicKeyPem, { mode: 0o644 });
    console.log(JSON.stringify({ keyId: id, privateKey: priv, publicKey: pub, fingerprint: publicKeyFingerprint(publicKeyPem) }, null, 2));
    process.exit(0);
  }
  if (cmd === 'sign') {
    if (!argv.file || !argv.key || !argv.id) fail('sign --file <record.json> --key <private.pem> --id <keyId>');
    const record = readJsonFile(argv.file);
    const signed = signRecord(record, { privateKeyPem: fs.readFileSync(argv.key, 'utf8'), keyId: String(argv.id) });
    fs.writeFileSync(argv.file, JSON.stringify(signed, null, 2) + '\n');
    console.log('sign: подписано ' + argv.file + ' ключом ' + argv.id);
    process.exit(0);
  }
  if (cmd === 'verify') {
    if (!argv.file || !argv.public) fail('verify --file <record.json> --public <public.pem>');
    const record = readJsonFile(argv.file);
    const ok = verifyRecord(record, fs.readFileSync(argv.public, 'utf8'));
    if (!ok) fail('подпись не совпадает');
    console.log('sign: подпись верна (' + record.keyId + ')');
    process.exit(0);
  }
  if (cmd === 'fingerprint') {
    if (!argv.public) fail('fingerprint --public <public.pem>');
    console.log(publicKeyFingerprint(fs.readFileSync(argv.public, 'utf8')));
    process.exit(0);
  }
  console.log('Usage: sign.mjs keygen --id <keyId> [--out-dir .keys]');
  console.log('       sign.mjs sign --file <record.json> --key <private.pem> --id <keyId>');
  console.log('       sign.mjs verify --file <record.json> --public <public.pem>');
  console.log('       sign.mjs fingerprint --public <public.pem>');
}
