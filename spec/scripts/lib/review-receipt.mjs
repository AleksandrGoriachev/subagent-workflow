/**
 * 0092 / 2.6.90: квитанция ревью.
 *
 * Если task.md объявляет reviewer/reviewerNode, приёмка без квитанции
 * review.receipt.json невозможна: квитанция связывает review.json (его байты)
 * с автором ревью и решением. Условие заказчика: нет узла — не препятствие;
 * есть узел — обойти нельзя.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export function declaredReviewer(meta) {
  const source = meta && typeof meta === 'object' ? meta : {};
  return String(source.reviewer || source.reviewerNode || '').trim();
}

export function sha256File(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

export function validateReviewReceipt({ taskDir, meta, review, reviewPath, reviewer } = {}) {
  /*
   * 0096 (2.6.92): объявленный ревьюер — явный аргумент, иначе meta. Без
   * review аргумента читаем review.json из каталога задания: внешняя проверка
   * (0198 c4) вызывает валидатор именно так — {taskDir, reviewer}.
   */
  const declared = String(reviewer || '').trim() || declaredReviewer(meta);
  if (declared === '') return { applicable: false, ok: true, problems: [], receipt: null };

  const problems = [];
  const dir = path.resolve(String(taskDir || '.'));
  const reviewFile = reviewPath ? path.resolve(String(reviewPath)) : path.join(dir, 'review.json');
  const receiptFile = path.join(dir, 'review.receipt.json');

  let reviewDoc = review;
  if (!reviewDoc && fs.existsSync(reviewFile)) {
    try {
      reviewDoc = JSON.parse(fs.readFileSync(reviewFile, 'utf8'));
    } catch (error) {
      problems.push('review.json не читается: ' + (error && error.message ? error.message : error));
    }
  }
  if (!reviewDoc) problems.push('нет файла review.json: ' + reviewFile);
  if (!fs.existsSync(receiptFile)) problems.push('нет квитанции review.receipt.json при объявленном ревьюере ' + declared);
  if (problems.length > 0) return { applicable: true, ok: false, problems, receipt: null, file: receiptFile };

  let receipt;
  try {
    receipt = JSON.parse(fs.readFileSync(receiptFile, 'utf8'));
  } catch (error) {
    return { applicable: true, ok: false, problems: ['review.receipt.json не читается: ' + (error && error.message ? error.message : error)], receipt: null, file: receiptFile };
  }

  const digest = sha256File(reviewFile);
  if (String(receipt.artifactSha256 || '') !== digest) {
    problems.push('artifactSha256 не совпадает с sha256(review.json)');
  }
  if (String(receipt.reviewer || '').trim() !== declared) {
    problems.push('reviewer квитанции "' + String(receipt.reviewer || '').trim() + '" не совпадает с объявленным "' + declared + '"');
  }
  const decision = String(receipt.decision || '').trim();
  if (decision !== 'accept' && decision !== 'accepted') {
    problems.push('decision квитанции должен быть accept, сейчас "' + decision + '"');
  }
  return { applicable: true, ok: problems.length === 0, problems, receipt, file: receiptFile };
}

export function writeReviewReceipt({ taskDir, reviewPath, reviewer, decision = 'accept', at = new Date().toISOString() } = {}) {
  const dir = path.resolve(String(taskDir || '.'));
  const reviewFile = reviewPath ? path.resolve(String(reviewPath)) : path.join(dir, 'review.json');
  const file = path.join(dir, 'review.receipt.json');
  const problems = [];
  const who = String(reviewer || '').trim();
  if (who === '') problems.push('reviewer обязателен');
  if (!fs.existsSync(reviewFile)) problems.push('нет файла review.json: ' + reviewFile);
  if (problems.length > 0) return { ok: false, problems, file, receipt: null };

  const receipt = {
    artifactSha256: sha256File(reviewFile),
    reviewer: who,
    decision: String(decision || 'accept').trim(),
    at: String(at),
    review: path.basename(reviewFile),
  };
  fs.mkdirSync(dir, { recursive: true });
  const tmp = file + '.' + process.pid + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(receipt, null, 2) + '\n');
  fs.renameSync(tmp, file);
  return { ok: true, problems: [], file, receipt };
}
