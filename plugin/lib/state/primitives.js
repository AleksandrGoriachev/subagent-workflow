/*
 * Примитивы: пути, канонический JSON, sha256, безопасное чтение.
 *
 * 0179: часть state.js; публичный вход — plugin/lib/state.js (баррель).
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
/* ------------------------------------------------------------------ *
 * primitives
 * ------------------------------------------------------------------ */

export function toPosix(value) {
  return String(value).replace(/\\/g, '/');
}

export function fromPosix(value) {
  return String(value).split('/').join(path.sep);
}

/** Same text normalization the gates hash: CRLF -> LF, trim trailing blanks. */
export function canonicalize(text) {
  return String(text)
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.replace(/[ \t]+$/g, ''))
    .join('\n')
    .replace(/^\n+/, '')
    .replace(/\n+$/, '') + '\n';
}

export function sha256Text(text) {
  return crypto.createHash('sha256').update(String(text), 'utf8').digest('hex');
}

export function sha256Bytes(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

export function exists(file) {
  try {
    fs.accessSync(file);
    return true;
  } catch {
    return false;
  }
}

/**
 * Read text and drop a BOM. UTF-8 is the normative encoding; UTF-16LE/BE is
 * accepted too because real repositories contain artifacts written by Windows
 * PowerShell (`FF FE` BOM), and a read-only viewer must not lose the record.
 */
export function readText(file) {
  const buffer = fs.readFileSync(file);
  if (buffer.length >= 2 && buffer[0] === 0xff && buffer[1] === 0xfe) {
    return buffer.toString('utf16le').replace(/^\uFEFF/u, '');
  }
  if (buffer.length >= 2 && buffer[0] === 0xfe && buffer[1] === 0xff) {
    const swapped = Buffer.from(buffer);
    swapped.swap16();
    return swapped.toString('utf16le').replace(/^\uFEFF/u, '');
  }
  const text = buffer.toString('utf8');
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

export function readJsonSafe(file) {
  if (!exists(file)) return { value: null, error: null };
  try {
    return { value: JSON.parse(readText(file)), error: null };
  } catch (error) {
    return { value: null, error: String(error && error.message ? error.message : error) };
  }
}

