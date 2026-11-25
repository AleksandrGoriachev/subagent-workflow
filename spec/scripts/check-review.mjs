#!/usr/bin/env node
/*
 * 0158 (R4 письма structure--243): схема review.json проверяется ДО приёмки.
 *
 * Повод: недостающие поля и отсутствие привязки выяснялись на спавне приёмщика —
 * после 15 минут ревью, и лечились новым прогоном ревьюера. CLI переиспользует
 * ту же validateReview, что и приёмка (второго мнения о форме нет), плюс
 * проверяет привязку к контракту и квитанцию, если meta её требует.
 *
 *   node spec/scripts/check-review.mjs --file docs/tasks/0001/review.json \
 *        [--task docs/tasks/0001] [--json]
 *
 * Коды: 0 — ок, 1 — отказ (схема/привязка/квитанция), 2 — нет файла или аргументов.
 */
import fs from 'node:fs';
import path from 'node:path';
import { parseArgv } from './lib/common.mjs';
import { validateReview } from './lib/review.mjs';
import { validateReviewReceipt } from './lib/review-receipt.mjs';
import { readTask } from './lib/common.mjs';

const argv = parseArgv(process.argv.slice(2));
if (argv.help) {
  console.log('Usage: node check-review.mjs --file <review.json> [--task <каталог задания>] [--json]');
  console.log('       Проверяет схему review.json (decision accepted|rework, remarks[]),');
  console.log('       привязку к контракту (contractCommit, taskFileSha256) и квитанцию,');
  console.log('       если meta задания объявляет reviewer/reviewerNode.');
  console.log('       Коды: 0 — ок, 1 — отказ, 2 — нет файла или аргументов.');
  process.exit(0);
}

const errors = [];
const hints = [];
function refuse(message) { errors.push(message); }

const file = argv.file === undefined ? '' : String(argv.file);
if (file === '') {
  console.log('check-review: нужен --file <review.json>');
  process.exit(2);
}
const reviewPath = path.resolve(file);
if (!fs.existsSync(reviewPath)) {
  console.log('check-review: нет файла ' + reviewPath);
  process.exit(2);
}

let review;
try {
  review = JSON.parse(fs.readFileSync(reviewPath, 'utf8').replace(/^\uFEFF/u, ''));
} catch (error) {
  console.log('check-review: review.json не JSON: ' + String(error && error.message ? error.message : error));
  process.exit(1);
}

/* Схема — та же функция, что у приёмки. */
const schema = validateReview(review);
for (const error of schema.errors) refuse(error);
if (review && typeof review === 'object' && review.decision === undefined && review.verdict !== undefined) {
  hints.push('поле verdict не входит в схему: используйте decision accepted|rework');
}
if (review && typeof review === 'object' && review.reviewer === undefined && review.reviewerNode !== undefined) {
  hints.push('поле reviewerNode не входит в схему review: ревьюера объявляет meta задания (reviewer/reviewerNode)');
}

/* Привязка к контракту: значения берём из criteria.lock задания. */
const taskRel = argv.task === undefined ? '' : String(argv.task);
if (taskRel !== '') {
  const taskDir = path.resolve(taskRel);
  const lockFile = path.join(taskDir, 'criteria.lock');
  if (!fs.existsSync(lockFile)) {
    refuse('нет criteria.lock задания: привязку сверить не с чем (' + lockFile + ')');
  } else {
    let lock = null;
    try { lock = JSON.parse(fs.readFileSync(lockFile, 'utf8').replace(/^\uFEFF/u, '')); } catch { lock = null; }
    if (!lock) refuse('criteria.lock не читается: ' + lockFile);
    else {
      const reviewContract = review && review.contractCommit !== undefined && review.contractCommit !== null ? String(review.contractCommit) : null;
      const reviewTaskSha = review && review.taskFileSha256 !== undefined && review.taskFileSha256 !== null ? String(review.taskFileSha256) : null;
      if (reviewContract === null && reviewTaskSha === null) {
        refuse('review без привязки к контракту: нет review.contractCommit и review.taskFileSha256');
        hints.push('привязка: contractCommit = criteria.lock.contractCommit, taskFileSha256 = criteria.lock.taskFileSha256');
      } else {
        if (reviewContract !== null && reviewContract !== String(lock.contractCommit || '')) {
          refuse('review.contractCommit ' + reviewContract + ' не совпадает с контрактом ' + String(lock.contractCommit || '—'));
        }
        if (reviewTaskSha !== null && reviewTaskSha !== String(lock.taskFileSha256 || '')) {
          refuse('review.taskFileSha256 не совпадает с task.md контракта: review выпущен на другую редакцию');
        }
      }
    }
  }
  /* Квитанция: только когда meta её требует — как в приёмке. */
  try {
    const parsed = readTask(path.resolve(taskRel));
    const meta = parsed && parsed.meta ? parsed.meta : null;
    if (meta) {
      const receipt = validateReviewReceipt({ taskDir: path.resolve(taskRel), meta, review, reviewPath });
      if (receipt.applicable && !receipt.ok) for (const problem of receipt.problems) refuse('квитанция: ' + problem);
    }
  } catch (error) {
    refuse('meta задания не читается: ' + String(error && error.message ? error.message : error));
  }
}

const remarks = review && Array.isArray(review.remarks) ? review.remarks : [];
const blocking = remarks.filter((item) => item && item.class === 'blocking' && !(typeof item.resolution === 'string' && item.resolution.trim())).length;
const releaseReady = errors.length === 0 && schema.releaseReady === true;

if (argv.json) {
  console.log(JSON.stringify({
    ok: errors.length === 0,
    errors,
    hints,
    releaseReady,
    remarks: { total: remarks.length, unresolvedBlocking: blocking },
  }, null, 2));
} else if (errors.length === 0) {
  console.log('check-review: ок; releaseReady=' + String(releaseReady)
    + '; замечаний ' + remarks.length + (blocking > 0 ? ' (нерешённых blocking: ' + blocking + ')' : ''));
} else {
  console.log('check-review: отказ');
  for (const error of errors) console.log('  ' + error);
  for (const hint of hints) console.log('  подсказка: ' + hint);
}
process.exit(errors.length === 0 ? 0 : 1);
