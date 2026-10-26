import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compatView, compareVersions, parseVersion } from '../lib/compat.js';

function workflow(overrides = {}) {
  return {
    dir: true,
    spec: true,
    versionFile: true,
    attackGate: true,
    policyLib: true,
    checkAcceptance: true,
    templates: true,
    ...overrides,
  };
}

function config(loaded = true) {
  return { loaded, policy: { decisions: 'fail', coverage: 'fail', attack: 'fail', roles: { modelFamily: 'warn' } } };
}

const tasks = [
  { id: '0001', lockVersion: 3, recordVersion: 6 },
  { id: '0002', lockVersion: 3, recordVersion: 6 },
];

test('parse/compare versions', () => {
  assert.deepEqual(parseVersion('2.2.1'), { major: 2, minor: 2, patch: 1, raw: '2.2.1' });
  assert.equal(parseVersion('unknown'), null);
  assert.equal(compareVersions('2.1.0', '2.2.0'), -1);
  assert.equal(compareVersions('2.2.1', '2.2.0'), 1);
  assert.equal(compareVersions('2.2.0', '2.2.0'), 0);
  assert.equal(compareVersions('bad', '2.2.0'), null);
});

test('2.2.x is compatible', () => {
  const view = compatView({
    packageVersion: '2.2.1',
    specVersion: '2.2.0',
    versionSource: 'VERSION',
    workflow: workflow(),
    config: config(),
    tasks,
  });
  assert.equal(view.summary.errors, 0);
  assert.equal(view.summary.warnings, 0);
  assert.equal(view.summary.limited, false);
  assert.equal(view.supported, '2.0.0 – 2.2.x');
  assert.equal(view.workflowVersion, '2.2.1');
  assert.ok(view.checks.some((item) => item.id === 'package-spec' && item.severity === 'info'));
  assert.equal(view.summary.headline, 'Совместимо с workflow 2.2.1');
});

test('2.0.x reports limited functionality', () => {
  const view = compatView({
    packageVersion: '2.0.1',
    specVersion: '2.0.1',
    workflow: workflow({ attackGate: false, policyLib: false }),
    config: config(),
    tasks: [{ id: '0001', lockVersion: 2, recordVersion: 3 }],
  });
  assert.equal(view.summary.limited, true);
  const ids = view.checks.map((item) => item.id);
  for (const id of ['workflow-2.0', 'lock-old', 'record-old']) assert.ok(ids.includes(id), id);
  assert.match(view.summary.headline, /Функционал ограничен/);
  assert.match(view.checks.find((item) => item.id === 'workflow-2.0').recommendation, /2\.2\.x/);
});

test('2.1.x reports missing attack and policy', () => {
  const view = compatView({
    packageVersion: '2.1.0',
    versionSource: 'VERSION',
    workflow: workflow({ attackGate: false, policyLib: false }),
    config: config(),
    tasks,
  });
  assert.equal(view.summary.limited, true);
  assert.ok(view.checks.some((item) => item.id === 'workflow-2.1'));
});

test('missing workflow directory is an error', () => {
  const view = compatView({
    packageVersion: null,
    specVersion: null,
    workflow: { dir: false },
    config: null,
    tasks: [],
  });
  assert.equal(view.summary.limited, true);
  assert.ok(view.checks.some((item) => item.id === 'workflow-missing' && item.severity === 'error'));
});

test('missing config is an error but missing VERSION is a warning', () => {
  const view = compatView({
    packageVersion: '2.2.1',
    specVersion: '2.2.0',
    workflow: workflow({ versionFile: false }),
    config: config(false),
    tasks,
  });
  assert.ok(view.checks.some((item) => item.id === 'config-missing'));
  assert.ok(view.checks.some((item) => item.id === 'version-source'));
  assert.equal(view.summary.errors, 1);
});

test('a newer workflow is reported with an update-plugin recommendation', () => {
  const view = compatView({
    packageVersion: '2.3.0',
    versionSource: 'VERSION',
    workflow: workflow(),
    config: config(),
    tasks,
  });
  assert.equal(view.summary.limited, true);
  const check = view.checks.find((item) => item.id === 'workflow-newer');
  assert.ok(check);
  assert.match(check.recommendation, /плагин/);
});

test('a 2.2 deployment without the attack gate is limited', () => {
  const view = compatView({
    packageVersion: '2.2.1',
    versionSource: 'VERSION',
    workflow: workflow({ attackGate: false }),
    config: config(),
    tasks,
  });
  assert.equal(view.summary.limited, true);
  assert.ok(view.checks.some((item) => item.id === 'attack-gate-missing' && item.severity === 'error'));
});

test('unknown version is a warning, not a hard failure', () => {
  const view = compatView({
    packageVersion: null,
    specVersion: null,
    workflow: workflow(),
    config: config(),
    tasks,
  });
  assert.equal(view.summary.limited, false);
  assert.equal(view.summary.warnings, 1);
  assert.ok(view.checks.some((item) => item.id === 'version-unknown'));
});
