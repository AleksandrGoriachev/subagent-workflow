#!/usr/bin/env node
/**
 * T2 (стоп-линия): граф не теряет поля, состояние отделено, активация в своём воркспейсе.
 *
 * Чеки статические, но по исполняемым признакам:
 *  1) buildStructure больше не собирает whitelist-объект (сохраняет неизвестные поля или отказывает);
 *  2) состояние панели (позиции/папки/привязки) лежит в отдельном файле, а не в graph.json;
 *  3) spawn отклоняет сессию в чужом/временном воркспейсе.
 */
import path from 'node:path';
import { read, exists, report } from './common.mjs';

export function checkT2(root) {
  const api = read(root, 'lib/api.js') || '';
  const spawn = read(root, 'lib/spawn.js') || '';
  const checks = [];
  const buildIdx = api.indexOf('function buildStructure');
  const buildBody = buildIdx >= 0 ? api.slice(buildIdx, buildIdx + 4000) : '';
  checks.push({
    name: 'buildStructure не теряет неизвестные поля',
    ok: buildIdx >= 0 && (/\.\.\.node\b/u.test(buildBody) || /unknown|неизвестн|lossless|сохран/u.test(buildBody)),
    detail: buildIdx < 0 ? 'нет buildStructure' : 'сборка по-прежнему whitelist: prompt/anchors/координаты теряются',
  });
  checks.push({
    name: 'состояние панели отделено от конфига',
    ok: /runtime\.json|state\.json|layout\.json/iu.test(api) || exists(root, 'structure/runtime.json'),
    detail: 'позиции/папки/привязки пишутся в structure/graph.json',
  });
  checks.push({
    name: 'активация отклоняет чужой воркспейс',
    ok: /воркспейс|workspace/iu.test(spawn) && /(dsh-spawn|temp|tmp)/iu.test(spawn) && /(отклон|refus|reject|error)/iu.test(spawn),
    detail: 'spawn не проверяет, что сессия создана в воркспейсе узла (ошибка координатора 11.11)',
  });
  return checks;
}

if (process.argv[1] && process.argv[1].endsWith('t2-graph-noloss.mjs')) {
  const root = process.argv[2] || path.resolve('.');
  process.exit(report('T2', checkT2(root)));
}