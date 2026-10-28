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

  /*
   * Политика ворот для сценария: атака обязательна (fail), семейства моделей
   * только предупреждают. Проверяем и настройку, и сами ворота.
   */
  const configPath = path.join(repo, 'docs/subagent-workflow/workflow.config.json');
  const workflowConfig = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  workflowConfig.policy = { decisions: 'fail', coverage: 'fail', attack: 'fail', roles: { modelFamily: 'warn' } };
  workflowConfig.models = { 'e2e-model': 'family-a', 'critic-model': 'family-b', 'judge-model': 'family-b' };
  fs.writeFileSync(configPath, JSON.stringify(workflowConfig, null, 2) + '\n');

  /*
   * 2.4.1: e2e-deploy обязан работать и из развёрнутой копии — раньше он искал
   * корень как HERE/.. и падал на docs/VERSION.
   */
  const deployedDeploy = spawnSync(process.execPath, [path.join(repo, 'docs/subagent-workflow/e2e-deploy.mjs')], {
    cwd: repo, encoding: 'utf8', timeout: 300000,
  });
  report('e2e-deploy запускается из развёрнутой копии',
    deployedDeploy.status === 0 && /DEPLOY E2E OK/.test((deployedDeploy.stdout || '') + (deployedDeploy.stderr || '')),
    (deployedDeploy.stdout || '') + (deployedDeploy.stderr || ''));

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
  const taskMdWithC3 = taskMdRaw.replace(
    '| C2 | <негативный случай> | <наблюдаемое поведение> |',
    '| C2 | <негативный случай> | <наблюдаемое поведение> |\n| C3 | node src/cli.mjs 1 2 | эффект: пользователь получает сумму, порог sum 3 (измеряет C1) |',
  );
  fs.writeFileSync(taskMdPath, taskMdWithC3.replace(metaMatch[0], '<!-- TASK-META\n' + JSON.stringify(taskMeta, null, 2) + '\n-->'));

  const criteriaBody = {
    task: '0001',
    setup: [],
    teardown: [],
    redExpect: { mustFail: ['C1', 'C3'], mustPass: ['C2'], reasons: { C1: 'sum is wrong', C3: 'sum -1' } },
    criteria: [
      { id: 'C1', title: 'сложение', command: 'node checks/add.mjs', timeoutMs: 60000, covers: ['src/app.js'], expect: { exitCode: 0, stdoutContains: 'ok 3' }, tags: ['fast', 'behavior'] },
      { id: 'C2', title: 'негатив', command: 'node checks/negative.mjs', timeoutMs: 60000, expect: { exitCode: 1, stderrContains: 'invalid input' }, tags: ['fast', 'negative'] },
      {
        id: 'C3',
        title: 'эффект для пользователя',
        command: 'node src/cli.mjs 1 2',
        timeoutMs: 60000,
        covers: ['src/app.js', 'src/cli.mjs'],
        effect: { observable: 'пользователь получает сумму', threshold: 'sum 3', measuredBy: 'C1' },
        expect: { exitCode: 0, stdoutContains: 'sum 3' },
        tags: ['fast', 'behavior'],
      },
    ],
  };
  const criteriaPath = path.join(repo, 'docs/tasks/0001/criteria.json');
  write(criteriaPath, JSON.stringify(criteriaBody, null, 2) + '\n');
  report('G6: C3 — самостоятельный сценарий, а не копия C1',
    criteriaBody.criteria[0].command !== criteriaBody.criteria[2].command
      && /cli\.mjs/.test(criteriaBody.criteria[2].command),
    JSON.stringify({ c1: criteriaBody.criteria[0].command, c3: criteriaBody.criteria[2].command }));

  /* Без covers описывать нечего — для medium это ошибка lint, а не пожелание. */
  const coversOff = { ...criteriaBody, criteria: criteriaBody.criteria.map((c) => { const copy = { ...c }; delete copy.covers; return copy; }) };
  write(criteriaPath, JSON.stringify(coversOff, null, 2) + '\n');
  const noCovers = run('task-lint.mjs', ['--task', 'docs/tasks/0001']);
  report('lint требует covers для medium', noCovers.code !== 0 && /covers/.test(noCovers.out), noCovers.out);
  write(criteriaPath, JSON.stringify(criteriaBody, null, 2) + '\n');

  /*
   * Решение влияет на пользователя, значит нужен критерий эффекта (I-31). Без него
   * «зелёный» доказывает вызов, а не результат.
   */
  const effectOff = { ...criteriaBody, criteria: criteriaBody.criteria.map((c) => { const copy = { ...c }; delete copy.effect; return copy; }) };
  write(criteriaPath, JSON.stringify(effectOff, null, 2) + '\n');
  const noEffect = run('task-lint.mjs', ['--task', 'docs/tasks/0001']);
  report('lint требует критерий эффекта для решения с влиянием на пользователя', noEffect.code !== 0 && /effect/.test(noEffect.out), noEffect.out);
  write(criteriaPath, JSON.stringify(criteriaBody, null, 2) + '\n');

  /* 2.3.1: измеритель эффекта обязан быть другим критерием. */
  const selfMeasured = {
    ...criteriaBody,
    criteria: criteriaBody.criteria.map((c) => (c.id === 'C3'
      ? { ...c, effect: { ...c.effect, measuredBy: 'C3' } }
      : c)),
  };
  write(criteriaPath, JSON.stringify(selfMeasured, null, 2) + '\n');
  const selfEffect = run('task-lint.mjs', ['--task', 'docs/tasks/0001']);
  report('lint отклоняет effect.measuredBy на сам критерий', selfEffect.code !== 0 && /сам критерий/.test(selfEffect.out), selfEffect.out);
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

  /* 2.4.0 (I-34): решение доказывается критерием вне цепи эффекта — ошибка. */
  const offChainMeta = {
    ...taskMeta,
    decisions: [{ ...taskMeta.decisions[0], evidence: { kind: 'criterion', ref: 'C2' } }],
  };
  fs.writeFileSync(taskMdPath, goodTaskMd.replace(/<!--\s*TASK-META\s*[\s\S]*?-->/, '<!-- TASK-META\n' + JSON.stringify(offChainMeta, null, 2) + '\n-->'));
  const offChain = run('task-lint.mjs', ['--task', 'docs/tasks/0001']);
  report('G2: lint отклоняет решение вне цепи эффекта', offChain.code !== 0 && /не входит в цепь/.test(offChain.out), offChain.out);
  fs.writeFileSync(taskMdPath, goodTaskMd);

  write(path.join(repo, 'checks/add.mjs'), 'const { add } = await import("../src/app.js");\nif (add(1, 2) !== 3) { console.error("sum is wrong: " + add(1, 2)); process.exit(1); }\nconsole.log("ok " + add(1, 2));\n');
  write(path.join(repo, 'checks/negative.mjs'), 'console.error("invalid input: rejected as expected"); process.exit(1);\n');
  write(path.join(repo, 'src/cli.mjs'), 'import { add } from "./app.js";\nconst [a, b] = process.argv.slice(2).map(Number);\nconsole.log("sum " + add(a, b));\n');
  write(path.join(repo, 'src/app.js'), 'export const add = (a, b) => a - b;\n');
  git(['add', '-A']);
  git(['commit', '-q', '-m', 'task 0001: контракт']);
  const contractCommit = git(['rev-parse', 'HEAD']);

  const noAttack = run('task-hash.mjs', ['--task', 'docs/tasks/0001', '--write']);
  report('hash без атаки отказывает при policy.attack=fail', noAttack.code !== 0 && /атак/i.test(noAttack.out), noAttack.out);

  const attackPath = path.join(repo, 'docs/tasks/0001/attack.json');
  const attack = {
    version: 1,
    task: '0001',
    createdAt: new Date().toISOString(),
    critic: { session: 'critic-session', model: 'critic-model', attestedBy: 'env' },
    findings: [
      { id: 'A1', class: 'missing-case', severity: 'blocking', claim: 'нет случая с отрицательными числами', case: 'add(-1, 2)', resolution: null },
      { id: 'A2', class: 'ambiguous-criterion', severity: 'non-blocking', claim: 'C1 не говорит про тип аргументов', case: 'add("1", 2)', reason: 'вне объёма задачи' },
      { id: 'A3', class: 'undefined-failure-mode', severity: 'follow-up', claim: 'нет поведения при переполнении', case: 'Number.MAX_SAFE_INTEGER + 1', followUpId: '0002' },
    ],
  };
  fs.writeFileSync(attackPath, JSON.stringify(attack, null, 2) + '\n');
  const blockedHash = run('task-hash.mjs', ['--task', 'docs/tasks/0001', '--write']);
  report('hash не запирает контракт с нерешённой blocking-находкой', blockedHash.code !== 0 && /resolution/.test(blockedHash.out), blockedHash.out);
  const blockedAttack = run('task-attack.mjs', ['--task', 'docs/tasks/0001', '--check']);
  report('task-attack отклоняет нерешённый blocking', blockedAttack.code !== 0, blockedAttack.out);
  attack.findings[0].resolution = 'добавлен граничный случай в C1';
  fs.writeFileSync(attackPath, JSON.stringify(attack, null, 2) + '\n');
  const attackCheck = run('task-attack.mjs', ['--task', 'docs/tasks/0001', '--check']);
  report('task-attack принимает закрытую находку', attackCheck.code === 0, attackCheck.out);

  const hash = run('task-hash.mjs', ['--task', 'docs/tasks/0001', '--write']);
  report('hash создаёт замок для закоммиченного контракта', hash.code === 0, hash.out);
  const lint = run('task-lint.mjs', ['--task', 'docs/tasks/0001', '--strict']);
  report('lint --strict зелёный', lint.code === 0, lint.out);
  const red = run('task-red.mjs', ['--task', 'docs/tasks/0001', '--base', 'HEAD']);
  report('red доказывает падение по ожиданию', red.code === 0 && fs.readFileSync(path.join(repo, 'docs/tasks/0001/red.json'), 'utf8').includes('"ok": true'), red.out);

  write(path.join(repo, 'src/app.js'), 'export const add = (a, b) => a + b;\n');
  const verify = run('task-verify.mjs', ['--task', 'docs/tasks/0001']);
  report('verify зелёный после фикса', verify.code === 0, verify.out);
  const verifyJson = JSON.parse(fs.readFileSync(path.join(repo, 'docs/tasks/0001/verify.json'), 'utf8'));
  report('verify записывает эффект и цепь решения', Array.isArray(verifyJson.effects && verifyJson.effects.declared)
    && verifyJson.effects.declared.length === 1 && verifyJson.effects.declared[0].measuredBy === 'C1'
    && verifyJson.effects.checked === true && verifyJson.effects.ok === true
    && Array.isArray(verifyJson.effects.links) && verifyJson.effects.links.length === 1
    && verifyJson.effects.links[0].decision === 'D1' && verifyJson.effects.links[0].carrier === 'C3',
    JSON.stringify(verifyJson.effects));

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

  const accept = run('task-accept.mjs', ['--task', 'docs/tasks/0001', '--acceptor', 'judge', '--key', path.join(keys, 'agent-judge.key.pem'), '--key-id', 'agent-judge', '--review', reviewFile], { env: { DSH_SESSION_ID: 'judge-session', DSH_MODEL: 'judge-model' } });
  report('accept из другой сессии принимает задачу', accept.code === 0, accept.out);
  const acceptancePath = path.join(repo, 'docs/tasks/0001/acceptance.json');
  const record = JSON.parse(fs.readFileSync(acceptancePath, 'utf8'));
  report('разбор замечаний и releaseReady в записи', record.releaseReady === true && record.review && record.review.remarks.length === 3, JSON.stringify({ releaseReady: record.releaseReady, review: record.review }));
  report('запись v6 с актором и уровнем независимости',
    record.version === 6 && record.actor.session === 'judge-session' && record.independence.level === 'separate-session' && record.signatureAlgorithm === 'ed25519' && record.contractCommit === contractCommit,
    JSON.stringify({ version: record.version, actor: record.actor, level: record.independence.level }));
  report('эффект записан в приёмку с измерителем',
    Array.isArray(record.effects) && record.effects.length === 1 && record.effects[0].measuredBy === 'C1',
    JSON.stringify(record.effects));
  report('G3: запись хранит согласованность решения и эффекта',
    record.effectConsistency && record.effectConsistency.checked === true && record.effectConsistency.ok === true
      && record.effectConsistency.mode === 'fail' && Array.isArray(record.effectConsistency.links)
      && record.effectConsistency.links.length === 1 && record.effectConsistency.links[0].decision === 'D1'
      && record.effectConsistency.links[0].carrier === 'C3',
    JSON.stringify(record.effectConsistency));
  report('решения записаны с digest и без assumed',
    record.decisions && record.decisions.count === 1 && record.decisions.assumed.length === 0 && /^[0-9a-f]{64}$/.test(record.decisions.digest),
    JSON.stringify(record.decisions));
  report('атака попала в запись с digest и без нерешённых находок',
    record.attack && /^[0-9a-f]{64}$/.test(record.attack.sha256) && record.attack.findings.unresolved === 0 && record.attack.session === 'critic-session',
    JSON.stringify(record.attack));
  report('проверка ролей: приёмщик другого семейства, чем постановщик',
    record.independence.modelLevel === 'different-family' && record.actor.family === 'family-b',
    JSON.stringify({ modelLevel: record.independence.modelLevel, family: record.actor.family }));

  const check = run('task-check-acceptance.mjs', ['--file', acceptancePath, '--repo', repo]);
  report('check-acceptance принимает запись', check.code === 0, check.out);

  git(['reset', '--hard', record.candidateCommit]);
  git(['add', 'docs/tasks/0001/acceptance.json']);
  git(['commit', '-q', '-m', 'task 0001: приёмка (metadata)']);
  const metadataCommit = git(['rev-parse', 'HEAD']);
  const checkMeta = run('task-check-acceptance.mjs', ['--file', acceptancePath, '--repo', repo, '--metadata', metadataCommit]);
  report('check-acceptance проверяет metadata-коммит', checkMeta.code === 0, checkMeta.out);

  /*
   * 2.4.8: у принятого задания HEAD уходит всегда (metadata-коммит, потом обычная
   * работа). Раньше на этом стояло вечное «criteria.lock: contractCommit:
   * ожидалось …» — видели на 0001 здесь и на 0103 в ws-school-app. Сдвиг HEAD
   * теперь предупреждение; ошибкой он остаётся до приёмки, где он по делу.
   */
  const acceptedLint = run('task-lint.mjs', ['--task', 'docs/tasks/0001']);
  report('2.4.8: у принятого задания сдвиг HEAD — предупреждение, не ошибка',
    !/ERROR criteria\.lock: contractCommit/.test(acceptedLint.out) && /WARN\s+criteria\.lock: contractCommit/.test(acceptedLint.out),
    acceptedLint.out);

  /*
   * G4/G5 (2.4.0): строгость согласованности — policy.decisions. Отдельная
   * low-задача без замка: lint не требует ни covers, ни redExpect, поэтому
   * единственная ошибка — решение вне цепи эффекта.
   */
  const policyTask = path.join(repo, 'docs/tasks', '0002');
  const miniMeta = {
    id: '0002', version: 1, risk: 'low', created: '2026-10-27',
    owner: 'architect', executor: 'subagent:executor', acceptor: 'subagent:judge',
    base: 'HEAD', criteria: 'criteria.json', allowedPaths: ['src/**'], hashExclude: [],
    decisions: [{
      id: 'D1', class: 'semantic', question: 'что считается результатом', chosen: 'сумма',
      options: ['сумма', 'конкатенация'], impact: 'user-visible', reversible: false,
      evidence: { kind: 'criterion', ref: 'C2' },
    }],
  };
  const miniTaskMd = [
    '# Задание 0002',
    '',
    '<!-- TASK-META\n' + JSON.stringify(miniMeta, null, 2) + '\n-->',
    '',
    '## Цель',
    '',
    'Проверка политики согласованности.',
    '',
    '## Что не входит',
    '',
    '1. Реальная работа: задание создано только для проверки lint.',
    '',
    '## Инварианты',
    '',
    '1. Ничего не исполняется.',
    '',
    '## Границы знания',
    '',
    '1. Только этот каталог.',
    '',
    '## Среда',
    '',
    '- Node.js.',
    '',
    '## Критерии приёмки',
    '',
    '<!-- CRITERIA:BEGIN -->',
    '| ID | Проверка | Ожидание |',
    '| --- | --- | --- |',
    '| C1 | node checks/add.mjs | ok 3 |',
    '| C2 | node checks/negative.mjs | exit 1 |',
    '| C3 | node src/cli.mjs 1 2 | sum 3 |',
    '<!-- CRITERIA:END -->',
    '',
    '## Отчёт',
    '',
    '1. Не требуется.',
    '',
    '## Коммит',
    '',
    '1. Не требуется.',
    '',
  ].join('\n');
  write(path.join(policyTask, 'task.md'), miniTaskMd);
  write(path.join(policyTask, 'criteria.json'), JSON.stringify({
    task: '0002',
    criteria: [
      { id: 'C1', title: 'сложение', command: 'node checks/add.mjs', covers: ['src/**'], expect: { exitCode: 0, stdoutContains: 'ok 3' } },
      { id: 'C2', title: 'негатив', command: 'node checks/negative.mjs', tags: ['negative'], expect: { exitCode: 1, stderrContains: 'invalid input' } },
      { id: 'C3', title: 'эффект', command: 'node src/cli.mjs 1 2', covers: ['src/**'], effect: { observable: 'сумма', threshold: 'sum 3', measuredBy: 'C1' }, expect: { exitCode: 0, stdoutContains: 'sum 3' } },
    ],
  }, null, 2) + '\n');
  const baseConfig = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  const setDecisions = (level) => {
    const cfg = JSON.parse(JSON.stringify(baseConfig));
    cfg.policy = { ...cfg.policy, decisions: level };
    fs.writeFileSync(configPath, JSON.stringify(cfg, null, 2) + '\n');
  };
  const miniFail = run('task-lint.mjs', ['--task', 'docs/tasks/0002']);
  report('G4: policy.decisions=fail отклоняет решение вне цепи', miniFail.code !== 0 && /не входит в цепь/.test(miniFail.out), miniFail.out);
  setDecisions('warn');
  const miniWarn = run('task-lint.mjs', ['--task', 'docs/tasks/0002']);
  report('G4: policy.decisions=warn — предупреждение, exit 0', miniWarn.code === 0 && /не входит в цепь/.test(miniWarn.out), miniWarn.out);
  setDecisions('off');
  const miniOff = run('task-lint.mjs', ['--task', 'docs/tasks/0002']);
  report('G5: policy.decisions=off — ни ошибки, ни предупреждения', miniOff.code === 0 && !/не входит в цепь/.test(miniOff.out), miniOff.out);
  fs.writeFileSync(configPath, JSON.stringify(baseConfig, null, 2) + '\n');

  /*
   * 2.4.6: движок не защищаем. Задание, чей protectedPaths накрывает сам пакет,
   * обречено: обновление пакета меняет эти файлы, замок краснеет, перезамок после
   * красного запрещён. Lint обязан сказать это словами, а не молчать.
   */
  const engineMeta = { ...miniMeta, protectedPaths: ['checks/**', 'docs/subagent-workflow/**'] };
  write(path.join(policyTask, 'task.md'), miniTaskMd.replace(
    JSON.stringify(miniMeta, null, 2),
    JSON.stringify(engineMeta, null, 2),
  ));
  const engineProtect = run('task-lint.mjs', ['--task', 'docs/tasks/0002']);
  report('G7: защита самого пакета в protectedPaths называется предупреждением',
    /protectedPaths включает сам пакет/.test(engineProtect.out) && /docs\/subagent-workflow\/\*\*/.test(engineProtect.out),
    engineProtect.out);
  write(path.join(policyTask, 'task.md'), miniTaskMd);
  const engineRestored = run('task-lint.mjs', ['--task', 'docs/tasks/0002']);
  report('G7: без пакета в protectedPaths предупреждения нет',
    !/protectedPaths включает сам пакет/.test(engineRestored.out), engineRestored.out);

  /*
   * Regress (2.3.0, R-5): закрытая задача перезапускается. Сломанная проверка
   * закрытого задания — регресс, а не тишина.
   */
  const regressOk = run('task-regress.mjs', ['--repo', repo, '--task', 'docs/tasks/0001']);
  report('regress принятой задачи зелёный', regressOk.code === 0 && /Итог: ok 1/.test(regressOk.out), regressOk.out);
  write(path.join(repo, 'src/app.js'), 'export const add = (a, b) => a - b;\n');
  const regressed = run('task-regress.mjs', ['--repo', repo, '--task', 'docs/tasks/0001']);
  report('regress ловит сломанную проверку закрытой задачи', regressed.code !== 0 && /regressed/.test(regressed.out), regressed.out);
  git(['checkout', '--', 'src/app.js']);

  /* 2.4.1: таймаут критерия — провал, но в выводе он помечен отдельно. */
  const timeoutCriteria = JSON.parse(fs.readFileSync(criteriaPath, 'utf8'));
  const timeoutC1 = timeoutCriteria.criteria.find((criterion) => criterion.id === 'C1');
  timeoutC1.command = 'node -e "setTimeout(() => {}, 5000)"';
  timeoutC1.timeoutMs = 100;
  fs.writeFileSync(criteriaPath, JSON.stringify(timeoutCriteria, null, 2) + '\n');
  const timedOut = run('task-regress.mjs', ['--repo', '.', '--task', 'docs/tasks/0001']);
  report('regress помечает таймаут отдельно',
    timedOut.code !== 0 && /\(таймаут\)/.test(timedOut.out) && /timeout 1/.test(timedOut.out),
    timedOut.out);
  git(['checkout', '--', 'docs/tasks/0001/criteria.json']);

  const tampered = { ...record, notes: 'подмена' };
  fs.writeFileSync(acceptancePath, JSON.stringify(tampered, null, 2) + '\n');
  const tamperCheck = run('task-check-acceptance.mjs', ['--file', acceptancePath, '--repo', repo]);
  report('подмена записи ловится', tamperCheck.code !== 0, tamperCheck.out);
} catch (err) {
  failed += 1;
  console.error('E2E ERROR: ' + err.stack);
} finally {
  /*
   * На Windows каталог может быть ещё занят только что завершившимся дочерним
   * процессом: ретраи и best-effort, чтобы уборка не превращала зелёный прогон
   * в случайный EPERM.
   */
  try { fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 50, retryDelay: 200 }); } catch { /* оставить ОС */ }
}

if (failed) {
  console.log('\nE2E FAILED: ' + failed);
  process.exit(1);
}
console.log('\nE2E OK');
