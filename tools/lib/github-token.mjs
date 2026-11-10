/**
 * Токен GitHub для инструментов выпуска (0105 / WC-68).
 *
 * Порядок: GITHUB_TOKEN, GH_TOKEN, затем git credential fill (как делали
 * publish-скрипты). Токен никогда не печатается и не пишется в файлы.
 */
/* 0143: без пайпов — в ограниченной сессии DSH spawn с pipe даёт EPERM (WC-37/39). */
import { spawnSyncPipeFree } from '../../spec/scripts/lib/common.mjs';

export function githubToken(env = process.env) {
  const fromEnv = env.GITHUB_TOKEN && String(env.GITHUB_TOKEN).trim();
  if (fromEnv) return fromEnv;
  const gh = env.GH_TOKEN && String(env.GH_TOKEN).trim();
  if (gh) return gh;
  try {
    const result = spawnSyncPipeFree('git', ['credential', 'fill'], {
      input: 'protocol=https\nhost=github.com\n\n',
      encoding: 'utf8',
    });
    if (result.status !== 0) return null;
    const line = String(result.stdout || '').split('\n').find((row) => row.startsWith('password='));
    return line ? line.slice('password='.length).trim() : null;
  } catch {
    return null;
  }
}

export function requireToken(env = process.env) {
  const token = githubToken(env);
  if (!token) {
    throw new Error('нет токена GitHub: задайте GITHUB_TOKEN или git credential fill для github.com');
  }
  return token;
}
