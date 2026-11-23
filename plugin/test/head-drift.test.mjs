/*
 * 0110 (2.6.98): headDrift — сдвиг HEAD чужими коммитами.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const { headDrift, headCommit } = await import('../../spec/scripts/lib/common.mjs');

function git(cwd, args) {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8' });
  assert.equal(r.status, 0, 'git ' + args.join(' ') + ': ' + (r.stderr || r.stdout));
  return (r.stdout || '').trim();
}

function repo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-drift-'));
  git(dir, ['init', '-q']);
  git(dir, ['config', 'user.email', 'test@local']);
  git(dir, ['config', 'user.name', 'test']);
  fs.mkdirSync(path.join(dir, 'docs/tasks/0001'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'docs/tasks/0001/task.md'), '# task\n');
  fs.writeFileSync(path.join(dir, '.gitignore'), 'docs/tasks/0001/artifacts/\n');
  fs.writeFileSync(path.join(dir, 'a.txt'), 'a\n');
  git(dir, ['add', '-A']);
  git(dir, ['commit', '-q', '-m', 'contract']);
  return dir;
}

const META = { allowedPaths: ['src/**'], protectedPaths: ['checks/**'] };
const taskDir = (dir) => path.join(dir, 'docs/tasks/0001');

test('headDrift: без сдвига — drift=false', () => {
  const dir = repo();
  const result = headDrift(dir, headCommit(dir), META, taskDir(dir));
  assert.equal(result.drift, false);
  assert.equal(result.ok, true);
});

test('headDrift: чужой коммит вне путей задания — допускается', () => {
  const dir = repo();
  const contract = headCommit(dir);
  fs.writeFileSync(path.join(dir, 'README.md'), '# release\n');
  git(dir, ['add', '-A']);
  git(dir, ['commit', '-q', '-m', 'release']);
  const result = headDrift(dir, contract, META, taskDir(dir));
  assert.equal(result.drift, true);
  assert.equal(result.ok, true, JSON.stringify(result.errors));
  assert.deepEqual(result.paths, ['README.md']);
  assert.equal(result.foreignCommits, 1);
});

test('headDrift: чужой коммит задел allowedPaths — отказ с путём', () => {
  const dir = repo();
  const contract = headCommit(dir);
  fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'src/x.js'), 'x\n');
  git(dir, ['add', '-A']);
  git(dir, ['commit', '-q', '-m', 'code']);
  const result = headDrift(dir, contract, META, taskDir(dir));
  assert.equal(result.ok, false);
  assert.match(result.errors.join(' '), /src\/x\.js/u);
});

test('headDrift: contractCommit не предок HEAD — отказ', () => {
  const dir = repo();
  const result = headDrift(dir, 'a'.repeat(40), META, taskDir(dir));
  assert.equal(result.drift, true);
  assert.equal(result.ok, false);
  assert.match(result.errors.join(' '), /не предок/u);
});
