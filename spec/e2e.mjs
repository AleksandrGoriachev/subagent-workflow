#!/usr/bin/env node
/*
 * Сквозная проверка «с нуля»: разворачивает рабочее пространство во временном
 * репозитории и проходит полный цикл настоящими воротами.
 *
 * init → new-task → контракт → hash → lint → red → фикс → verify →
 * отказ самоприёмке → accept из другой сессии → check → metadata-коммит → подмена.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wf2-e2e-'));
const repo = path.join(tmp, 'repo');
const keys = path.join(tmp, 'keys');
let failed = 0;

function report(label, ok, detail) {
  if (ok) console.log('PASS  ' + label);
  else { failed += 1; console.log('FAIL  ' + label + (detail ? '\n      ' + String(detail).slice(0, 1200) : '')); }
}

function run(script, args, opts = {}) {
  const r = spawnSync(process.execPath, [path.join(HERE, 'scripts', script), ...args], {
    cwd: opts.cwd || repo,
    env: { ...process.env, ...(opts.env || {}) },
    encoding: 'utf8',
    timeout: 300000,
  });
  return { code: r.status, out: (r.stdout || '') + (r.stderr || '') };
}

function git(args) {
  const r = spawnSync('git', ['-C', repo, ...args], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error('git ' + args.join(' ') + ': ' + r.stderr);
  return r.stdout.trim();
}

function write(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
}

try {
  fs.mkdirSync(repo, { recursive: true });
  git(['init', '-q']);
  git(['config', 'user.email', 'e2e@local']);
  git(['config', 'user.name', 'e2e']);

  const init = run('init.mjs', ['--repo', repo, '--key-out', keys, '--key-id', 'agent-judge']);
  report('init разворачивает рабочее пространство', init.code === 0, init.out);
  report('init создаёт закреплённый ключ', fs.existsSync(path.join(repo, 'docs/subagent-workflow/acceptors.json')) && fs.existsSync(path.join(keys, 'agent-judge.key.pem')));

  const secondRepo = path.join(tmp, 'second');
  const secondKeys = path.join(tmp, 'keys-second');
  const deployedInit = path.join(repo, 'docs/subagent-workflow/scripts/init.mjs');
  const secondInit = spawnSync(process.execPath, [deployedInit, '--repo', secondRepo, '--key-out', secondKeys], { encoding: 'utf8' });
  report(
    'init из развёрнутого каталога создаёт свой ключ, а не копирует acceptors.json',
    secondInit.status === 0 && fs.existsSync(path.join(secondKeys, 'agent-judge.key.pem')),
    (secondInit.stdout || '') + (secondInit.stderr || ''),
  );

  const task = run('new-task.mjs', ['--repo', repo, '--id', '0001', '--title', 'Сложение', '--risk', 'medium'], { env: { DSH_SESSION_ID: 'issuer-session', DSH_MODEL: 'e2e-model' } });
  report('new-task создаёт задание с issuedBy', task.code === 0 && fs.readFileSync(path.join(repo, 'docs/tasks/0001/task.md'), 'utf8').includes('issuer-session'), task.out);

  /*
   * Решение (2.1.0): семантический выбор «что считается сложением» подтверждён
   * исполняемым критерием C1. В контракт решение попадает до коммита — значит,
   * заморожено вместе с критериями.
   */
  const taskMdPath = path.join(repo, 'docs/tasks/0001/task.md');
  const taskMdRaw = fs.readFileSync(taskMdPath, 'utf8');
  const metaMatch = taskMdRaw.match(/<!--\s*TASK-META\s*([\s\S]*?)-->/);
  const taskMeta = JSON.parse(metaMatch[1]);
  taskMeta.decisions = [{
    id: 'D1',
    class: 'semantic',
    question: 'что считается результатом сложения',
    chosen: 'арифметическая сумма',
    options: ['сумма', 'конкатенация'],
    impact: 'user-visible',
    reversible: false,
    evidence: { kind: 'criterion', ref: 'C1' },
    status: 'confirmed',
  }];
  fs.writeFileSync(taskMdPath, taskMdRaw.replace(metaMatch[0], '<!-- TASK-META\n' + JSON.stringify(taskMeta, null, 2) + '\n-->'));

  const criteriaBody = {
    task: '0001',
    setup: [],
    teardown: [],
    redExpect: { mustFail: ['C1'], mustPass: ['C2'], reasons: { C1: 'sum is wrong' } },
    criteria: [
      { id: 'C1', title: 'сложение', command: 'node checks/add.mjs', timeoutMs: 60000, covers: ['src/app.js'], expect: { exitCode: 0, stdoutContains: 'ok 3' }, tags: ['fast', 'behavior'] },
      { id: 'C2', title: 'негатив', command: 'node checks/negative.mjs', timeoutMs: 60000, expect: { exitCode: 1, stderrContains: 'invalid input' }, tags: ['fast', 'negative'] },
    ],
  };
  const criteriaPath = path.join(repo, 'docs/tasks/0001/criteria.json');
  write(criteriaPath, JSON.stringify(criteriaBody, null, 2) + '\n');

  /* Без covers описывать нечего — для medium это ошибка lint, а не пожелание. */
  const coversOff = { ...criteriaBody, criteria: criteriaBody.criteria.map((c) => { const copy = { ...c }; delete copy.covers; return copy; }) };
  write(criteriaPath, JSON.stringify(coversOff, null, 2) + '\n');
  const noCovers = run('task-lint.mjs', ['--task', 'docs/tasks/0001']);
  report('lint требует covers для medium', noCovers.code !== 0 && /covers/.test(noCovers.out), noCovers.out);
  write(criteriaPath, JSON.stringify(criteriaBody, null, 2) + '\n');

  /* Семантическое решение о пользовательском контракте без доказательства — ошибка. */
  const goodTaskMd = fs.readFileSync(taskMdPath, 'utf8');
  const badMeta = {
    ...taskMeta,
    decisions: [{
      id: 'D1', class: 'semantic', question: 'что считается доставкой', chosen: 'по ощущению',
      options: ['доставлено', 'отправлено'], impact: 'user-visible', reversible: false,
    }],
  };
  fs.writeFileSync(taskMdPath, goodTaskMd.replace(/<!--\s*TASK-META\s*[\s\S]*?-->/, '<!-- TASK-META\n' + JSON.stringify(badMeta, null, 2) + '\n-->'));
  const noProof = run('task-lint.mjs', ['--task', 'docs/tasks/0001']);
  report('lint отклоняет семантическое решение без доказательства', noProof.code !== 0 && /доказательств|подтвержден/.test(noProof.out), noProof.out);
  fs.writeFileSync(taskMdPath, goodTaskMd);
  write(path.join(repo, 'checks/add.mjs'), 'const { add } = await import("../src/app.js");\nif (add(1, 2) !== 3) { console.error("sum is wrong: " + add(1, 2)); process.exit(1); }\nconsole.log("ok " + add(1, 2));\n');
  write(path.join(repo, 'checks/negative.mjs'), 'console.error("invalid input: rejected as expected"); process.exit(1);\n');
  write(path.join(repo, 'src/app.js'), 'export const add = (a, b) => a - b;\n');
  git(['add', '-A']);
  git(['commit', '-q', '-m', 'task 0001: контракт']);
  const contractCommit = git(['rev-parse', 'HEAD']);

  const hash = run('task-hash.mjs', ['--task', 'docs/tasks/0001', '--write']);
  report('hash создаёт замок для закоммиченного контракта', hash.code === 0, hash.out);
  const lint = run('task-lint.mjs', ['--task', 'docs/tasks/0001', '--strict']);
  report('lint --strict зелёный', lint.code === 0, lint.out);
  const red = run('task-red.mjs', ['--task', 'docs/tasks/0001', '--base', 'HEAD']);
  report('red доказывает падение по ожиданию', red.code === 0 && fs.readFileSync(path.join(repo, 'docs/tasks/0001/red.json'), 'utf8').includes('"ok": true'), red.out);

  write(path.join(repo, 'src/app.js'), 'export const add = (a, b) => a + b;\n');
  const verify = run('task-verify.mjs', ['--task', 'docs/tasks/0001']);
  report('verify зелёный после фикса', verify.code === 0, verify.out);

  fs.writeFileSync(path.join(repo, 'src/extra.js'), 'export const extra = 1;\n');
  const uncovered = run('task-verify.mjs', ['--task', 'docs/tasks/0001']);
  report('verify валит изменённый файл без покрытия критерием', uncovered.code !== 0 && /не покрыт/.test(uncovered.out), uncovered.out);
  fs.rmSync(path.join(repo, 'src/extra.js'));
  const verifyAgain = run('task-verify.mjs', ['--task', 'docs/tasks/0001']);
  report('после удаления непокрытого файла verify снова зелёный', verifyAgain.code === 0, verifyAgain.out);

  const selfAccept = run('task-accept.mjs', ['--task', 'docs/tasks/0001', '--acceptor', 'judge', '--key', path.join(keys, 'agent-judge.key.pem'), '--key-id', 'agent-judge'], { env: { DSH_SESSION_ID: 'issuer-session' } });
  report('самоприёмка из сессии постановщика отклоняется', selfAccept.code !== 0 && /issuedBy/.test(selfAccept.out), selfAccept.out);

  const blockingReview = path.join(tmp, 'review-blocking.json');
  fs.writeFileSync(blockingReview, JSON.stringify({ decision: 'accepted', remarks: [{ id: 'R1', class: 'blocking' }] }, null, 2));
  const blockedAccept = run('task-accept.mjs', ['--task', 'docs/tasks/0001', '--acceptor', 'judge', '--key', path.join(keys, 'agent-judge.key.pem'), '--key-id', 'agent-judge', '--review', blockingReview], { env: { DSH_SESSION_ID: 'judge-session' } });
  report('blocking-замечание без решения не принимается', blockedAccept.code !== 0 && /blocking/.test(blockedAccept.out), blockedAccept.out);

  const reviewFile = path.join(tmp, 'review-ok.json');
  fs.writeFileSync(reviewFile, JSON.stringify({
    decision: 'accepted',
    remarks: [
      { id: 'R1', class: 'blocking', resolution: 'исправлено в кандидате' },
      { id: 'R2', class: 'non-blocking', reason: 'вне объёма' },
      { id: 'R3', class: 'follow-up', followUpId: '0070' },
    ],
  }, null, 2));

  const accept = run('task-accept.mjs', ['--task', 'docs/tasks/0001', '--acceptor', 'judge', '--key', path.join(keys, 'agent-judge.key.pem'), '--key-id', 'agent-judge', '--review', reviewFile], { env: { DSH_SESSION_ID: 'judge-session' } });
  report('accept из другой сессии принимает задачу', accept.code === 0, accept.out);
  const acceptancePath = path.join(repo, 'docs/tasks/0001/acceptance.json');
  const record = JSON.parse(fs.readFileSync(acceptancePath, 'utf8'));
  report('разбор замечаний и releaseReady в записи', record.releaseReady === true && record.review && record.review.remarks.length === 3, JSON.stringify({ releaseReady: record.releaseReady, review: record.review }));
  report('запись v5 с актором и уровнем независимости',
    record.version === 5 && record.actor.session === 'judge-session' && record.independence.level === 'separate-session' && record.signatureAlgorithm === 'ed25519' && record.contractCommit === contractCommit,
    JSON.stringify({ version: record.version, actor: record.actor, level: record.independence.level }));
  report('решения записаны с digest и без assumed',
    record.decisions && record.decisions.count === 1 && record.decisions.assumed.length === 0 && /^[0-9a-f]{64}$/.test(record.decisions.digest),
    JSON.stringify(record.decisions));

  const check = run('task-check-acceptance.mjs', ['--file', acceptancePath, '--repo', repo]);
  report('check-acceptance принимает запись', check.code === 0, check.out);

  git(['reset', '--hard', record.candidateCommit]);
  git(['add', 'docs/tasks/0001/acceptance.json']);
  git(['commit', '-q', '-m', 'task 0001: приёмка (metadata)']);
  const metadataCommit = git(['rev-parse', 'HEAD']);
  const checkMeta = run('task-check-acceptance.mjs', ['--file', acceptancePath, '--repo', repo, '--metadata', metadataCommit]);
  report('check-acceptance проверяет metadata-коммит', checkMeta.code === 0, checkMeta.out);

  const tampered = { ...record, notes: 'подмена' };
  fs.writeFileSync(acceptancePath, JSON.stringify(tampered, null, 2) + '\n');
  const tamperCheck = run('task-check-acceptance.mjs', ['--file', acceptancePath, '--repo', repo]);
  report('подмена записи ловится', tamperCheck.code !== 0, tamperCheck.out);
} catch (err) {
  failed += 1;
  console.error('E2E ERROR: ' + err.stack);
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}

if (failed) {
  console.log('\nE2E FAILED: ' + failed);
  process.exit(1);
}
console.log('\nE2E OK');
