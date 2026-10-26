import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { makeRepo, snapshotFiles, git, DECISIONS } from './fixture.mjs';
import {
  buildTaskState,
  canonicalize,
  sha256Text,
  summarizeDecisions,
  readRepository,
  readTask,
  loadConfig,
  policyOf,
  policyView,
  familyOf,
} from '../lib/state.js';
import {
  canonicalize as specCanonicalize,
  sha256 as specSha256,
  summarizeDecisions as specSummarizeDecisions,
  loadConfig as specLoadConfig,
} from '../../spec/scripts/lib/common.mjs';
import { policyOf as specPolicyOf, familyOf as specFamilyOf } from '../../spec/scripts/lib/policy.mjs';

function readTaskFrom(repo, id = '0001') {
  const board = readRepository(repo);
  const task = board.tasks.find((item) => item.id === id);
  assert.ok(task, 'task ' + id + ' is on the board');
  return { board, task };
}

test('canonicalize and sha256 match the gates', () => {
  const sample = 'a  \r\nb\t\r\n\r\nc\n\n';
  assert.equal(canonicalize(sample), specCanonicalize(sample));
  assert.equal(sha256Text(canonicalize(sample)), specSha256(specCanonicalize(sample)));
});

test('decisions summary matches the gates', () => {
  const criteria = [{ id: 'C1' }, { id: 'C2', manual: true }, { id: 'C3' }];
  const decisions = [
    { id: 'D1', class: 'semantic', impact: 'user-visible', evidence: { kind: 'criterion', ref: 'C1' } },
    { id: 'D2', class: 'semantic', impact: 'internal' },
    { id: 'D3', class: 'contract', impact: 'public-contract', evidence: { kind: 'spec', ref: 'SPEC §5' } },
    { id: 'D4', class: 'mechanical', impact: 'internal' },
    { id: 'D5', class: 'semantic', impact: 'user-visible', confirmation: { kind: 'customer', who: 'заказчик' } },
    { id: 'D6', class: 'semantic', impact: 'user-visible', evidence: { kind: 'criterion', ref: 'C2' } },
  ];
  assert.deepEqual(summarizeDecisions(decisions, criteria), specSummarizeDecisions(decisions, criteria));
});

test('stage matrix matches the artifact set', async (t) => {
  const cases = [
    { stage: 'contract', expected: 'contract', flags: [] },
    { stage: 'attack', expected: 'attack', flags: ['attack-missing'] },
    { stage: 'unresolved', expected: 'attack', flags: ['attack-unresolved'] },
    { stage: 'lock', expected: 'lock', flags: [] },
    { stage: 'red', expected: 'red', flags: [] },
    { stage: 'green', expected: 'green', flags: [] },
    { stage: 'coverage', expected: 'green', flags: ['coverage-uncovered'] },
    { stage: 'accepted', expected: 'accepted', flags: [] },
    { stage: 'remarks', expected: 'remarks', flags: ['decisions-assumed', 'release-not-ready'] },
    { stage: 'legacy', expected: 'accepted', flags: ['record-legacy'] },
    { stage: 'mismatch', expected: 'accepted', flags: ['lock-mismatch'] },
  ];
  for (const item of cases) {
    await t.test(item.stage, () => {
      const fixture = makeRepo({ stage: item.stage });
      try {
        const { task } = readTaskFrom(fixture.repo);
        assert.equal(task.stage, item.expected, item.stage + ' stage');
        const codes = task.flags.map((flag) => flag.code);
        for (const code of item.flags) assert.ok(codes.includes(code), item.stage + ' has ' + code + ' (got ' + codes.join(', ') + ')');
      } finally {
        fixture.cleanup();
      }
    });
  }
});

test('lock is in sync with a fresh contract', () => {
  const fixture = makeRepo({ stage: 'lock' });
  try {
    const card = readTask(fixture.repo, '0001');
    assert.equal(card.lock.inSync, true);
    assert.deepEqual(card.lock.mismatches, []);
    assert.deepEqual(card.lock.protectedDiff, { changed: [], missing: [], added: [] });
    assert.equal(card.lock.version, 3);
  } finally {
    fixture.cleanup();
  }
});

test('a changed protected file breaks the lock', () => {
  const fixture = makeRepo({ stage: 'lock' });
  try {
    fs.appendFileSync(path.join(fixture.repo, 'checks', 'add.mjs'), '\n// changed\n');
    const card = readTask(fixture.repo, '0001');
    assert.equal(card.lock.inSync, false);
    assert.ok(card.flags.some((flag) => flag.code === 'lock-mismatch-protected'));
  } finally {
    fixture.cleanup();
  }
});

test('task card carries assumed decisions, attack and record v6', () => {
  const fixture = makeRepo({ stage: 'remarks' });
  try {
    const card = readTask(fixture.repo, '0001');
    assert.equal(card.title, 'Сложение возвращает сумму');
    assert.equal(card.risk, 'medium');
    assert.equal(card.decisions.count, 2);
    assert.deepEqual(card.decisions.assumed, ['D2']);
    assert.equal(card.decisions.items.find((item) => item.id === 'D2').assumed, true);
    assert.equal(card.criteria.length, 2);
    assert.deepEqual(card.criteria[0].covers, ['src/**']);
    assert.equal(card.attack.summary.total, 2);
    assert.equal(card.attack.summary.blocking, 1);
    assert.equal(card.attack.summary.unresolved, 0);
    assert.equal(card.attack.critic.model, 'model-b');
    assert.equal(card.attack.level, 'different-family');
    assert.equal(card.record.version, 6);
    assert.equal(card.record.releaseReady, false);
    assert.deepEqual(card.record.decisions.assumed, ['D2']);
    assert.equal(card.record.attack.findings.unresolved, 0);
    assert.equal(card.record.independence.level, 'separate-session');
    assert.equal(card.record.actor.family, 'family-b');
    assert.equal(card.coverage.declared, 1);
    assert.deepEqual(card.coverage.uncovered, []);
    assert.ok(card.git.log.length >= 1, 'git log for the task directory');
    assert.equal(card.git.head, readRepository(fixture.repo).head);
  } finally {
    fixture.cleanup();
  }
});

test('a hidden assumed decision is caught against the contract', () => {
  const fixture = makeRepo({ stage: 'remarks' });
  try {
    const file = path.join(fixture.repo, 'docs/tasks/0001/acceptance.json');
    const record = JSON.parse(fs.readFileSync(file, 'utf8'));
    record.decisions.assumed = [];
    fs.writeFileSync(file, JSON.stringify(record, null, 2) + '\n');
    const { task } = readTaskFrom(fixture.repo);
    assert.ok(task.flags.some((flag) => flag.code === 'decisions-mismatch'));
    assert.equal(task.stage, 'remarks');
  } finally {
    fixture.cleanup();
  }
});

test('repository view reads config, version, protected hashes and skipped files', () => {
  const fixture = makeRepo({ stage: 'remarks' });
  try {
    const board = readRepository(fixture.repo);
    assert.equal(board.configLoaded, true);
    assert.equal(board.config.policy.attack, 'fail');
    assert.equal(board.packageVersion, '2.2.1');
    assert.equal(board.specVersion, '2.2.0');
    assert.equal(board.tasks.length, 1);
    assert.equal(board.counts.remarks, 1);
    assert.equal(board.tasks[0].redProven, true);
    assert.equal(board.tasks[0].verifyPassed, true);
    assert.equal(board.tasks[0].lockInSync, true);
    assert.equal(board.skipped.length, 1);
    assert.match(board.skipped[0].path, /0001-old\.md$/);
    assert.match(board.skipped[0].reason, /плоский/);
  } finally {
    fixture.cleanup();
  }
});

test('policy view matches doctor wording and values', () => {
  const fixture = makeRepo({ stage: 'remarks' });
  try {
    const ours = loadConfig(fixture.repo);
    const gates = specLoadConfig(fixture.repo);
    assert.deepEqual(policyOf(ours), specPolicyOf(gates));
    assert.equal(familyOf(ours, 'model-b'), specFamilyOf(gates, 'model-b'));
    const view = policyView(ours, { root: fixture.repo, configPath: ours.file });
    assert.equal(view.loaded, true);
    assert.equal(view.line, 'decisions=fail, coverage=fail, attack=fail, modelFamily=warn');
    assert.equal(view.roles.find((role) => role.name === 'critic').family, 'family-b');
    assert.deepEqual(view.warnings, []);
  } finally {
    fixture.cleanup();
  }
});

test('reading a repository does not change worktree files or git status', () => {
  const fixture = makeRepo({ stage: 'remarks' });
  try {
    const before = snapshotFiles(fixture.repo);
    const statusBefore = git(fixture.repo, ['status', '--porcelain']);
    readRepository(fixture.repo);
    readTask(fixture.repo, '0001');
    readRepository(fixture.repo);
    const after = snapshotFiles(fixture.repo);
    assert.deepEqual(after, before);
    assert.equal(git(fixture.repo, ['status', '--porcelain']), statusBefore);
  } finally {
    fixture.cleanup();
  }
});

test('a task without criteria is incomplete', () => {
  const state = buildTaskState({
    id: '0001',
    taskMd: '# Задание\n\n<!-- TASK-META\n{"id":"0001","risk":"medium"}\n-->\n',
    criteriaRaw: null,
    config: { policy: { attack: 'off', decisions: 'fail', coverage: 'fail', roles: { modelFamily: 'warn' } } },
  });
  assert.equal(state.stage, 'incomplete');
  assert.ok(state.flags.some((flag) => flag.code === 'criteria-missing'));
});

test('an unreadable acceptance record is visible, not silently ignored', () => {
  const fixture = makeRepo({ stage: 'accepted' });
  try {
    const file = path.join(fixture.repo, 'docs/tasks/0001/acceptance.json');
    fs.writeFileSync(file, 'not json at all');
    const card = readTask(fixture.repo, '0001');
    assert.equal(card.stage, 'remarks');
    assert.equal(card.artifacts.acceptance, true);
    assert.ok(card.flags.some((flag) => flag.code === 'artifact-unreadable'));
  } finally {
    fixture.cleanup();
  }
});

test('a UTF-16 acceptance record is read instead of being ignored', () => {
  const fixture = makeRepo({ stage: 'legacy' });
  try {
    const file = path.join(fixture.repo, 'docs/tasks/0001/acceptance.json');
    const text = fs.readFileSync(file, 'utf8');
    fs.writeFileSync(file, '\uFEFF' + text, 'utf16le');
    const card = readTask(fixture.repo, '0001');
    assert.equal(card.stage, 'accepted');
    assert.equal(card.record.version, 3);
    assert.ok(!card.flags.some((flag) => flag.code === 'artifact-unreadable'));
  } finally {
    fixture.cleanup();
  }
});

test('a v5 record with assumed decisions is accepted but not release-ready', () => {
  const fixture = makeRepo({ stage: 'remarks' });
  try {
    const file = path.join(fixture.repo, 'docs/tasks/0001/acceptance.json');
    const record = JSON.parse(fs.readFileSync(file, 'utf8'));
    record.version = 5;
    delete record.attack;
    fs.writeFileSync(file, JSON.stringify(record, null, 2) + '\n');
    const card = readTask(fixture.repo, '0001');
    assert.equal(card.stage, 'remarks');
    assert.equal(card.record.version, 5);
    assert.ok(!card.flags.some((flag) => flag.code === 'record-legacy'));
    assert.ok(card.flags.some((flag) => flag.code === 'release-not-ready'));
  } finally {
    fixture.cleanup();
  }
});
