/**
 * 0133: неизменяемые пресеты узлов.
 *
 * c1: пресет закреплён — проверка проходит;
 * c2: подмена пресета (правка без обновления замка) — отказ;
 * c3: промпт, который ЗОВЁТ к обходу гейта, — отказ; упоминание в строке запрета — норма;
 * c4: пресет без предполёта release-receipt --online — отказ;
 * c5: узел без пресета — предупреждение, не отказ.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { checkPresets, checkPreset, presetHash } from '../../spec/checks/node-presets.mjs';

function workspace(prompt = 'Роль: выпускающий. Выпуск только через tools/release.mjs. Запрещено: git push, gh release create, publish-public.') {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-presets-'));
  const repo = path.join(root, 'repo');
  fs.mkdirSync(path.join(repo, 'presets'), { recursive: true });
  fs.mkdirSync(path.join(repo, 'structure'), { recursive: true });
  fs.mkdirSync(path.join(root, 'docs', 'subagent-workflow'), { recursive: true });
  fs.writeFileSync(path.join(root, 'docs', 'subagent-workflow', 'workflow.config.json'), JSON.stringify({ guard: { enabled: true } }));
  fs.writeFileSync(path.join(repo, 'structure', 'graph.json'), JSON.stringify({ version: 1, nodes: [{ id: 'release-1', role: 'выпускающий', prompt, preset: 'release-1' }], edges: [] }));
  const preset = {
    node: 'release-1',
    version: 1,
    immutable: true,
    pipeline: 'tools/release.mjs',
    requires: { acceptance: 'accept', preflight: ['check-version', 'release-receipt --online'], evidence: ['tag'], guard: { enabled: true, scope: 'session' } },
    deny: ['git push', 'gh release create', 'publish-public'],
  };
  const text = JSON.stringify(preset, null, 2);
  fs.writeFileSync(path.join(repo, 'presets', 'release-1.json'), text);
  fs.writeFileSync(path.join(repo, 'presets', 'lock.json'), JSON.stringify({ version: 1, presets: { 'release-1': presetHash(text) } }, null, 2));
  return { root, repo };
}

test('c1: закреплённый пресет проходит', () => {
  const { repo } = workspace();
  const result = checkPresets(repo);
  assert.equal(result.ok, true, result.problems.join('; '));
  assert.deepEqual(result.presets, ['release-1']);
});

test('c2: подмена пресета без обновления замка — отказ', () => {
  const { repo } = workspace();
  const file = path.join(repo, 'presets', 'release-1.json');
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  data.deny = ['git push'];
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
  const result = checkPresets(repo);
  assert.equal(result.ok, false);
  assert.match(result.problems.join(' '), /хеш пресета не совпадает/u);
});

test('c3: промпт-обход — отказ; запрет в строке — норма', () => {
  const bad = workspace('Роль: выпускающий. Сделай publish-public --build --push, потом релиз по API.');
  const badResult = checkPresets(bad.repo);
  assert.equal(badResult.ok, false);
  assert.match(badResult.problems.join(' '), /обход[а-яё]*\s+гейта/u);
  const good = workspace();
  assert.equal(checkPresets(good.repo).ok, true);
});

test('c4: пресет без онлайн-квитанций в предполёте — отказ', () => {
  const { repo } = workspace();
  const file = path.join(repo, 'presets', 'release-1.json');
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  data.requires.preflight = ['check-version'];
  const text = JSON.stringify(data, null, 2);
  fs.writeFileSync(file, text);
  fs.writeFileSync(path.join(repo, 'presets', 'lock.json'), JSON.stringify({ version: 1, presets: { 'release-1': presetHash(text) } }, null, 2));
  const result = checkPresets(repo);
  assert.equal(result.ok, false);
  assert.match(result.problems.join(' '), /release-receipt --online/u);
});

test('c5: узел без пресета — предупреждение', () => {
  const { repo } = workspace();
  fs.writeFileSync(path.join(repo, 'structure', 'graph.json'), JSON.stringify({ version: 1, nodes: [{ id: 'worker', role: 'исполнитель' }], edges: [] }));
  const result = checkPresets(repo);
  assert.equal(result.ok, true);
  assert.match(result.warnings.join(' '), /ни один узел не объявил preset/u);
});
