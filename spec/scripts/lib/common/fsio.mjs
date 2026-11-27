/*
 * Пути и файлы: posix-пути, чтение/запись, канонический JSON, sha256.
 *
 * 0181: часть spec/scripts/lib/common.mjs; публичный вход — common.mjs.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fail } from './cli.mjs';
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

