#!/usr/bin/env node
/*
 * 0102 (2.6.94): машинные проверки поведения движка для контракта.
 * Каждый подрежим печатает понятную причину и выходит 1, если поведение ещё
 * не реализовано; после реализации — 0.
 */
import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const here = path.dirname(fileURLToPath(import.meta.url));
const mode = process.argv[2] || '';
const bad = (reason) => { console.log(reason); process.exit(1); };
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'wf-check-'));
}
function writeReceipt(dir, reviewer) {
  const reviewFile = path.join(dir, 'review.json');
  fs.writeFileSync(reviewFile, JSON.stringify({ reviewer, decision: 'accepted', remarks: [] }, null, 2) + '\n');
  const digest = crypto.createHash('sha256').update(fs.readFileSync(reviewFile)).digest('hex');
  fs.writeFileSync(path.join(dir, 'review.receipt.json'), JSON.stringify({ artifactSha256: digest, reviewer, decision: 'accept' }, null, 2) + '\n');
}
function lint(taskDir, extra = []) {
  return spawnSync(process.execPath, [path.join(root, 'spec/scripts/task-lint.mjs'), '--task', taskDir, ...extra], { encoding: 'utf8' });
}

if (mode === 'c1') {
  const mod = await import(pathToFileURL(path.join(root, 'spec/scripts/lib/review-receipt.mjs')).href);
  const dir = tmpDir();
  writeReceipt(dir, 'reviewer-1');
  const result = mod.validateReviewReceipt({ taskDir: dir, meta: { reviewer: 'subagent:reviewer-1' } });
  if (!result.ok) bad('no normalization: ' + (result.problems || []).join('; '));
  console.log('ok');
} else if (mode === 'c2') {
  const source = fs.readFileSync(path.join(root, 'spec/scripts/task-accept.mjs'), 'utf8');
  if (!/reviewBinding/.test(source) || !/review\.contractCommit/.test(source)) bad('no review binding');
  console.log('ok');
} else if (mode === 'c3') {
  const source = fs.readFileSync(path.join(root, 'spec/scripts/task-verify.mjs'), 'utf8');
  if (!/validateReviewReceipt/.test(source)) bad('no early preflight');
  console.log('ok');
} else if (mode === 'c4') {
  const run = lint(path.join(here, 'fixtures/prefix-task'));
  const out = (run.stdout || '') + (run.stderr || '');
  if (run.status !== 0) bad('lint упал на фикстуре с префиксом: ' + out.trim().slice(0, 400));
  if (!/subagent:/.test(out)) bad('no subagent warn');
  console.log('ok');
} else if (mode === 'c5') {
  /* у фикстуры нет lock, поэтому смотрим именно на требование resultShape */
  const run = lint(path.join(here, 'fixtures/accepted-noshape'), ['--strict']);
  const out = (run.stdout || '') + (run.stderr || '');
  if (/ERROR[^\n]*resultShape/.test(out)) bad('accepted without resultShape: ' + out.trim().slice(0, 400));
  console.log('ok');
} else {
  console.error('usage: node docs/tasks/0102/check.mjs c1|c2|c3|c4|c5');
  process.exit(2);
}
