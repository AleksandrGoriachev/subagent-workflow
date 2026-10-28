/**
 * The panel's single write: guard.enabled in workflow.config.json, plus one line
 * in guard.log.
 *
 * Everything else in the config stays byte-for-byte: the flag is changed by a
 * surgical text splice, not by re-serialising the parsed object. Re-serialising
 * would silently reformat policy/roles/models — the very fields the repository
 * owner edits by hand — and the log line is what makes the write auditable
 * (invariant I-29: the source records both transitions, on and off).
 *
 * The log line is '<ISO time> enabled=true|false actor=<session|unknown>'.
 */
import fs from 'node:fs';
import path from 'node:path';

export const GUARD_CONFIG_REL = 'docs/subagent-workflow/workflow.config.json';
export const GUARD_LOG_REL = 'docs/subagent-workflow/guard.log';
export const GUARD_MODES = ['fail', 'warn', 'off'];
export const DEFAULT_BYPASS_MARKER = 'workflow-bypass';

/** Absolute paths the guard touches inside a repository. */
export function guardPaths(root) {
  const repo = path.resolve(String(root || '.'));
  return {
    root: repo,
    configPath: path.join(repo, GUARD_CONFIG_REL),
    logPath: path.join(repo, GUARD_LOG_REL),
  };
}

function actorOf(env = process.env) {
  const value = env && env.DSH_SESSION_ID;
  const text = value === undefined || value === null ? '' : String(value).trim();
  return text === '' ? 'unknown' : text;
}

function guardBlock(config) {
  const raw = config && config.guard;
  return raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
}

/** Read-only view for the panel: effective values, not the raw file. */
export function readGuard(root) {
  const paths = guardPaths(root);
  let config = null;
  let error = null;
  try {
    config = JSON.parse(fs.readFileSync(paths.configPath, 'utf8'));
  } catch (failure) {
    error = failure && failure.message ? failure.message : String(failure);
  }
  const block = guardBlock(config);
  return {
    root: paths.root,
    configPath: paths.configPath,
    logPath: paths.logPath,
    configLoaded: config !== null,
    error,
    enabled: block.enabled === true,
    mode: GUARD_MODES.includes(block.mode) ? block.mode : 'fail',
    allow: Array.isArray(block.allow) ? block.allow.map(String) : [],
    bypassMarker: typeof block.bypassMarker === 'string' && block.bypassMarker.trim() !== ''
      ? block.bypassMarker.trim()
      : DEFAULT_BYPASS_MARKER,
  };
}

/* ------------------------------------------------------------------ *
 * JSON text surgery (keeps every other byte in place)
 * ------------------------------------------------------------------ */

function skipWs(text, index, end) {
  let i = index;
  while (i < end && /\s/.test(text[i])) i += 1;
  return i;
}

function skipString(text, index) {
  let i = index + 1;
  while (i < text.length) {
    const ch = text[i];
    if (ch === '\\') {
      i += 2;
      continue;
    }
    if (ch === '"') return i + 1;
    i += 1;
  }
  return i;
}

function skipValue(text, index, end) {
  let i = index;
  let depth = 0;
  while (i < end) {
    const ch = text[i];
    if (ch === '"') {
      i = skipString(text, i);
      continue;
    }
    if (ch === '{' || ch === '[') {
      depth += 1;
      i += 1;
      continue;
    }
    if (ch === '}' || ch === ']') {
      if (depth === 0) return i;
      depth -= 1;
      i += 1;
      continue;
    }
    if (depth === 0 && ch === ',') return i;
    i += 1;
  }
  return end;
}

function topLevelBounds(text) {
  const start = text.indexOf('{');
  if (start < 0) throw new Error('workflow.config.json: нет объекта');
  let depth = 0;
  let index = start;
  while (index < text.length) {
    const ch = text[index];
    if (ch === '"') {
      index = skipString(text, index);
      continue;
    }
    if (ch === '{') depth += 1;
    else if (ch === '}') {
      depth -= 1;
      if (depth === 0) return { start, end: index };
    }
    index += 1;
  }
  throw new Error('workflow.config.json: объект не закрыт');
}

function objectMembers(text, start, end) {
  const members = [];
  let index = start + 1;
  while (index < end) {
    index = skipWs(text, index, end);
    if (index >= end || text[index] === '}') break;
    if (text[index] !== '"') {
      index += 1;
      continue;
    }
    const keyStart = index;
    const keyEnd = skipString(text, index);
    const key = JSON.parse(text.slice(keyStart, keyEnd));
    index = skipWs(text, keyEnd, end);
    if (text[index] !== ':') {
      index = keyEnd;
      continue;
    }
    index = skipWs(text, index + 1, end);
    const valueStart = index;
    const valueEnd = skipValue(text, index, end);
    members.push({ key, keyStart, keyEnd, valueStart, valueEnd });
    index = valueEnd;
  }
  return members;
}

function memberValueBounds(text, member) {
  const raw = text.slice(member.valueStart, member.valueEnd);
  const lead = raw.length - raw.trimStart().length;
  const trimmed = raw.trimEnd();
  if (!trimmed.endsWith('}') || !trimmed.trimStart().startsWith('{')) {
    throw new Error('guard в workflow.config.json должен быть объектом');
  }
  return {
    start: member.valueStart + lead,
    end: member.valueStart + lead + trimmed.length,
  };
}

function spliceEnabled(text, enabled) {
  const literal = enabled ? 'true' : 'false';
  const bounds = topLevelBounds(text);
  const members = objectMembers(text, bounds.start, bounds.end);
  const guardMember = members.find((member) => member.key === 'guard');
  if (!guardMember) {
    const inner = text.slice(bounds.start + 1, bounds.end);
    const tail = /\s*$/.exec(inner)[0];
    const body = inner.slice(0, inner.length - tail.length);
    const cut = bounds.end - tail.length;
    const separator = body.trim() === '' ? '' : ',';
    const insertion = separator + '\n  "guard": { "enabled": ' + literal + ' }\n';
    return text.slice(0, cut) + insertion + text.slice(bounds.end);
  }
  const valueBounds = memberValueBounds(text, guardMember);
  const guardMembers = objectMembers(text, valueBounds.start, valueBounds.end - 1);
  const enabledMember = guardMembers.find((member) => member.key === 'enabled');
  if (enabledMember) {
    return text.slice(0, enabledMember.valueStart) + literal + text.slice(enabledMember.valueEnd);
  }
  const inner = text.slice(valueBounds.start + 1, valueBounds.end - 1);
  if (inner.trim() === '') {
    return text.slice(0, valueBounds.start + 1) + ' "enabled": ' + literal + ' ' + text.slice(valueBounds.end - 1);
  }
  return text.slice(0, valueBounds.start + 1) + '"enabled": ' + literal + ', ' + text.slice(valueBounds.start + 1);
}

function deepEqual(left, right) {
  if (left === right) return true;
  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) return false;
    return left.every((item, index) => deepEqual(item, right[index]));
  }
  if (!left || !right || typeof left !== 'object' || typeof right !== 'object') return false;
  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);
  if (leftKeys.length !== rightKeys.length) return false;
  return leftKeys.every((key) => Object.prototype.hasOwnProperty.call(right, key) && deepEqual(left[key], right[key]));
}

function appendLog(paths, enabled, actor) {
  const at = new Date().toISOString();
  fs.mkdirSync(path.dirname(paths.logPath), { recursive: true });
  fs.appendFileSync(paths.logPath, at + ' enabled=' + (enabled ? 'true' : 'false') + ' actor=' + actor + ' source=panel\n', 'utf8');
  return at;
}

/**
 * Enable or disable the commit guard for one workspace.
 *
 * Writes only `guard.enabled`; every other key of workflow.config.json stays
 * byte-for-byte. Appends one line to docs/subagent-workflow/guard.log.
 *
 * @param {string} root repository root
 * @param {boolean} enabled
 * @returns {{root: string, configPath: string, logPath: string, guard: {enabled: boolean},
 *            previous: boolean|null, changed: boolean, actor: string, loggedAt: string}}
 */
export function writeGuardEnabled(root, enabled) {
  if (typeof enabled !== 'boolean') throw new Error('enabled должен быть true или false');
  const paths = guardPaths(root);
  if (!fs.existsSync(paths.configPath)) {
    throw new Error('нет ' + GUARD_CONFIG_REL + ' в ' + paths.root);
  }
  const before = fs.readFileSync(paths.configPath, 'utf8');
  let parsed;
  try {
    parsed = JSON.parse(before);
  } catch (failure) {
    throw new Error('workflow.config.json не читается: ' + (failure && failure.message ? failure.message : failure));
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('workflow.config.json: ожидается объект');
  }
  const block = guardBlock(parsed);
  const previous = typeof block.enabled === 'boolean' ? block.enabled : null;
  const after = spliceEnabled(before, enabled);
  const expected = { ...parsed, guard: { ...block, enabled } };
  let check;
  try {
    check = JSON.parse(after);
  } catch (failure) {
    throw new Error('правка конфигурации сломала JSON: ' + (failure && failure.message ? failure.message : failure));
  }
  if (!deepEqual(check, expected)) {
    throw new Error('правка затронула другие ключи workflow.config.json — запись отменена');
  }
  const changed = after !== before;
  if (changed) fs.writeFileSync(paths.configPath, after, 'utf8');
  const actor = actorOf(process.env);
  const loggedAt = appendLog(paths, enabled, actor);
  return {
    root: paths.root,
    configPath: paths.configPath,
    logPath: paths.logPath,
    guard: { enabled },
    previous,
    changed,
    actor,
    loggedAt,
  };
}
