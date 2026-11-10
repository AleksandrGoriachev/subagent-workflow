#!/usr/bin/env node
/**
 * 0133: неизменяемые пресеты узлов.
 *
 * Повод: у узла release-1 промпт вёл мимо релизного гейта (publish-public, ручной
 * push, релиз по API). Промпт — не ограничение: его можно переписать или
 * проигнорировать. Поэтому требования узла живут отдельным файлом presets/<id>.json
 * с замком (presets/lock.json): правка пресета без обновления замка — отказ.
 *
 * Проверка отвечает на три вопроса:
 *   1. у каждого узла, объявившего preset, есть файл и он не подменён;
 *   2. в пресете есть обязательные требования (пайплайн, предполёт, запреты);
 *   3. промпт узла не противоречит пресету (запрещённые команды, обход гейта).
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const PRESET_DIR = 'presets';
const LOCK_FILE = 'lock.json';

/** Обязательные требования релизного пайплайна — машинно проверяемые. */
export const RELEASE_REQUIREMENTS = {
  pipeline: 'tools/release.mjs',
  preflight: ['check-version', 'release-receipt --online'],
  deny: ['git push', 'gh release create', 'publish-public'],
};

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/u, ''));
  } catch {
    return null;
  }
}

/** sha256 текста пресета — тот же байтовый канон, что у якорей. */
export function presetHash(text) {
  return crypto.createHash('sha256').update(String(text).trimEnd(), 'utf8').digest('hex');
}

/** Загрузить структуру и пресеты; вернуть узлы, объявившие preset. */
export function loadPresets(root) {
  const repo = path.resolve(String(root || '.'));
  const graphFile = path.join(repo, '..', 'structure', 'graph.json');
  const graph = readJson(graphFile) || readJson(path.join(repo, 'structure', 'graph.json'));
  const nodes = graph && Array.isArray(graph.nodes) ? graph.nodes : [];
  const lock = readJson(path.join(repo, PRESET_DIR, LOCK_FILE)) || { presets: {} };
  /*
   * 0133: пресет живёт в репозитории плагина и только там. Копия в воркспейсе
   * узла не учитывается: иначе узел «правит» себе ограничения в своём каталоге.
   */
  const workspaceCopy = path.join(repo, '..', PRESET_DIR);
  const declared = nodes.filter((node) => node && (node.preset || fs.existsSync(path.join(repo, PRESET_DIR, String(node.id) + '.json'))));
  const presets = [];
  for (const node of declared) {
    const file = path.join(repo, PRESET_DIR, String(node.id) + '.json');
    const exists = fs.existsSync(file);
    const text = exists ? fs.readFileSync(file, 'utf8') : '';
    presets.push({ node: String(node.id), file, exists, text, data: exists ? readJson(file) : null, pinned: lock.presets ? lock.presets[String(node.id)] : undefined, prompt: String(node.prompt || '') });
  }
  return { repo, nodes, presets, lock, workspaceCopy: fs.existsSync(workspaceCopy) ? workspaceCopy : null };
}

/** Проверить один пресет: целостность и обязательные требования. */
export function checkPreset(preset) {
  const problems = [];
  const warnings = [];
  if (!preset.exists) {
    problems.push(preset.node + ': объявлен preset, но нет presets/' + preset.node + '.json');
    return { problems, warnings };
  }
  if (!preset.data || typeof preset.data !== 'object') {
    problems.push(preset.node + ': пресет не разбирается как JSON');
    return { problems, warnings };
  }
  if (preset.data.immutable !== true) problems.push(preset.node + ': пресет обязан быть immutable: true — иначе он не ограничение');
  const actual = presetHash(preset.text);
  if (!preset.pinned) problems.push(preset.node + ': в presets/lock.json нет хеша — пресет не закреплён');
  else if (preset.pinned !== actual) problems.push(preset.node + ': хеш пресета не совпадает с замком (' + actual.slice(0, 12) + '… != ' + String(preset.pinned).slice(0, 12) + '…) — пресет правили в обход');
  if (preset.data.node !== preset.node) problems.push(preset.node + ': в пресете указан другой узел: ' + String(preset.data.node || 'пусто'));

  if (preset.node === 'release-1') {
    if (String(preset.data.pipeline || '') !== RELEASE_REQUIREMENTS.pipeline) {
      problems.push(preset.node + ': пайплайн обязан быть ' + RELEASE_REQUIREMENTS.pipeline + ' (сейчас «' + String(preset.data.pipeline || 'пусто') + '»)');
    }
    const preflight = Array.isArray(preset.data.requires && preset.data.requires.preflight) ? preset.data.requires.preflight : [];
    for (const required of RELEASE_REQUIREMENTS.preflight) {
      if (!preflight.some((item) => String(item).includes(required))) problems.push(preset.node + ': в предполёте нет «' + required + '»');
    }
    const deny = Array.isArray(preset.data.deny) ? preset.data.deny.map((item) => String(item).toLowerCase()) : [];
    for (const required of RELEASE_REQUIREMENTS.deny) {
      if (!deny.some((item) => item.includes(required))) problems.push(preset.node + ': в запретах нет «' + required + '»');
    }
    const guard = preset.data.requires && preset.data.requires.guard ? preset.data.requires.guard : {};
    if (guard.enabled !== true) problems.push(preset.node + ': требование guard.enabled отсутствует — коммиты вне контракта не блокируются');
    /*
     * Промпт не должен ЗВАТЬ к обходу гейта. Упоминание команды в строке запрета —
     * это правило, а не обход: различаем по словам «запрещено», «нельзя», «не ».
     */
    const prompt = preset.prompt.toLowerCase();
    const lines = prompt.split(/\r?\n/u);
    for (const forbidden of ['publish-public', 'gh release', 'git push']) {
      const offenders = lines.filter((line) => line.includes(forbidden)
        && !/запрещ|нельзя|не\s+дела|не\s+запуск|вместо|обход/u.test(line));
      if (offenders.length > 0) problems.push(preset.node + ': промпт зовёт к обходу гейта «' + forbidden + '»: ' + offenders[0].trim().slice(0, 80));
    }
    if (!prompt.includes('release.mjs')) problems.push(preset.node + ': промпт не называет tools/release.mjs');
  }
  return { problems, warnings };
}

/** Проверить все пресеты воркспейса. */
export function checkPresets(root, options = {}) {
  const loaded = loadPresets(root);
  const problems = [];
  const warnings = [];
  const names = [];
  if (loaded.presets.length === 0) warnings.push('ни один узел не объявил preset — ограничения живут только в промптах');
  if (loaded.workspaceCopy) warnings.push('пресеты найдены и в воркспейсе (' + loaded.workspaceCopy + '): они не учитываются — зона автора плагина, репозиторий');
  for (const preset of loaded.presets) {
    names.push(preset.node);
    const result = checkPreset(preset);
    problems.push(...result.problems);
    warnings.push(...result.warnings);
  }
  /* guard.enabled — рабочая настройка воркспейса: пресет требует её включения. */
  const configFile = path.join(path.resolve(String(root || '.')), '..', 'docs', 'subagent-workflow', 'workflow.config.json');
  const config = readJson(configFile) || {};
  const guardOn = Boolean(config.guard && config.guard.enabled === true);
  const requiresGuard = loaded.presets.some((preset) => preset.data && preset.data.requires && preset.data.requires.guard && preset.data.requires.guard.enabled === true);
  if (requiresGuard && !guardOn) {
    warnings.push('пресет требует guard.enabled=true, а в workflow.config.json он выключен — коммиты вне контракта задачи не блокируются');
  }
  return { ok: problems.length === 0, problems, warnings, presets: names, guardOn };
}

if (process.argv[1] && import.meta.url === new URL('file://' + path.resolve(process.argv[1]).split(path.sep).join('/')).href) {
  const argv = process.argv.slice(2);
  const index = argv.indexOf('--root');
  const result = checkPresets(index >= 0 && argv[index + 1] ? argv[index + 1] : process.cwd());
  for (const warning of result.warnings) console.log('PRESET WARN ' + warning);
  for (const problem of result.problems) console.log('PRESET ERROR ' + problem);
  if (result.ok) console.log('node-presets: OK — пресеты закреплены' + (result.presets.length ? ' (' + result.presets.join(', ') + ')' : ''));
  else process.exitCode = 1;
}
