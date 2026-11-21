/**
 * 0092 / 2.6.90: квитанция ревью в task-accept (валидатор).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const { validateReviewReceipt } = await import('../../spec/scripts/lib/review-receipt.mjs');

function fixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-receipt-'));
  const review = { reviewer: 'reviewer-1', decision: 'accept', findings: [] };
  fs.writeFileSync(path.join(dir, 'review.json'), JSON.stringify(review, null, 2) + '\n');
  const digest = crypto.createHash('sha256').update(fs.readFileSync(path.join(dir, 'review.json'))).digest('hex');
  return { dir, review, digest };
}
const receipt = (digest, extra = {}) => ({ artifactSha256: digest, reviewer: 'reviewer-1', decision: 'accept', ...extra });

test('квитанция: объявлен ревьюер, review не передан — отказ', () => {
  const { dir } = fixture();
  const result = validateReviewReceipt({ taskDir: dir, meta: { reviewerNode: 'reviewer-1' }, review: null });
  assert.equal(result.applicable, true);
  assert.equal(result.ok, false);
  assert.match(result.problems.join(' '), /review\.json не передан/u);
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
