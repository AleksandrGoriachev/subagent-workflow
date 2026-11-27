/* 0176: набор «подсказки, бейджи, диагностика». Общий harness — client.harness.mjs. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createWorkflowRuntime, createWebHandler } from '../lib/api.js';
import { makeRepo, git } from './fixture.mjs';
import {
  createElement, isValidElement, texts, textOf, elements, findButton, findBadge, delay,
  makeReact, loadBundle, mount, fakeWorkspace, apiFetch,
} from './client.harness.mjs';

test('badges explain themselves: hints on hover and focus (WC-1)', async () => {
  const fixture = makeRepo({ stage: 'remarks' });
  try {
    // Правка защищённого файла после замка даёт блокирующий флаг.
    fs.appendFileSync(path.join(fixture.repo, 'checks', 'add.mjs'), '\n// правка после замка\n');
    const handler = createWebHandler(createWorkflowRuntime({ roots: [fixture.repo] }));
    globalThis.fetch = apiFetch(handler);
    const hooks = makeReact();
    const plugin = await loadBundle(hooks.React);
    const slot = mount(plugin);
    let tree = hooks.render(slot.component);
    hooks.drain();
    await delay(120);
    tree = hooks.render(slot.component);

    const exact = (text) => elements(tree).find(
      (element) => element.type === 'span' && textOf(element).replace(/\s+/g, ' ').trim() === text,
    );

    const risk = exact('medium');
    assert.ok(risk, 'риск-бейдж на доске');
    assert.match(risk.props.title, /^Риск задания: средний/);
    assert.match(risk.props['aria-label'], /Риск задания/);
    assert.equal(risk.props.tabIndex, undefined, 'внутри кнопки-карточки бейдж не фокусируется');

    const errors = elements(tree).find(
      (element) => element.type === 'span' && /^ошибок \d+$/.test(textOf(element).trim()),
    );
    assert.ok(errors, 'бейдж «ошибок N»');
    assert.match(errors.props.title, /Блокирующие замечания/);

    const warnings = elements(tree).find(
      (element) => element.type === 'span' && /^предупр\. \d+$/.test(textOf(element).trim()),
    );
    assert.ok(warnings, 'бейдж «предупр. N»');
    assert.match(warnings.props.title, /Некритичные предупреждения/);

    const cardButton = findButton(tree, '0001');
    cardButton.props.onClick();
    await delay(120);
    tree = hooks.render(slot.component);

    const stage = elements(tree).find(
      (element) => element.type === 'span' && textOf(element).trim() === 'Замечания' && element.props.title,
    );
    assert.ok(stage, 'бейдж стадии в карточке');
    assert.match(stage.props.title, /^Замечания — /);
    assert.equal(stage.props.tabIndex, 0, 'бейдж стадии доступен с клавиатуры');

    const flagCode = elements(tree).find(
      (element) => element.type === 'span' && textOf(element).trim() === 'lock-mismatch-protected',
    );
    assert.ok(flagCode, 'код флага в карточке');
    assert.match(flagCode.props.title, /защищённые файлы/i);
  } finally {
    fixture.cleanup();
  }
});

/*
 * 0.4.1: бейджи внутри кнопки-карточки не фокусируются, поэтому подсказки
 * эффекта и регресса обязаны попадать в aria-label самой кнопки. И в карточке
 * появляется раздел «Регресс» с просроченным reviewBy.
 */
test('card aria-label carries effect and regress hints, card shows «Регресс» (0.4.1)', async () => {
  const fixture = makeRepo({ stage: 'remarks' });
  try {
    fs.writeFileSync(path.join(fixture.repo, 'regress.baseline.json'), JSON.stringify({
      version: 1,
      generatedAt: '2026-10-01T00:00:00.000Z',
      entries: [{
        task: '0001',
        status: 'unproven-lawful',
        reason: 'low: красный прогон не требуется',
        since: '2026-10-01',
        reviewBy: '2000-01-01',
      }],
    }, null, 2) + '\n');

    const handler = createWebHandler(createWorkflowRuntime({ roots: [fixture.repo] }));
    globalThis.fetch = apiFetch(handler);
    const hooks = makeReact();
    const plugin = await loadBundle(hooks.React);
    const slot = mount(plugin);
    let tree = hooks.render(slot.component);
    hooks.drain();
    await delay(120);
    tree = hooks.render(slot.component);

    const cardButton = findButton(tree, '0001');
    const aria = cardButton.props['aria-label'];
    assert.match(aria, /Эффект решения/u, 'подсказка эффекта в aria-label кнопки');
    assert.match(aria, /Регресс-долг/u, 'подсказка регресса в aria-label кнопки');
    assert.match(aria, /unproven-lawful/u);
    assert.match(aria, /срок истёк/u);

    const effectBadge = findBadge(tree, 'эффект');
    assert.ok(effectBadge, 'бейдж «эффект» на доске');
    assert.match(effectBadge.props.title, /требует эффекта/u);
    assert.equal(effectBadge.props.tabIndex, undefined, 'внутри кнопки бейдж не фокусируется');

    const regressBadge = findBadge(tree, 'регресс: unproven-lawful');
    assert.ok(regressBadge, 'бейдж регресса на доске');
    assert.equal(regressBadge.props.tabIndex, undefined, 'внутри кнопки бейдж не фокусируется');

    cardButton.props.onClick();
    await delay(120);
    const rendered = textOf(hooks.render(slot.component));
    assert.match(rendered, /Регресс/u, 'раздел «Регресс» в карточке');
    assert.match(rendered, /reviewBy/u);
    assert.match(rendered, /unproven-lawful/u);
    assert.match(rendered, /2000-01-01 — срок истёк/u);
    assert.match(rendered, /low: красный прогон не требуется/u);
  } finally {
    fixture.cleanup();
  }
});

/*
 * 0.4.1: цвет бейджа «эффект» — строгость флага effect-problem из политики.
 * Статус missing одинаков во всех трёх случаях, значит различие даёт policy.
 */
test('badge «эффект» colored by policy severity, not by status (0.4.1)', async () => {
  const cases = [
    { policy: 'fail', token: '#ec1313', hint: /требует эффекта/u },
    { policy: 'warn', token: '#f59e0b', hint: /требует эффекта/u },
    { policy: 'off', token: 'rgba(127,127,127,0.78)', hint: /decisions=off/u },
  ];
  for (const item of cases) {
    const fixture = makeRepo({ stage: 'remarks' });
    try {
      const configPath = path.join(fixture.repo, 'docs', 'subagent-workflow', 'workflow.config.json');
      const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      config.policy.decisions = item.policy;
      fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n');

      const handler = createWebHandler(createWorkflowRuntime({ roots: [fixture.repo] }));
      globalThis.fetch = apiFetch(handler);
      const hooks = makeReact();
      const plugin = await loadBundle(hooks.React);
      const slot = mount(plugin);
      let tree = hooks.render(slot.component);
      hooks.drain();
      await delay(120);
      tree = hooks.render(slot.component);

      const effectBadge = findBadge(tree, 'эффект');
      assert.ok(effectBadge, 'бейдж «эффект» при decisions=' + item.policy);
      assert.ok(
        String(effectBadge.props.style.color).includes(item.token),
        'decisions=' + item.policy + ': цвет бейджа из строгости (' + effectBadge.props.style.color + ')',
      );
      assert.match(effectBadge.props.title, item.hint);
    } finally {
      fixture.cleanup();
    }
  }
});

/*
 * 0.4.1: checked=false — это «не проверялось», а не «ok». «ok» показываем
 * только когда ворота действительно провели проверку.
 */
test('card says «не проверялось» when gates did not check the effect (0.4.1)', async () => {
  const fixture = makeRepo({ stage: 'remarks' });
  try {
    const verifyPath = path.join(fixture.taskDir, 'verify.json');
    const verify = JSON.parse(fs.readFileSync(verifyPath, 'utf8'));
    verify.effects = { required: true, checked: false, ok: true };
    fs.writeFileSync(verifyPath, JSON.stringify(verify, null, 2) + '\n');
    const recordPath = path.join(fixture.taskDir, 'acceptance.json');
    const record = JSON.parse(fs.readFileSync(recordPath, 'utf8'));
    record.effectConsistency = { checked: false, ok: true };
    fs.writeFileSync(recordPath, JSON.stringify(record, null, 2) + '\n');

    const handler = createWebHandler(createWorkflowRuntime({ roots: [fixture.repo] }));
    globalThis.fetch = apiFetch(handler);
    const hooks = makeReact();
    const plugin = await loadBundle(hooks.React);
    const slot = mount(plugin);
    let tree = hooks.render(slot.component);
    hooks.drain();
    await delay(120);
    tree = hooks.render(slot.component);
    findButton(tree, '0001').props.onClick();
    await delay(120);
    const rendered = textOf(hooks.render(slot.component));

    assert.match(rendered, /не проверялось/u);
    assert.ok(!/verify\.json\s+ok/u.test(rendered), 'verify.json не должен выглядеть проверенным');
    assert.ok(!/запись приёмки\s+ok/u.test(rendered), 'запись приёмки не должна выглядеть проверенной');
  } finally {
    fixture.cleanup();
  }
});

test('diagnostics buttons run a read-only check and show the log (v2, step 1)', async () => {
  const fixture = makeRepo({ stage: 'remarks' });
  try {
    const scripts = path.join(fixture.repo, 'docs', 'subagent-workflow', 'scripts');
    fs.mkdirSync(scripts, { recursive: true });
    fs.writeFileSync(path.join(scripts, 'task-lint.mjs'), "console.log('fake lint: 0001 — ок');\n", 'utf8');

    const handler = createWebHandler(createWorkflowRuntime({ roots: [fixture.repo] }));
    globalThis.fetch = apiFetch(handler);
    const hooks = makeReact();
    const plugin = await loadBundle(hooks.React);
    const slot = mount(plugin);

    let tree = hooks.render(slot.component);
    hooks.drain();
    await delay(120);
    tree = hooks.render(slot.component);

    const doctor = findButton(tree, 'Проверить настройку');
    assert.ok(doctor, 'кнопка «Проверить настройку» в шапке');
    assert.match(doctor.props.title, /всё ли готово/u);
    assert.match(doctor.props.title, /Ничего не меняет/u);

    findButton(tree, '0001').props.onClick();
    await delay(120);
    tree = hooks.render(slot.component);
    const lint = findButton(tree, 'Проверить задание');
    const accept = findButton(tree, 'Проверить запись');
    assert.ok(lint, 'кнопка «Проверить задание» в карточке');
    assert.ok(accept, 'кнопка «Проверить запись» в карточке');
    assert.match(lint.props.title, /Только чтение/u);

    lint.props.onClick();
    /*
     * Проверка запускается отдельным процессом: на загруженной машине она может
     * занять больше секунды. Ждём появления вывода, а не фиксированные 600 мс.
     */
    let rendered = '';
    for (let attempt = 0; attempt < 25; attempt += 1) {
      await delay(200);
      hooks.drain();
      rendered = textOf(hooks.render(slot.component));
      if (/fake lint: 0001 — ок/u.test(rendered)) break;
    }
    tree = hooks.render(slot.component);
    assert.match(rendered, /fake lint: 0001 — ок/u);
    assert.match(rendered, /Только чтение: проверка не пишет в репозиторий/u);
    assert.match(rendered, /task-lint\.mjs --task docs\/tasks\/0001/u);
  } finally {
    fixture.cleanup();
  }
});

test('panel does not substitute a foreign project: empty state first, configured roots on request', async () => {
  const fixture = makeRepo({ stage: 'remarks' });
  try {
    const handler = createWebHandler(createWorkflowRuntime({ roots: [fixture.repo] }));
    globalThis.fetch = apiFetch(handler);
    const hooks = makeReact();
    const plugin = await loadBundle(hooks.React);
    const slot = mount(plugin, fakeWorkspace('C:\\other-workspace', 'other-workspace'));
    let tree = hooks.render(slot.component);
    hooks.drain();
    await delay(80);
    tree = hooks.render(slot.component);
    let text = textOf(tree);
    assert.match(text, /Текущий workspace: other-workspace/);
    assert.match(text, /workflow не развёрнут/);
    assert.ok(!text.includes('Сложение возвращает сумму'), 'чужой проект не показывается сам');
    const reveal = findButton(tree, 'Показать репозитории из настроек');
    assert.ok(reveal, 'кнопка явного выбора настроенных репозиториев');
    reveal.props.onClick();
    await delay(20);
    tree = hooks.render(slot.component);
    const pick = findButton(tree, path.basename(fixture.repo));
    assert.ok(pick, 'настроенный корень появляется только по запросу');
    pick.props.onClick();
    await delay(80);
    tree = hooks.render(slot.component);
    text = textOf(tree);
    assert.match(text, /Сложение возвращает сумму/);
  } finally {
    fixture.cleanup();
  }
});

/*
 * 0.7.0: в пространстве без движка пустое состояние не отправляет в терминал, а
 * предлагает кнопку. Подтверждение перечисляет, что появится в проекте; отказ от
 * подтверждения не пишет ничего; после согласия движок разворачивается и панель
 * перечитывает состояние.
 */
