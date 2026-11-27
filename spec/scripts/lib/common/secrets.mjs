/*
 * Секреты: шаблоны и скан диффа.
 *
 * 0181: часть spec/scripts/lib/common.mjs; публичный вход — common.mjs.
 */
export const SECRET_PATTERNS = [
  { name: 'telegram_bot_token', re: /\b\d{8,10}:[A-Za-z0-9_-]{30,}\b/g },
  { name: 'aws_access_key', re: /\bAKIA[0-9A-Z]{16}\b/g },
  { name: 'github_token', re: /\bgh[pousr]_[A-Za-z0-9]{20,}\b/g },
  { name: 'private_key', re: /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/g },
  { name: 'bearer_token', re: /\bBearer\s+[A-Za-z0-9._-]{20,}/g },
  /*
   * Значение, за которым сразу идёт «(», — вызов функции, а не секрет:
   * `const apiKey = validateProviderApiKey(...)` не должен блокировать прогон.
   */
  { name: 'generic_secret', re: /\b(?:api[_-]?key|secret|password|passwd|token)\b\s*[:=]\s*["']?([A-Za-z0-9_\-./+=]{16,})(?![A-Za-z0-9_\-./+=])["']?(?!\s*\()/gi },
];

export function scanSecrets(text) {
  const hits = [];
  const lines = String(text).split('\n');
  for (const { name, re } of SECRET_PATTERNS) {
    for (let i = 0; i < lines.length; i += 1) {
      re.lastIndex = 0;
      let m;
      while ((m = re.exec(lines[i])) !== null) {
        const value = (m[1] || m[0] || '').trim();
        if (/^(<.*>|\$\{.*\}|example|your|xxx+|changeme|redacted|\*+)$/i.test(value)) continue;
        if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) continue;
        hits.push({ name, line: i + 1, excerpt: lines[i].trim().slice(0, 160) });
        if (hits.length >= 20) return hits;
      }
    }
  }
  return hits;
}

export function truncate(text, max = 20000) {
  const s = String(text);
  return s.length <= max ? s : s.slice(0, max) + '\n…[truncated ' + (s.length - max) + ' chars]';
}

