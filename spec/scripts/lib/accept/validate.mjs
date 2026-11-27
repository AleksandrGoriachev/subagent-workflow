/*
 * 0184: проверка verify-входа и сохранение доказательства исполнителя —
 * вынесены из task-accept.mjs.
 */
import fs from 'node:fs';
import path from 'node:path';
import { exists } from '../common.mjs';
import { fail } from './progress.mjs';

/**
 * F-8 (2.6.4): verify.json исполнителя не теряется: свежий прогон приёмщика
 * перезаписывает его, поэтому прежний результат сохраняется рядом как
 * verify.executor.json — ДО preflight и до нового прогона.
 */
export function backupExecutorVerify(taskDir) {
  const executorVerify = path.join(taskDir, 'verify.json');
  const savedExecutorVerify = path.join(taskDir, 'verify.executor.json');
  if (exists(executorVerify)) {
    try {
      fs.copyFileSync(executorVerify, savedExecutorVerify);
    } catch (err) {
      fail('не удалось сохранить verify.executor.json: ' + err.message);
    }
  }
}

export function validateVerify(verify, lockCheck, contractCommit, nonce) {
  if (verify.version !== 4) fail('verify.json: версия ' + verify.version + ' устарела, нужна 4 — прогоните task-verify заново');
  if (verify.kind !== 'verify') fail('verify.json: это не результат task-verify');
  if (verify.task !== String(lockCheck.expected.task)) fail('verify.json относится к другой задаче: ' + verify.task);
  if (!verify.allPassed) fail('verify.json не зелёный: allPassed=false');
  if (Array.isArray(verify.violations) && verify.violations.length > 0) fail('в verify.json есть нарушения: ' + verify.violations.join('; '));
  for (const key of ['criteriaSha256', 'criteriaJsonSha256', 'taskFileSha256', 'contractCommit']) {
    if (verify[key] !== lockCheck.expected[key]) fail(key + ' в verify.json не совпадает с lock');
  }
  /* 0170: локальный прогон (vcs=none) не имеет HEAD — сравнение с контрактным коммитом не применимо. */
  if (verify.vcs !== 'none' && verify.headSha !== contractCommit) fail('HEAD изменился после verify: ' + verify.headSha + ' -> ' + contractCommit);
  if (nonce !== null && verify.acceptanceNonce !== nonce) fail('verify.json не содержит nonce приёмщика: результат не от свежего прогона');
}
