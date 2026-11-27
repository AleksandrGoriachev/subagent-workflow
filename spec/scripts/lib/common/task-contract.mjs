/*
 * Контракт задания: TASK-META, критерии, файлы задания.
 *
 * 0181: часть spec/scripts/lib/common.mjs; публичный вход — common.mjs.
 */
import path from 'node:path';
import { fail } from './cli.mjs';
import { exists, readText } from './fsio.mjs';
export function parseTaskMeta(taskMd) {
  const m = taskMd.match(/<!--\s*TASK-META\s*([\s\S]*?)-->/);
  if (!m) fail('В task.md нет блока <!-- TASK-META ... -->');
  let meta;
  try { meta = JSON.parse(m[1].trim()); }
  catch (err) { fail('TASK-META не является JSON: ' + err.message); }
  /*
   * 0068 (WC-43): узлы ролей — часть контракта, а не украшение. JSON.parse их и
   * так сохраняет, но нормализуем значения здесь: строка из одних пробелов не
   * должна выглядеть как указанный узел. Задача без узлов остаётся без них.
   */
  if (meta && typeof meta === 'object' && !Array.isArray(meta)) {
    for (const key of ['executorNode', 'acceptorNode']) {
      if (typeof meta[key] === 'string') meta[key] = meta[key].trim();
    }
  }
  return meta;
}

/*
 * 0068 (WC-43): привязка роли к узлу структуры.
 *
 * Приёмки 0063-0067 сделал нативный subagent вместо узла judge: подпись и
 * отдельная сессия были, а прогона в журнале структуры и Node: в письмах — нет.
 * Обход стал возможен потому, что движок не спрашивал про узел вовсе. Правило
 * должно отвечать машиной, а не дисциплиной.
 *
 * attributionGap(record) — вердикт по записи приёмки: null, если actor.node
 * указан; warn с причиной, если узла нет, но deviation объясняет отсутствие;
 * error для risk medium/high без узла и без объяснения; warn для low.
 */
export function attributionGap(record) {
  const source = record && typeof record === 'object' && !Array.isArray(record) ? record : {};
  const actor = source.actor && typeof source.actor === 'object' && !Array.isArray(source.actor) ? source.actor : {};
  const node = typeof actor.node === 'string' ? actor.node.trim() : '';
  if (node !== '') return null;
  const deviation = typeof source.deviation === 'string' ? source.deviation.trim() : '';
  if (deviation !== '') {
    return { level: 'warn', message: 'приёмка без actor.node объяснена отклонением: ' + deviation };
  }
  const risk = String(source.risk || '').toLowerCase();
  const hint = 'укажите узел (--node <узел> или WF_ACTOR_NODE) или объясните отсутствие (--deviation "<причина>")';
  if (risk === 'medium' || risk === 'high') {
    return { level: 'error', message: 'в записи нет actor.node, а risk=' + risk + ' требует узла: ' + hint };
  }
  return { level: 'warn', message: 'в записи нет actor.node: ' + hint };
}

/*
 * metaAttributionGap(meta) — то же для контракта: приёмщик-субагент без
 * acceptorNode должен быть назван либо узлом, либо deviation. Нативный subagent
 * допустим (политика структуры — warn), но отсутствие узла видно до работы.
 */
export function metaAttributionGap(meta) {
  const source = meta && typeof meta === 'object' && !Array.isArray(meta) ? meta : {};
  const node = typeof source.acceptorNode === 'string' ? source.acceptorNode.trim() : '';
  if (node !== '') return null;
  const deviation = typeof source.deviation === 'string' ? source.deviation.trim() : '';
  if (deviation !== '') return null;
  const acceptor = typeof source.acceptor === 'string' ? source.acceptor.trim() : '';
  if (!/^subagent/i.test(acceptor)) return null;
  return {
    level: 'warn',
    message: 'acceptor ' + acceptor + ' — нативный subagent без acceptorNode: укажите acceptorNode (узел) или deviation (причина)',
  };
}

/*
 * nodeConsistency(meta, record) — 0070: узел в записи — доказательство, а не
 * намерение контракта.
 *
 * acceptorNode в TASK-META объявляет, кто должен принимать, а не кто принимал.
 * Поэтому сверка идёт между объявлением и записью, а подставлять объявленный
 * узел в запись нельзя: при отказе узла judge запись 0069 утверждала приёмку
 * узлом, которого не было. Вердикты: совпадение — null; запись без узла, но с
 * deviation — null (отсутствие объяснено); запись без узла без объяснения —
 * warn с именем объявленного узла; другой узел в записи — warn о расхождении.
 */
export function nodeConsistency(meta, record) {
  const contract = meta && typeof meta === 'object' && !Array.isArray(meta) ? meta : {};
  const declared = typeof contract.acceptorNode === 'string' ? contract.acceptorNode.trim() : '';
  if (declared === '') return null;
  const source = record && typeof record === 'object' && !Array.isArray(record) ? record : {};
  const actor = source.actor && typeof source.actor === 'object' && !Array.isArray(source.actor) ? source.actor : {};
  const node = typeof actor.node === 'string' ? actor.node.trim() : '';
  const hint = 'укажите узел (--node <узел> или WF_ACTOR_NODE) или объясните отсутствие (--deviation "<причина>")';
  if (node === '') {
    const deviation = typeof source.deviation === 'string' ? source.deviation.trim() : '';
    if (deviation !== '') return null;
    return {
      level: 'warn',
      message: 'контракт объявляет acceptorNode "' + declared + '", а в записи узла нет: ' + hint,
    };
  }
  if (node === declared) return null;
  return {
    level: 'warn',
    message: 'acceptorNode контракта "' + declared + '" не совпадает с узлом записи "' + node
      + '": объясните расхождение (--deviation "<причина>") или принимайте под объявленным узлом',
  };
}

export function extractCriteriaBlock(taskMd) {
  const m = taskMd.match(/<!--\s*CRITERIA:BEGIN\s*-->([\s\S]*?)<!--\s*CRITERIA:END\s*-->/);
  if (!m) fail('В task.md нет блока <!-- CRITERIA:BEGIN --> ... <!-- CRITERIA:END -->');
  return m[1];
}

export function parseCriteria(taskDir, meta = null) {
  const file = path.join(taskDir, 'criteria.json');
  /*
   * 0167: лёгкая задача (watchdog, утилита) объявляет проверки в TASK-META:
   * mode=light и checks. Файла criteria.json нет, и он не создаётся; проверки
   * заморожены контрактным коммитом (task.md входит в taskFileSha256).
   * Обычная задача без criteria.json по-прежнему отказывает.
   */
  const light = meta && typeof meta === 'object' && String(meta.mode || '') === 'light';
  if (light) {
    const checks = Array.isArray(meta.checks) ? meta.checks : [];
    if (checks.length === 0) fail('mode=light: TASK-META.checks пуст — проверять нечего');
    for (const check of checks) {
      if (!check || typeof check !== 'object') fail('mode=light: checks должен содержать объекты критериев');
      if (!check.id) fail('mode=light: у проверки нет id');
      if (typeof check.command !== 'string' || check.command.trim() === '') fail('mode=light: проверка ' + check.id + ' без command');
    }
    const parsed = {
      task: String(meta.id || ''),
      criteria: checks,
      redExpect: { mustFail: [], mustPass: checks.map((check) => String(check.id)), noRed: { reason: 'лёгкая задача: красный не доказывается (mode=light)' } },
    };
    return { raw: JSON.stringify(parsed), parsed, criteria: checks, redExpect: parsed.redExpect, setup: [], teardown: [], light: true };
  }
  if (!exists(file)) fail('Нет criteria.json в ' + taskDir + ' (для лёгкой задачи укажите mode=light и checks в TASK-META)');
  const raw = readText(file);
  const parsed = JSON.parse(raw);
  const criteria = Array.isArray(parsed) ? parsed : parsed.criteria;
  if (!Array.isArray(criteria) || criteria.length === 0) fail('criteria.json: пустой список criteria');
  return {
    raw,
    parsed,
    criteria,
    redExpect: parsed.redExpect,
    setup: Array.isArray(parsed.setup) ? parsed.setup : [],
    teardown: Array.isArray(parsed.teardown) ? parsed.teardown : [],
  };
}

export function taskFiles(taskDir) {
  return {
    taskMd: path.join(taskDir, 'task.md'),
    criteriaJson: path.join(taskDir, 'criteria.json'),
    lock: path.join(taskDir, 'criteria.lock'),
    red: path.join(taskDir, 'red.json'),
    redLog: path.join(taskDir, 'red.log'),
    verify: path.join(taskDir, 'verify.json'),
    verifyLog: path.join(taskDir, 'verify.log'),
    acceptance: path.join(taskDir, 'acceptance.json'),
    report: path.join(taskDir, 'report.md'),
  };
}

/*
 * Журнал вердиктов ворот (2.6.18, 0051): append-only docs/tasks/<id>/gates.jsonl.
 *
 * Замер structure (письмо --127): «сколько раз ворота отказали и сколько это
 * стоило — сейчас неизмеримо; цена переделок считается косвенно, по git log».
 * red.log/verify.log пишут только успешный прогон целиком, поэтому отказ и его
 * причина исчезают: JSON-артефакт пишется один раз и перезаписывается, а
 * журнал — дописывается. Одна строка на прогон ворот: время (+03:00, как в
 * остальных артефактах), вид ворот, задание, HEAD, критерии с exit/ms/причинами,
 * вердикт, обходы, сводка выхода.
 *
 * Запись не бросает: сбой журнала — WARN вызывающего, а не падение ворот
 * (инвариант 3 задания). Порядок строк — порядок прогонов, прежние строки не
 * переписываются (инвариант 2).
 */

export function readTask(taskDir) {
  const files = taskFiles(taskDir);
  if (!exists(files.taskMd)) fail('Нет task.md в ' + taskDir);
  const taskMd = readText(files.taskMd);
  const meta = parseTaskMeta(taskMd);
  const criteria = parseCriteria(taskDir, meta);
  return { files, taskMd, meta, criteria };
}

