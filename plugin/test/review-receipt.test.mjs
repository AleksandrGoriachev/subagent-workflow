/**
 * 0092 / 2.6.90: квитанция ревью в task-accept (валидатор).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const { validateReviewReceipt, writeReviewReceipt } = await import('../../spec/scripts/lib/review-receipt.mjs');

function fixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-receipt-'));
  const review = { reviewer: 'reviewer-1', decision: 'accept', findings: [] };
  fs.writeFileSync(path.join(dir, 'review.json'), JSON.stringify(review, null, 2) + '\n');
  const digest = crypto.createHash('sha256').update(fs.readFileSync(path.join(dir, 'review.json'))).digest('hex');
  return { dir, review, digest };
}
const receipt = (digest, extra = {}) => ({ artifactSha256: digest, reviewer: 'reviewer-1', decision: 'accept', ...extra });

test('квитанция: объявлен ревьюер, review.json нет — отказ', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-receipt-noreview-'));
  const result = validateReviewReceipt({ taskDir: dir, meta: { reviewerNode: 'reviewer-1' }, review: null });
  assert.equal(result.applicable, true);
  assert.equal(result.ok, false);
  assert.match(result.problems.join(' '), /нет файла review\.json/u);
});

test('квитанция: неверный artifactSha256 — отказ', () => {
  const { dir, review } = fixture();
  fs.writeFileSync(path.join(dir, 'review.receipt.json'), JSON.stringify(receipt('0'.repeat(64))));
  const result = validateReviewReceipt({ taskDir: dir, meta: { reviewer: 'reviewer-1' }, review });
  assert.equal(result.ok, false);
  assert.match(result.problems.join(' '), /artifactSha256/u);
});

test('квитанция: чужой reviewer — отказ', () => {
  const { dir, review, digest } = fixture();
  fs.writeFileSync(path.join(dir, 'review.receipt.json'), JSON.stringify(receipt(digest, { reviewer: 'worker-5' })));
  const result = validateReviewReceipt({ taskDir: dir, meta: { reviewer: 'reviewer-1' }, review });
  assert.equal(result.ok, false);
  assert.match(result.problems.join(' '), /reviewer/u);
});

test('квитанция: валидная квитанция проходит', () => {
  const { dir, review, digest } = fixture();
  fs.writeFileSync(path.join(dir, 'review.receipt.json'), JSON.stringify(receipt(digest)));
  const result = validateReviewReceipt({ taskDir: dir, meta: { reviewer: 'reviewer-1' }, review });
  assert.equal(result.ok, true);
  assert.equal(result.applicable, true);
});

test('квитанция: ревьюер не объявлен — not-applicable', () => {
  const { dir, review } = fixture();
  const result = validateReviewReceipt({ taskDir: dir, meta: {}, review });
  assert.equal(result.applicable, false);
  assert.equal(result.ok, true);
});

test('писатель квитанции: round-trip writer → валидатор', () => {
  const { dir } = fixture();
  const written = writeReviewReceipt({ taskDir: dir, reviewer: 'reviewer-1' });
  assert.equal(written.ok, true);
  assert.equal(written.receipt.artifactSha256, crypto.createHash('sha256').update(fs.readFileSync(path.join(dir, 'review.json'))).digest('hex'));
  const checked = validateReviewReceipt({ taskDir: dir, meta: { reviewer: 'reviewer-1' }, review: { reviewer: 'reviewer-1' } });
  assert.equal(checked.ok, true);
});

test('писатель квитанции: без review.json — отказ, файл не создан', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-receipt-empty-'));
  const written = writeReviewReceipt({ taskDir: dir, reviewer: 'reviewer-1' });
  assert.equal(written.ok, false);
  assert.match(written.problems.join(' '), /нет файла review\.json/u);
  assert.equal(fs.existsSync(path.join(dir, 'review.receipt.json')), false);
});

test('валидатор: reviewer без meta — без квитанции отказ', () => {
  const { dir } = fixture();
  const result = validateReviewReceipt({ taskDir: dir, reviewer: 'reviewer-1' });
  assert.equal(result.applicable, true);
  assert.equal(result.ok, false);
  assert.match(result.problems.join(' '), /нет квитанции/u);
});

test('валидатор: reviewer + writer → ок, правка review.json → отказ', () => {
  const { dir } = fixture();
  const written = writeReviewReceipt({ taskDir: dir, reviewer: 'reviewer-1' });
  assert.equal(written.ok, true);
  const good = validateReviewReceipt({ taskDir: dir, reviewer: 'reviewer-1' });
  assert.equal(good.ok, true, good.problems.join('; '));
  fs.writeFileSync(path.join(dir, 'review.json'), JSON.stringify({ reviewer: 'reviewer-1', decision: 'accept', extra: 1 }));
  const bad = validateReviewReceipt({ taskDir: dir, reviewer: 'reviewer-1' });
  assert.equal(bad.ok, false);
  assert.match(bad.problems.join(' '), /artifactSha256/u);
});

test('валидатор: пустой reviewer и нет meta — not-applicable', () => {
  const { dir } = fixture();
  const result = validateReviewReceipt({ taskDir: dir });
  assert.equal(result.applicable, false);
  assert.equal(result.ok, true);
});
