/**
 * Чистые операции с релизным архивом движка (0067).
 *
 * Модуль не запускает процессов и не ходит в сеть: gzip разворачивается
 * zlib.gunzipSync, tar читается как формат ustar (имя 0..100, размер 124..136,
 * typeflag 156, prefix 345..500). Каталоги в результат не попадают: Map — это
 * файлы, которые панель потом пишет на диск.
 */
import crypto from 'node:crypto';
import zlib from 'node:zlib';

/** sha256 в нижнем регистре hex — тот же формат, что у .sha256 из релиза. */
export function sha256Hex(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function field(buffer, start, end) {
  const slice = buffer.subarray(start, Math.min(end, buffer.length));
  const zero = slice.indexOf(0);
  return slice.subarray(0, zero === -1 ? slice.length : zero).toString('utf8').trim();
}

function octalField(buffer, start, end) {
  const text = field(buffer, start, end);
  if (text === '') return 0;
  const value = Number.parseInt(text, 8);
  return Number.isFinite(value) && value >= 0 ? value : 0;
}

/**
 * Развернуть .tar.gz в Map<путь, Buffer>.
 *
 * Регулярные файлы (typeflag '0' или NUL) попадают в Map, каталоги ('5') —
 * нет. Служебные заголовки PAX/GNU ('x', 'g', 'L') пропускаются вместе с их
 * данными. Данные выровнены по 512 байт; хвост из нулевых блоков игнорируется.
 *
 * @param {Buffer} buffer содержимое .tar.gz
 * @returns {Map<string, Buffer>}
 */
export function extractTarGz(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
    throw new Error('архив движка пуст');
  }
  let tar;
  try {
    tar = zlib.gunzipSync(buffer);
  } catch (error) {
    throw new Error('не удалось распаковать gzip: ' + (error && error.message ? error.message : String(error)));
  }
  const files = new Map();
  let offset = 0;
  while (offset + 512 <= tar.length) {
    const header = tar.subarray(offset, offset + 512);
    offset += 512;
    const name = field(header, 0, 100);
    const prefix = field(header, 345, 500);
    const size = octalField(header, 124, 136);
    const typeflag = header[156] === 0 ? '0' : String.fromCharCode(header[156]);
    const dataStart = offset;
    const dataEnd = dataStart + size;
    /* Данные выровнены по 512, но архив может быть обрезан — читаем что есть. */
    offset = dataStart + Math.ceil(size / 512) * 512;
    if (name === '' && prefix === '') break;
    if (typeflag !== '0') continue;
    const path = prefix !== '' ? prefix + '/' + name : name;
    if (path === '') continue;
    files.set(path, tar.subarray(dataStart, Math.min(dataEnd, tar.length)));
  }
  return files;
}
