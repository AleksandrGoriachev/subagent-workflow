#!/usr/bin/env node
/**
 * 0172: подпись утверждения структуры (аналог кнопки, которой нет).
 *
 * По дизайну structure (lib/structure-approval.js): подпись ставит владелец ВНЕ панели,
 * панель её только читает. Инструмента не было — этот скрипт его заменяет.
 *
 * Алгоритм (как в их модуле):
 *   hash = sha256 по отсортированным файлам structure/**;
 *   в хеш входит путь ВНУТРИ structure/ (прямые слэши) + NUL + байты файла;
 *   structure/approval.json в хеш не входит;
 *   подпись Ed25519 по canonical({hash, by, at}), covers = 'hash+by+at'.
 *
 * По умолчанию — dry-run: считает хеш и печатает, что будет подписано. --write пишет.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

function canonical(value) {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value !== null && typeof value === 'object') {
    const keys = Object.keys(value).sort();
    return '{' + keys.map((key) => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}';
  }
  return JSON.stringify(value);
}

export function structureFiles(root) {
  const dir = path.join(String(root), 'structure');
  const out = [];
  const walk = (current, rel) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const abs = path.join(current, entry.name);
      const next = rel === '' ? entry.name : rel + '/' + entry.name;
      if (entry.isDirectory()) walk(abs, next);
      else if (entry.isFile()) out.push({ rel: next.replace(/\\/gu, '/'), abs });
    }
  };
  walk(dir, '');
  return out
    .filter((item) => item.rel !== 'approval.json')
    .sort((a, b) => a.rel.localeCompare(b.rel));
}

export function structureHash(root) {
  const hash = crypto.createHash('sha256');
  for (const file of structureFiles(root)) {
    hash.update(file.rel, 'utf8');
    hash.update(Buffer.from([0]));
    hash.update(fs.readFileSync(file.abs));
  }
  return hash.digest('hex');
}

export function signStructure(root, { privateKeyPem, keyId, by = ['пользователь'], at = new Date().toISOString() }) {
  const hash = structureHash(root);
  const body = canonical({ hash, by, at });
  const value = crypto.sign(null, Buffer.from(body, 'utf8'), crypto.createPrivateKey(privateKeyPem)).toString('base64');
  return {
    version: 1,
    algo: 'sha256',
    hash,
    by,
    at,
    signature: { keyId, algo: 'ed25519', covers: 'hash+by+at', value },
  };
}

if (process.argv[1] && process.argv[1].endsWith('structure-approve.mjs')) {
  const argv = process.argv.slice(2);
  const value = (flag) => { const index = argv.indexOf(flag); return index >= 0 ? argv[index + 1] : undefined; };
  const root = value('--root') || process.cwd();
  const keyFile = value('--key');
  const keyId = value('--key-id') || 'human-1';
  const write = argv.includes('--write');
  if (!keyFile || !fs.existsSync(keyFile)) {
    console.log('нужен --key <приватный ключ владельца> (например .wf-keys/human-1.key.pem)');
    process.exitCode = 2;
  } else {
    const approval = signStructure(root, { privateKeyPem: fs.readFileSync(keyFile, 'utf8'), keyId });
    const text = JSON.stringify(approval, null, 2) + '\n';
    console.log('structure hash: ' + approval.hash);
    console.log('keyId: ' + keyId + ' | at: ' + approval.at);
    if (!write) {
      console.log('');
      console.log('dry-run. Будет записано в structure/approval.json:');
      console.log(text);
      console.log('Для записи добавьте --write (это акт владельца).');
    } else {
      fs.writeFileSync(path.join(String(root), 'structure', 'approval.json'), text);
      console.log('записано: ' + path.join(String(root), 'structure', 'approval.json'));
    }
  }
}