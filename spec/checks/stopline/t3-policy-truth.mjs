#!/usr/bin/env node
/**
 * T3 (v2): якоря — глобальные, у узла — гейты; consumes удаляется.
 *
 * Модель заказчика (11.11): якоря пишутся для всей структуры, а к конкретному
 * узлу применяются гейты. Значит:
 *  1) в манифесте якорей больше нет утверждения про consumes у узла;
 *  2) узел объявляет gates, а не anchors.consumes;
 *  3) проверяющая/релизная роль с пустыми gates — отказ;
 *  4) role-policy больше не раздаёт all-auto (костыль вокруг consumes не нужен);
 *  5) в реестре нет фантомных open.
 */
import path from 'node:path';
import { read, report } from './common.mjs';

function phantomCount(registryText) {
  let data; try { data = JSON.parse(registryText); } catch { return -1; }
  const tasks = Array.isArray(data && data.tasks) ? data.tasks : [];
  const norm = (s) => String(s || '').toLowerCase().replace(/\s+/gu, ' ').trim().slice(0, 60);
  const accepted = new Set(tasks.filter((t) => t.status === 'accepted').map((t) => norm(t.subject)));
  return tasks.filter((t) => t.status === 'open' && accepted.has(norm(t.subject))).length;
}

export function checkT3(root) {
  const anchorsText = read(root, 'docs/anchors.json') || '';
  const policy = read(root, 'lib/role-policy.js') || '';
  const validator = read(root, 'lib/structure-validator.js') || '';
  const anchorsCode = read(root, 'lib/anchors.js') || '';
  const registry = read(root, 'docs/tasks/REGISTRY.json') || '';
  const checks = [];

  checks.push({
    name: 'A8 больше не требует consumes у узла',
    ok: !/A8[\s\S]{0,500}?consumes/iu.test(anchorsText),
    detail: 'в манифесте якорей всё ещё утверждается правило про consumes',
  });
  checks.push({
    name: 'узел объявляет gates (а не consumes)',
    ok: /gates/iu.test(validator) || /gates/iu.test(anchorsCode),
    detail: 'ни валидатор, ни anchors.js не знают про gates — механизма гейтов нет',
  });
  checks.push({
    name: 'пустые gates у проверяющей/релизной роли — отказ',
    ok: /(gates[\s\S]{0,200}?(пуст|empty|length\s*===?\s*0))|((пуст|empty)[\s\S]{0,80}?gates)/iu.test(validator + anchorsCode),
    detail: 'нет проверки «у проверяющего/релизного узла список гейтов не пуст»',
  });
  checks.push({
    name: 'role-policy не раздаёт all-auto',
    ok: !/all-auto|defaultConsumes/iu.test(policy),
    detail: 'role-policy.js всё ещё подставляет consumes по умолчанию',
  });
  const phantoms = phantomCount(registry);
  checks.push({
    name: 'в реестре нет фантомных open-задач',
    ok: phantoms === 0,
    detail: phantoms < 0 ? 'реестр не читается' : 'фантомов: ' + phantoms + ' (open, чей предмет уже принят)',
  });
  return checks;
}

if (process.argv[1] && process.argv[1].endsWith('t3-policy-truth.mjs')) {
  const root = process.argv[2] || path.resolve('.');
  process.exit(report('T3', checkT3(root)));
}