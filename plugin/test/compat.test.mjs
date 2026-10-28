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
  assert.equal(view.supported, '2.0.0 – 2.5.x');
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

test('2.4.5 — рабочее состояние: ни баннера, ни «мы это не показываем»', () => {
  const view = compatView({
    packageVersion: '2.4.5',
    versionSource: 'VERSION',
    workflow: workflow(),
    config: config(),
    tasks,
  });
  /*
   * 0.4.0: effect и регресс панель читает, поэтому пробел 2.3–2.4 больше не
   * называется — проверка снята вместе с пробелом, а не «спрятана».
   */
  assert.equal(view.summary.limited, false, 'баннер «функционал ограничен» на 2.4.5 не показывается');
  assert.equal(view.summary.warnings, 0);
  assert.equal(view.summary.headline, 'Совместимо с workflow 2.4.5');
  assert.equal(view.checks.some((item) => item.id === 'workflow-newer'), false);
  assert.equal(view.checks.some((item) => item.id === 'workflow-2.3-plus'), false);
});

test('2.5.0 — рабочее состояние: guard входит в диапазон, баннера нет', () => {
  const view = compatView({
    packageVersion: '2.5.0',
    versionSource: 'VERSION',
    workflow: workflow(),
    config: config(),
    tasks,
  });
  assert.equal(view.summary.limited, false);
  assert.equal(view.summary.warnings, 0);
  assert.equal(view.summary.headline, 'Совместимо с workflow 2.5.0');
  assert.equal(view.checks.some((item) => item.id === 'workflow-newer'), false);
});

test('устаревший плагин: совет обновиться есть, баннера «ограничен» нет', () => {
  const view = compatView({
    packageVersion: '2.6.0',
    versionSource: 'VERSION',
    workflow: workflow(),
    config: config(),
    tasks,
  });
  assert.equal(view.summary.limited, false);
  const check = view.checks.find((item) => item.id === 'workflow-newer');
  assert.ok(check);
  assert.equal(check.severity, 'warn');
  assert.match(check.recommendation, /Обновите плагин/);
});

test('устаревшая развёрнутая копия — по-прежнему ограничение с советом обновиться', () => {
  const view = compatView({
    packageVersion: '2.1.0',
    versionSource: 'VERSION',
    workflow: workflow(),
    config: config(),
    tasks,
  });
  assert.equal(view.summary.limited, true, '2.1.x — настоящая нехватка функций, баннер уместен');
  const check = view.checks.find((item) => item.id === 'workflow-2.1');
  assert.ok(check);
  assert.match(check.recommendation, /Обновите/);
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

test('PLUGIN_VERSION совпадает с package.json', async () => {
  const fs = await import('node:fs');
  const manifest = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  const { PLUGIN_VERSION } = await import('../lib/compat.js');
  assert.equal(PLUGIN_VERSION, manifest.version, 'версия для панели не должна отставать от package.json');
});

test('TOOL собирается из PLUGIN_VERSION и не отстаёт', async () => {
  const fs = await import('node:fs');
  const manifest = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  const { TOOL } = await import('../lib/state.js');
  const { PLUGIN_VERSION } = await import('../lib/compat.js');
  assert.equal(TOOL, 'dsh-workflow-console/' + PLUGIN_VERSION);
  assert.equal(TOOL, 'dsh-workflow-console/' + manifest.version, 'TOOL попадает в /api/status: он не должен называть старую версию');
});
