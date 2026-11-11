#!/usr/bin/env node
/**
 * T3 (стоп-линия): одна правда политики якорей и честный реестр.
 *
 *  1) A8 в docs/anchors.json не утверждает того, чего нет в коде (отказ без consumes);
 *  2) role-policy — исполняемый источник, а не второй текст;
 *  3) в реестре нет фантомных open-задач (дубли принятого).
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
  const registry = read(root, 'docs/tasks/REGISTRY.json') || '';
  const checks = [];
  const a8Refuses = /A8[\s\S]{0,400}?без непустого consumes[\s\S]{0,80}?отказ/iu.test(anchorsText);
  const policyDefaults = /all-auto|defaultConsumes/u.test(policy);
  checks.push({
    name: 'A8 и role-policy не противоречат',
    ok: !(a8Refuses && policyDefaults),
    detail: 'A8 обещает отказ без consumes, а role-policy раздаёт все auto — два ответа на один вопрос',
  });
  checks.push({
    name: 'политика роли — исполняемый источник',
    ok: /export function rolePolicy/u.test(policy),
    detail: 'role-policy.js отсутствует или не экспортирует rolePolicy',
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