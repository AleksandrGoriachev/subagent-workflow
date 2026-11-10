#!/usr/bin/env node
/**
 * 0112 (WC-78): один вход для выпуска и безопасная уборка черновиков.
 *
 * Повод — два промаха 09.11, оба из импровизации:
 *  1. ad-hoc скрипт удаления «пустого» черновика прошёлся циклом и снёс оба
 *     черновика v2.6.66, включая тот, где уже лежали 8 ассетов;
 *  2. выпуск упал, потому что архивы tar.gz/zip для версии не были созданы:
 *     шаги выпуска держались в памяти, а не в инструменте.
 *
 * Поэтому здесь два правила, а не два обещания:
 *  - release: все шаги в одном месте, с предварительной проверкой, что версия,
 *    ассеты и контрольные суммы согласованы; публикация без них невозможна;
 *  - cleanup: по умолчанию ничего не удаляет (dry-run), удаляет строго один
 *    релиз по id и отказывается трогать черновик с ассетами без --force.
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createDraft } from './release-draft.mjs';
import { smokeRelease, localAssets } from './release-smoke.mjs';
import { publishRelease } from './release-publish.mjs';
import { githubToken } from './lib/github-token.mjs';

const REPO = 'AleksandrGoriachev/subagent-workflow';
const ROOT = path.resolve(import.meta.dirname, '..');
const DIST = path.join(ROOT, 'dist');

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/u, ''));
}

/** Предполёт: версия и файлы согласованы. Возвращает план или проблемы. */
export function preflight(version, options = {}) {
  const root = options.root || ROOT;
  const problems = [];
  const versionFile = path.join(root, 'VERSION');
  const pkgFile = path.join(root, 'package.json');
  if (!fs.existsSync(versionFile)) problems.push('нет VERSION');
  else if (fs.readFileSync(versionFile, 'utf8').trim() !== version) {
    problems.push('VERSION не равен ' + version + ' (в файле ' + fs.readFileSync(versionFile, 'utf8').trim() + ')');
  }
  if (fs.existsSync(pkgFile)) {
    const pkg = readJson(pkgFile);
    if (String(pkg.version || '') !== version) problems.push('package.json: ' + pkg.version + ' != ' + version);
  }
  /*
   * 0133: квитанции — часть предполёта, а не отдельная проверка «когда вспомнят».
   * Без этого релиз, сделанный руками, обнаруживался только задним числом.
   */
  if (options.receipts !== false) {
    try {
      const output = run(process.execPath, ['spec/checks/release-receipt.mjs', '--online'], root);
      if (!/release-receipt: OK/u.test(output)) problems.push('release-receipt --online: нет подтверждения квитанций — ' + String(output).trim().split('\n').pop());
    } catch (error) {
      const text = String((error && (error.stdout || error.message)) || error).trim().split('\n').slice(-2).join(' / ');
      problems.push('release-receipt --online не прошёл: ' + text);
    }
  }
  const assets = expectedNames(version, options.panelVersion);
  const missing = assets.filter((name) => !fs.existsSync(path.join(root, 'dist', name)) && !fs.existsSync(path.join(root, 'dist', name + '.sha256')));
  return { ok: problems.length === 0, problems, assets, missing };
}

/** Имена ассетов выпуска: без них публикация не начинается. */
export function expectedNames(version, panelVersion) {
  const panel = panelVersion || readJson(path.join(ROOT, 'package.json')).dshPanelVersion || '0.9.27';
  return [
    'subagent-workflow-' + version + '.tar.gz',
    'subagent-workflow-' + version + '.tar.gz.sha256',
    'subagent-workflow-' + version + '.zip',
    'subagent-workflow-' + version + '.zip.sha256',
    'dsh-workflow-console.tgz',
    'dsh-workflow-console.tgz.sha256',
    'dsh-workflow-console-' + panel + '.tgz',
    'dsh-workflow-console-' + panel + '.tgz.sha256',
  ];
}

function run(command, args, cwd = ROOT) {
  return execFileSync(command, args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

/** Полный выпуск: сборка -> архивы -> коммит/тег -> draft -> smoke -> publish. */
export async function release(version, options = {}) {
  const log = typeof options.log === 'function' ? options.log : (line) => console.log(line);
  const steps = [];
  const first = preflight(version, options);
  if (first.missing.length > 0 && options.artifacts !== false) {
    log('release: собираю ассеты ' + version);
    run(process.execPath, ['tools/pack-plugin.mjs']);
    run(process.execPath, ['tools/pack.mjs']);
    /*
     * Архив движка снимается с коммита, а не с рабочего дерева: иначе в релиз
     * попадёт не то, что закоммичено. Сначала коммит и тег, потом git archive.
     */
    if (options.commit !== false) {
      run('git', ['add', '-A']);
      run('pwsh', ['-NoProfile', '-File', 'tools/commit.ps1', options.message || ('release: ' + version), '-Tag', 'v' + version, '-Push']);
      steps.push('commit+tag v' + version);
    }
    run('git', ['archive', '--format=tar.gz', '--prefix=subagent-workflow-' + version + '/', '-o',
      path.join('dist', 'subagent-workflow-' + version + '.tar.gz'), 'v' + version]);
    const hashes = ['dsh-workflow-console.tgz', 'dsh-workflow-console-' + (options.panelVersion || '0.9.27') + '.tgz',
      'subagent-workflow-' + version + '.tar.gz', 'subagent-workflow-' + version + '.zip'];
    for (const name of hashes) {
      const file = path.join(DIST, name);
      if (!fs.existsSync(file)) { steps.push('НЕТ ' + name); continue; }
      const digest = (await import('node:crypto')).createHash('sha256').update(fs.readFileSync(file)).digest('hex');
      fs.writeFileSync(file + '.sha256', digest + '  ' + name + '\n');
    }
  }
  const second = preflight(version, options);
  if (!second.ok || second.missing.length > 0) {
    return { ok: false, stage: 'preflight', problems: [...second.problems, ...second.missing.map((name) => 'нет ассета ' + name)], steps };
  }
  if (options.github !== false) {
    log('release: черновик ' + version);
    const draft = await createDraft({ tag: 'v' + version, name: options.name || version });
    log('release: приёмка ' + version);
    await smokeRelease({ tag: 'v' + version });
    log('release: публикация ' + version);
    const published = await publishRelease({ tag: 'v' + version });
    steps.push('published ' + (published && published.url ? published.url : 'ok'));
    return { ok: true, stage: 'published', version, draft, steps };
  }
  return { ok: true, stage: 'prepared', version, steps };
}

/** Список релизов по тегу (черновики тоже: tags-endpoint их не отдаёт). */
export async function findReleases(tag, options = {}) {
  const token = options.token || githubToken();
  const headers = { Accept: 'application/vnd.github+json', 'User-Agent': 'wf-release-cleanup' };
  if (token) headers.Authorization = 'Bearer ' + token;
  const fetchImpl = typeof options.fetchImpl === 'function' ? options.fetchImpl : globalThis.fetch;
  const response = await fetchImpl('https://api.github.com/repos/' + REPO + '/releases?per_page=30', { headers });
  if (!response.ok) throw new Error('GitHub не отдал релизы: HTTP ' + response.status);
  const list = typeof response.json === 'function' ? await response.json() : JSON.parse(Buffer.from(await response.arrayBuffer()).toString('utf8'));
  return (Array.isArray(list) ? list : []).filter((release) => release && release.tag_name === tag);
}

/**
 * Уборка черновика: сухо по умолчанию, один релиз, отказ при ассетах без --force.
 * @param {{tag: string, id?: number, apply?: boolean, force?: boolean, token?: string, fetchImpl?: Function}} options
 */
export async function cleanupDraft(options = {}) {
  const tag = String(options.tag || '');
  const apply = options.apply === true;
  const force = options.force === true;
  if (!tag) return { ok: false, problems: ['нужен --tag'] };
  const candidates = await findReleases(tag, options);
  if (candidates.length === 0) return { ok: true, action: 'nothing', tag };
  if (candidates.length > 1 && !options.id) {
    return { ok: false, problems: ['по тегу ' + tag + ' найдено ' + candidates.length + ' релизов: укажите --id, иначе можно снести не тот'] };
  }
  const release = options.id ? candidates.find((item) => Number(item.id) === Number(options.id)) : candidates[0];
  if (!release) return { ok: false, problems: ['релиз ' + options.id + ' не найден'] };
  if (release.draft !== true) return { ok: false, problems: ['релиз ' + release.id + ' уже опубликован: уборка запрещена'] };
  const assets = Array.isArray(release.assets) ? release.assets.length : 0;
  if (assets > 0 && !force) {
    return { ok: false, problems: ['у черновика ' + release.id + ' есть ассеты (' + assets + '): удаление только с --force'] };
  }
  if (!apply) return { ok: true, action: 'would-delete', id: release.id, assets, tag };
  const token = options.token || githubToken();
  const headers = { Accept: 'application/vnd.github+json', 'User-Agent': 'wf-release-cleanup' };
  if (token) headers.Authorization = 'Bearer ' + token;
  const response = await fetch('https://api.github.com/repos/' + REPO + '/releases/' + release.id, { method: 'DELETE', headers });
  if (response.status !== 204) return { ok: false, problems: ['GitHub ответил ' + response.status] };
  return { ok: true, action: 'deleted', id: release.id, assets, tag };
}

if (process.argv[1] && import.meta.url === new URL('file://' + path.resolve(process.argv[1]).split(path.sep).join('/')).href) {
  const argv = process.argv.slice(2);
  const command = argv[0];
  const value = (flag) => { const index = argv.indexOf(flag); return index >= 0 ? argv[index + 1] : undefined; };
  if (command === 'preflight') {
    const result = preflight(argv[1]);
    for (const problem of result.problems) console.log('RELEASE ERROR ' + problem);
    for (const name of result.missing) console.log('RELEASE ERROR нет ассета ' + name);
    console.log(result.ok && result.missing.length === 0 ? 'preflight: OK' : 'preflight: не пройден');
    if (!result.ok || result.missing.length > 0) process.exitCode = 1;
  } else if (command === 'release') {
    const result = await release(argv[1], { name: value('--name') });
    if (!result.ok) { for (const problem of result.problems) console.log('RELEASE ERROR ' + problem); process.exitCode = 1; }
    else for (const step of result.steps) console.log('RELEASE ' + step);
  } else if (command === 'cleanup') {
    const result = await cleanupDraft({ tag: value('--tag'), id: value('--id'), apply: argv.includes('--apply'), force: argv.includes('--force') });
    console.log(JSON.stringify(result));
    if (!result.ok) process.exitCode = 1;
  } else {
    console.log('usage: release.mjs preflight <version> | release <version> [--name N] | cleanup --tag vX [--id N] [--apply] [--force]');
    process.exitCode = 2;
  }
}
