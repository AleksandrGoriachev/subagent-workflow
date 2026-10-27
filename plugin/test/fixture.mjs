/**
 * Test fixture: a temporary git repository shaped like a deployed
 * subagent-workflow workspace. It starts from \`examples/minimal\` and adds the
 * artifacts a real task accumulates: lock v3, attack, red, verify and an
 * acceptance record (v6 by default, v3 for the legacy case).
 *
 * Spec helpers are imported on purpose: the fixture's hashes and decision
 * summary are produced by the gates' own code, so the state test proves parity
 * instead of restating the formulas.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runGit } from '../lib/state.js';
import {
  canonicalize,
  sha256,
  sha256File,
  extractCriteriaBlock,
  summarizeDecisions,
} from '../../spec/scripts/lib/common.mjs';
import { validateAttack } from '../../spec/scripts/lib/attack.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '..', '..');
const EXAMPLES = path.join(REPO_ROOT, 'examples', 'minimal');

export const ISSUER = { kind: 'agent', session: 'issuer-session', model: 'model-a' };
export const JUDGE = { kind: 'agent', session: 'judge-session', model: 'model-b' };
export const CRITIC = { session: 'critic-session', model: 'model-b', attestedBy: 'env' };

export const DECISIONS = [
  {
    id: 'D1',
    class: 'semantic',
    impact: 'user-visible',
    what: 'сумма показывается пользователю',
    evidence: { kind: 'criterion', ref: 'C1' },
  },
  {
    id: 'D2',
    class: 'semantic',
    impact: 'internal',
    what: 'внутренний выбор без наблюдаемого контракта',
  },
];

export function git(cwd, args) {
  const result = runGit(cwd, args);
  if (!result.ok) {
    throw new Error('git ' + args.join(' ') + ': ' + (result.stderr || result.stdout || String(result.error || 'failed')));
  }
  return (result.stdout || '').trim();
}

function write(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text, 'utf8');
}

function writeJson(file, value) {
  write(file, JSON.stringify(value, null, 2) + '\n');
}

function copyFile(from, to) {
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.copyFileSync(from, to);
}

function replaceMeta(taskMd, meta) {
  return taskMd.replace(/<!--\s*TASK-META\s*([\s\S]*?)-->/, () =>
    '<!-- TASK-META\n' + JSON.stringify(meta, null, 2) + '\n-->');
}

function configFor(policyAttack) {
  return {
    version: 1,
    tasksDir: 'docs/tasks',
    keysFile: 'docs/subagent-workflow/acceptors.json',
    logs: 'local',
    actor: { primaryEnv: 'DSH_SESSION_ID', fallbackEnv: 'TASK_ACTOR_SESSION', modelEnv: 'DSH_MODEL' },
    policy: {
      decisions: 'fail',
      coverage: 'fail',
      attack: policyAttack,
      roles: { modelFamily: 'warn' },
    },
    models: { 'model-a': 'family-a', 'model-b': 'family-b' },
    roles: {
      critic: { model: 'model-b', mustDifferFromIssuer: 'issuer' },
      acceptor: { model: 'model-b' },
    },
    verifyTimeoutMs: 1800000,
  };
}

function baseContract({ assumed }) {
  const taskMd = fs.readFileSync(path.join(EXAMPLES, 'task.md'), 'utf8');
  const meta = JSON.parse(
    taskMd.match(/<!--\s*TASK-META\s*([\s\S]*?)-->/)[1].trim(),
  );
  meta.id = '0001';
  meta.issuedBy = ISSUER;
  meta.protectedPaths = ['checks/**'];
  meta.allowedPaths = ['src/**', 'docs/tasks/0001/**'];
  meta.redAllowDirty = ['docs/tasks/0001/**'];
  meta.decisions = assumed ? DECISIONS : [DECISIONS[0]];
  meta.title = 'Сложение возвращает сумму';
  return { taskMd: replaceMeta(taskMd, meta), meta };
}

function criteriaFromExample() {
  const file = path.join(EXAMPLES, 'criteria.json');
  const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
  parsed.criteria[0].covers = ['src/**'];
  return { raw: JSON.stringify(parsed, null, 2) + '\n', parsed };
}

function attackFile(findings) {
  return {
    version: 1,
    task: '0001',
    createdAt: '2026-10-26T11:00:00.000Z',
    critic: CRITIC,
    findings,
  };
}

function resolvedFindings() {
  return [
    {
      id: 'A1',
      class: 'missing-case',
      severity: 'blocking',
      claim: 'в задании нет нулевых и отрицательных аргументов',
      case: 'add(0, 0) и add(-1, 2)',
      resolution: 'добавлен критерий C3 на нулевой случай',
    },
    {
      id: 'A2',
      class: 'ambiguous-criterion',
      severity: 'non-blocking',
      claim: 'C2 не говорит, какой именно ввод недопустим',
      case: 'строка вместо числа',
      reason: 'не влияет на поведение C1',
    },
  ];
}

function unresolvedFindings() {
  return [
    {
      id: 'A1',
      class: 'missing-case',
      severity: 'blocking',
      claim: 'в задании нет нулевых и отрицательных аргументов',
      case: 'add(0, 0) и add(-1, 2)',
      resolution: null,
    },
  ];
}

function lockFor(repo, taskDir, meta, taskMd, criteriaRaw, attackPath) {
  const block = extractCriteriaBlock(taskMd);
  const taskRel = 'docs/tasks/0001';
  const protectedFiles = ['checks/add.mjs', 'checks/negative.mjs']
    .filter((file) => fs.existsSync(path.join(repo, file)))
    .map((file) => ({ path: file, sha256: sha256File(path.join(repo, file)) }));
  return {
    version: 3,
    task: '0001',
    taskFileSha256: sha256(canonicalize(taskMd)),
    criteriaSha256: sha256(canonicalize(block)),
    criteriaJsonSha256: sha256(canonicalize(criteriaRaw)),
    attackSha256: fs.existsSync(attackPath) ? sha256File(attackPath) : null,
    contractCommit: git(repo, ['rev-parse', 'HEAD']),
    protected: protectedFiles,
    createdAt: '2026-10-26T10:00:00.000Z',
    tool: 'subagent-workflow/2.2.1',
    taskRel,
  };
}

function redRecord() {
  return {
    version: 4,
    kind: 'red',
    task: '0001',
    createdAt: '2026-10-26T10:10:00.000Z',
    base: 'HEAD',
    baseSha: 'base-sha',
    headSha: 'head-sha',
    contractCommit: 'contract-sha',
    criteriaSha256: 'criteria-sha',
    criteriaJsonSha256: 'criteria-json-sha',
    dirtyPaths: [],
    results: [],
    executed: 2,
    failed: 1,
    failedIds: ['C1'],
    allGreen: false,
    redProven: true,
    redExpectation: {
      configured: true,
      ok: true,
      errors: [],
      mustFail: ['C1'],
      mustPass: ['C2'],
    },
    bypasses: { allowDirty: false, allowBaseMismatch: false },
    log: 'red.log',
  };
}

function verifyRecord({ uncovered = [] } = {}) {
  return {
    version: 4,
    kind: 'verify',
    task: '0001',
    createdAt: '2026-10-26T10:20:00.000Z',
    headSha: 'head-sha',
    contractCommit: 'contract-sha',
    criteriaSha256: 'criteria-sha',
    criteriaJsonSha256: 'criteria-json-sha',
    taskFileSha256: 'task-sha',
    changedPaths: ['src/app.js'],
    coverage: {
      declared: 1,
      covered: [{ path: 'src/app.js', criterion: 'C1' }],
      uncovered,
      mode: 'fail',
      warnings: [],
    },
    results: [],
    executed: 2,
    failed: 0,
    manualSkipped: 0,
    allPassed: true,
    violations: [],
    bypasses: { allowMissingRed: false, allowManual: false },
    red: {
      baseSha: 'base-sha',
      contractCommit: 'contract-sha',
      criteriaJsonSha256: 'criteria-json-sha',
      failed: 1,
      failedIds: ['C1'],
      redExpectation: { configured: true, ok: true, errors: [], mustFail: ['C1'], mustPass: ['C2'] },
      bypasses: {},
      log: 'red.log',
    },
    worktreeDigest: 'digest',
    log: 'verify.log',
  };
}

function acceptanceRecord({ repo, lock, criteria, meta, attack, decisions, releaseReady, legacy }) {
  const summary = summarizeDecisions(decisions, criteria.parsed.criteria);
  const attackCheck = validateAttack(attack, { task: '0001', risk: 'medium' });
  if (legacy) {
    return {
      version: 3,
      status: 'accepted',
      task: '0001',
      title: meta.title,
      risk: 'medium',
      taskFileSha256: lock.taskFileSha256,
      criteriaSha256: lock.criteriaSha256,
      criteriaJsonSha256: lock.criteriaJsonSha256,
      contractCommit: lock.contractCommit,
      baseCommit: lock.contractCommit,
      candidateCommit: 'candidate-sha',
      tree: 'tree-sha',
      worktreeDigest: 'digest',
      acceptor: 'judge',
      acceptedAt: '2026-10-26T10:30:00.000Z',
      humanSignoff: false,
      signedBy: null,
      securityReview: false,
      checks: [
        { id: 'C1', command: 'node checks/add.mjs', exitCode: 0, durationMs: 10, passed: true },
        { id: 'C2', command: 'node checks/negative.mjs', exitCode: 1, durationMs: 10, passed: true },
      ],
      verifyLog: 'verify.log',
      verifyLogSha256: 'verify-log-sha',
      notes: '',
      signatureAlgorithm: 'hmac-sha256',
      signature: 'legacy-signature',
    };
  }
  return {
    version: 6,
    status: 'accepted',
    task: '0001',
    title: meta.title,
    risk: 'medium',
    taskFileSha256: lock.taskFileSha256,
    criteriaSha256: lock.criteriaSha256,
    criteriaJsonSha256: lock.criteriaJsonSha256,
    contractCommit: lock.contractCommit,
    baseCommit: lock.contractCommit,
    candidateCommit: 'candidate-sha',
    tree: 'tree-sha',
    worktreeDigest: 'digest',
    issuedBy: ISSUER,
    keyId: 'agent-judge',
    signatureAlgorithm: 'ed25519',
    signature: 'ZmFrZQ==',
    actor: { kind: 'agent', session: JUDGE.session, model: JUDGE.model, family: 'family-b', host: 'test-host', keyId: 'agent-judge', attestedBy: 'env' },
    independence: {
      level: 'separate-session',
      separateSession: true,
      reportWithheld: true,
      keyCustody: 'agent-key',
      modelLevel: 'different-family',
    },
    acceptorRun: {
      fresh: true,
      nonce: 'nonce',
      runKind: 'accept',
      startedAt: '2026-10-26T10:20:00.000Z',
      finishedAt: '2026-10-26T10:30:00.000Z',
      durationMs: 600000,
    },
    bypasses: { allowDirty: false, allowBaseMismatch: false, allowMissingRed: false, allowManual: false },
    red: {
      baseSha: 'base-sha',
      contractCommit: 'contract-sha',
      criteriaJsonSha256: 'criteria-json-sha',
      failed: 1,
      failedIds: ['C1'],
      redExpectation: { configured: true, ok: true, errors: [], mustFail: ['C1'], mustPass: ['C2'] },
      log: 'red.log',
    },
    checks: [
      { id: 'C1', command: 'node checks/add.mjs', exitCode: 0, durationMs: 10, passed: true },
      { id: 'C2', command: 'node checks/negative.mjs', exitCode: 1, durationMs: 10, passed: true },
    ],
    acceptor: 'judge',
    acceptedAt: '2026-10-26T10:30:00.000Z',
    humanSignoff: false,
    signedBy: null,
    securityReview: false,
    review: null,
    decisions: {
      count: summary.count,
      digest: summary.digest,
      assumed: summary.assumed,
      confirmed: summary.confirmed,
    },
    attack: {
      present: true,
      sha256: sha256File(path.join(repo, 'docs/tasks/0001/attack.json')),
      session: CRITIC.session,
      model: CRITIC.model,
      family: 'family-b',
      level: 'different-family',
      findings: attackCheck.summary,
      attestation: 'declared',
    },
    releaseReady,
    notes: releaseReady ? '' : 'решение D2 без доказательства',
  };
}

/**
 * Create a repository for one scenario.
 *
 * @param {object} [options]
 * @param {string} [options.stage] contract|attack|unresolved|lock|red|green|coverage|accepted|remarks|legacy|mismatch
 * @returns {{repo:string, taskDir:string, meta:object, criteria:object, config:object, cleanup:Function}}
 */
export function makeRepo(options = {}) {
  const stage = options.stage || 'remarks';
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-console-' + stage + '-'));
  const taskDir = path.join(repo, 'docs', 'tasks', '0001');
  fs.mkdirSync(taskDir, { recursive: true });
  fs.mkdirSync(path.join(repo, 'docs', 'subagent-workflow'), { recursive: true });
  copyFile(path.join(EXAMPLES, 'checks', 'add.mjs'), path.join(repo, 'checks', 'add.mjs'));
  copyFile(path.join(EXAMPLES, 'checks', 'negative.mjs'), path.join(repo, 'checks', 'negative.mjs'));
  copyFile(path.join(EXAMPLES, 'src', 'app.js'), path.join(repo, 'src', 'app.js'));

  const assumed = stage === 'remarks';
  const contract = baseContract({ assumed });
  const criteria = criteriaFromExample();
  write(path.join(taskDir, 'task.md'), contract.taskMd);
  write(path.join(taskDir, 'criteria.json'), criteria.raw);

  const policyAttack = stage === 'contract' ? 'off' : 'fail';
  const config = configFor(policyAttack);
  writeJson(path.join(repo, 'docs', 'subagent-workflow', 'workflow.config.json'), config);
  write(path.join(repo, 'docs', 'subagent-workflow', 'VERSION'), '2.2.1\n');
  write(
    path.join(repo, 'docs', 'subagent-workflow', 'SPEC.md'),
    '# Спецификация: делегирование субагентам с проверяемой приёмкой\n\nВерсия: 2.2.0. Дата: 2026-10-26.\n',
  );
  write(path.join(repo, 'docs', 'subagent-workflow', 'scripts', 'task-attack.mjs'), '// fixture attack gate\n');
  write(path.join(repo, 'docs', 'subagent-workflow', 'scripts', 'lib', 'policy.mjs'), '// fixture policy\n');
  write(path.join(repo, 'docs', 'subagent-workflow', 'scripts', 'task-check-acceptance.mjs'), '// fixture checker\n');
  write(path.join(repo, 'docs', 'subagent-workflow', 'templates', 'task.md'), '# fixture\n');
  write(
    path.join(repo, 'docs', 'tasks', '0001-old.md'),
    '# Задание 0001. Старый плоский формат\n\nБез TASK-META, v1.1.\n',
  );

  git(repo, ['init', '-q']);
  git(repo, ['config', 'user.email', 'test@local']);
  git(repo, ['config', 'user.name', 'test']);
  git(repo, ['add', '.']);
  git(repo, ['commit', '-q', '-m', 'task 0001: contract']);

  const taskPath = path.join(taskDir, 'task.md');
  const attackPath = path.join(taskDir, 'attack.json');
  let attack = null;
  let lock = null;
  let red = null;
  let verify = null;
  let acceptance = null;

  const needsAttack = !['contract', 'attack'].includes(stage);
  if (needsAttack) {
    attack = stage === 'unresolved' ? attackFile(unresolvedFindings()) : attackFile(resolvedFindings());
    writeJson(attackPath, attack);
  }
  const needsLock = ['lock', 'red', 'green', 'coverage', 'accepted', 'remarks', 'legacy', 'mismatch'].includes(stage);
  if (needsLock) {
    lock = lockFor(repo, taskDir, contract.meta, contract.taskMd, criteria.raw, attackPath);
    writeJson(path.join(taskDir, 'criteria.lock'), lock);
  }
  if (['red', 'green', 'coverage', 'accepted', 'remarks', 'legacy', 'mismatch'].includes(stage)) {
    red = redRecord();
    writeJson(path.join(taskDir, 'red.json'), red);
  }
  if (['green', 'coverage', 'accepted', 'remarks', 'legacy', 'mismatch'].includes(stage)) {
    verify = verifyRecord({ uncovered: stage === 'coverage' ? ['src/other.js'] : [] });
    writeJson(path.join(taskDir, 'verify.json'), verify);
  }
  if (['accepted', 'remarks', 'legacy', 'mismatch'].includes(stage)) {
    const legacy = stage === 'legacy';
    const releaseReady = stage === 'accepted' || stage === 'mismatch' || stage === 'legacy';
    const decisions = legacy ? [] : (stage === 'remarks' ? DECISIONS : [DECISIONS[0]]);
    acceptance = acceptanceRecord({
      repo,
      lock,
      criteria,
      meta: contract.meta,
      attack: attack || attackFile(resolvedFindings()),
      decisions,
      releaseReady,
      legacy,
    });
    writeJson(path.join(taskDir, 'acceptance.json'), acceptance);
  }
  if (stage === 'mismatch') {
    fs.appendFileSync(taskPath, '\n<!-- изменено после замка -->\n');
  }

  return {
    repo,
    taskDir,
    meta: contract.meta,
    criteria,
    config,
    /*
     * На Windows каталог в %TEMP% может быть занят антивирусом или ещё не закрытым
     * процессом: десять секунд ретраев и best-effort. Утечка временного каталога —
     * не повод валить тест; проверяемое поведение уже проверено выше.
     */
    cleanup: () => {
      try {
        fs.rmSync(repo, { recursive: true, force: true, maxRetries: 50, retryDelay: 200 });
      } catch {
        /* оставляем каталог до очистки ОС */
      }
    },
  };
}

/** Hash every worktree file outside .git, for the read-only audit. */
export function snapshotFiles(repo) {
  const out = {};
  const walk = (dir, rel) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === '.git') continue;
      const childRel = rel ? rel + '/' + entry.name : entry.name;
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(abs, childRel);
      else if (entry.isFile()) out[childRel] = sha256File(abs);
    }
  };
  walk(repo, '');
  return out;
}
