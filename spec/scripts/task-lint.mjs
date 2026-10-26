#!/usr/bin/env node
import path from 'node:path';
import {
  parseArgv, readTask, verifyLock, exists, git, repoRoot, extractCriteriaBlock,
  scanSecrets, isManual, decisionEvidenceKind, DECISION_CLASSES, DECISION_IMPACTS,
  DECISION_EVIDENCE_KINDS, loadConfig, readJson,
} from './lib/common.mjs';
import { policyOf, applyLevel } from './lib/policy.mjs';
import { evaluateAttack } from './lib/attack.mjs';

const NL = String.fromCharCode(10);
const argv = parseArgv(process.argv.slice(2));
if (argv.help) {
  console.log('Usage: node task-lint.mjs --task <dir> [--repo <dir>] [--strict] [--json]');
  process.exit(0);
}

const taskDir = path.resolve(argv.task || argv._[0] || '.');
const repo = path.resolve(argv.repo || repoRoot(taskDir));
const strict = Boolean(argv.strict);
const errors = [];
const warnings = [];
const error = (m) => errors.push(m);
const warn = (m) => warnings.push(m);

function headingTitle(line) {
  let s = line.slice(3).trim();
  const m = s.match(/^[0-9]+\./);
  if (m) s = s.slice(m[0].length).trim();
  return s;
}

try {
  const { files, taskMd, meta, criteria } = readTask(taskDir);
  const config = loadConfig(repo);
  const policy = policyOf(config);

  const requiredMeta = ['id', 'version', 'risk', 'created', 'owner', 'executor', 'acceptor', 'base', 'criteria', 'allowedPaths'];
  for (const key of requiredMeta) {
    if (meta[key] === undefined || meta[key] === null || meta[key] === '') error('TASK-META: нет поля ' + key);
  }
  const id = String(meta.id ?? '');
  if (!/^[0-9A-Za-z._-]+$/.test(id)) error('TASK-META.id: допустимы буквы, цифры, точка, _, -');
  const baseName = path.basename(taskDir);
  if (/^[0-9]{4,}$/.test(baseName) && id !== baseName) error('TASK-META.id (' + id + ') не совпадает с именем каталога (' + baseName + ')');
  if (!['low', 'medium', 'high'].includes(meta.risk)) error('TASK-META.risk: ожидается low | medium | high');
  if (!Number.isInteger(meta.version) || meta.version < 1) error('TASK-META.version: целое >= 1');
  if (meta.executor && meta.acceptor && meta.executor === meta.acceptor) error('executor и acceptor должны быть разными ролями');
  if (meta.created && !/^[0-9]{4}-[0-9]{2}-[0-9]{2}/.test(String(meta.created))) warn('TASK-META.created: ожидается дата YYYY-MM-DD');
  if (meta.risk === 'high' && meta.securityReview !== true) error('risk=high без securityReview: true');
  if (meta.risk === 'high' && meta.humanSignoff !== true) error('risk=high без humanSignoff: true');
  /*
   * Кто выдал задание — часть контракта, а не отчёт исполнителя (1.4, D1). Сессия постановщика
   * фиксируется до работы и позже не даёт приёмщику совпасть с ним. Для low поле не требуется:
   * там цена ошибки ниже, а запись всё равно помечается как declared.
   */
  if (meta.risk !== 'low') {
    const issuedBy = meta.issuedBy;
    if (issuedBy === undefined || issuedBy === null || typeof issuedBy !== 'object' || Array.isArray(issuedBy)) {
      error('TASK-META.issuedBy: для medium/high нужен объект { kind, session, model }');
    } else {
      if (issuedBy.kind !== 'agent') error('TASK-META.issuedBy.kind: ожидается agent');
      if (typeof issuedBy.session !== 'string' || issuedBy.session.trim() === '') error('TASK-META.issuedBy.session: нужна непустая сессия постановщика');
      if (typeof issuedBy.model !== 'string' || issuedBy.model.trim() === '') error('TASK-META.issuedBy.model: нужна модель постановщика');
    }
  }

  const allowed = Array.isArray(meta.allowedPaths) ? meta.allowedPaths : [];
  if (allowed.length === 0) error('TASK-META.allowedPaths: нужен хотя бы один путь');
  for (const p of allowed) {
    if (typeof p !== 'string' || !p.trim()) { error('allowedPaths: пустой или нестроковый элемент'); continue; }
    if (path.isAbsolute(p)) error('allowedPaths: абсолютный путь запрещён: ' + p);
    if (p.split('/').includes('..')) error('allowedPaths: ".." запрещён: ' + p);
    if (p === '**' || p === '**/*') warn('allowedPaths: слишком широкий шаблон: ' + p);
  }
  const protectedPaths = Array.isArray(meta.protectedPaths) ? meta.protectedPaths : [];
  if (protectedPaths.length === 0 && meta.risk !== 'low') warn('protectedPaths пуст: тесты/проверки не защищены хешем');
  for (const p of protectedPaths) {
    if (typeof p !== 'string' || !p.trim()) error('protectedPaths: пустой или нестроковый элемент');
    else if (path.isAbsolute(p) || p.split('/').includes('..')) error('protectedPaths: недопустимый путь: ' + p);
  }
  const redAllow = Array.isArray(meta.redAllowDirty) ? meta.redAllowDirty : [];
  for (const p of redAllow) {
    if (typeof p !== 'string' || path.isAbsolute(p) || p.split('/').includes('..')) error('redAllowDirty: недопустимый путь: ' + p);
  }

  const headings = ['Цель', 'Что не входит', 'Инварианты', 'Границы знания', 'Среда', 'Критерии приёмки', 'Отчёт', 'Коммит'];
  const actualHeadings = taskMd.split(NL).filter((l) => l.startsWith('## ')).map(headingTitle);
  for (const h of headings) {
    if (!actualHeadings.includes(h)) error('task.md: нет раздела "## ' + h + '"');
  }

  const block = extractCriteriaBlock(taskMd);
  const tableIds = [];
  const blockLines = block.replaceAll(String.fromCharCode(13), '').split(NL);
  for (const line of blockLines) {
    if (!line.trim().startsWith('|')) continue;
    if (/^[|: -]+$/.test(line.trim())) continue;
    const cells = line.split('|').slice(1, -1).map((c) => c.trim());
    if (cells.length === 0) continue;
    const first = cells[0].replace(/[*_]/g, '').trim();
    if (!first || first.toLowerCase() === 'id' || first === '№' || first === '#') continue;
    tableIds.push(first);
  }
  if (tableIds.length === 0) error('Критерии: таблица пуста или не распознана');
  if (criteria.parsed.task && String(criteria.parsed.task) !== id) error('criteria.json.task (' + criteria.parsed.task + ') не совпадает с TASK-META.id (' + id + ')');
  const jsonIds = criteria.criteria.map((c) => String(c.id));
  const dupJson = jsonIds.filter((x, i) => jsonIds.indexOf(x) !== i);
  if (dupJson.length) error('criteria.json: повторяются ID: ' + [...new Set(dupJson)].join(', '));
  const onlyTable = tableIds.filter((x) => !jsonIds.includes(x));
  const onlyJson = jsonIds.filter((x) => !tableIds.includes(x));
  if (onlyTable.length) error('Критерии есть в таблице, но нет в criteria.json: ' + onlyTable.join(', '));
  if (onlyJson.length) error('Критерии есть в criteria.json, но нет в таблице: ' + onlyJson.join(', '));

  for (const c of criteria.criteria) {
    const cid = String(c.id ?? '?');
    if (!c.id) error('criterion без id');
    if (!c.title || typeof c.title !== 'string') error('criterion ' + cid + ': нет title');
    if (!c.command || typeof c.command !== 'string') error('criterion ' + cid + ': нет command');
    const expect = c.expect;
    if (!expect || typeof expect !== 'object' || Object.keys(expect).length === 0) {
      error('criterion ' + cid + ': пустой expect (укажите exitCode/stdoutContains/stdoutRegex/json)');
    } else {
      const allowedKeys = ['exitCode', 'stdoutContains', 'stderrContains', 'stdoutRegex', 'stderrRegex', 'json'];
      for (const k of Object.keys(expect)) if (!allowedKeys.includes(k)) warn('criterion ' + cid + ': неизвестный ключ expect.' + k);
      if ('exitCode' in expect && !Number.isInteger(expect.exitCode)) error('criterion ' + cid + ': expect.exitCode должен быть целым');
    }
    if (c.timeoutMs !== undefined && (!Number.isInteger(c.timeoutMs) || c.timeoutMs <= 0)) error('criterion ' + cid + ': timeoutMs должен быть целым > 0');
    if (c.tags !== undefined && !Array.isArray(c.tags)) error('criterion ' + cid + ': tags должен быть массивом');
    if (typeof c.command === 'string' && /(?:^| )(?:rm -rf|git push|git commit|npm publish|DROP TABLE)/i.test(c.command)) {
      warn('criterion ' + cid + ': потенциально необратимая команда: ' + c.command.slice(0, 120));
    }
    /*
     * covers (2.1.0): критерий объявляет, какие файлы он покрывает. Без этого
     * приёмка проверяет только объявленные команды и не видит изменённый код,
     * на который критерия нет.
     */
    if (c.covers !== undefined) {
      if (!Array.isArray(c.covers) || c.covers.length === 0) {
        error('criterion ' + cid + ': covers должен быть непустым массивом шаблонов путей');
      } else {
        for (const pattern of c.covers) {
          if (typeof pattern !== 'string' || pattern.trim() === '') error('criterion ' + cid + ': covers содержит пустой шаблон');
          else if (path.isAbsolute(pattern) || pattern.split('/').includes('..')) error('criterion ' + cid + ': covers: недопустимый путь: ' + pattern);
        }
      }
    }
  }
  const coversDeclared = criteria.criteria.some((c) => Array.isArray(c.covers) && c.covers.length > 0);
  if (meta.risk !== 'low' && !coversDeclared) {
    const appliedCovers = applyLevel(policy.coverage, ['criteria.json: для risk=' + meta.risk + ' нужен хотя бы один критерий с covers: без него изменённый код может остаться без проверки']);
    errors.push(...appliedCovers.errors);
    warnings.push(...appliedCovers.warnings);
  }
  for (const key of ['setup', 'teardown']) {
    if (criteria.parsed[key] !== undefined && !Array.isArray(criteria.parsed[key])) error('criteria.json: ' + key + ' должен быть массивом');
  }

  const redExpect = criteria.redExpect;
  if (redExpect !== undefined) {
    if (typeof redExpect !== 'object' || redExpect === null || Array.isArray(redExpect)) {
      error('criteria.json: redExpect должен быть объектом');
    } else {
      const mustFail = Array.isArray(redExpect.mustFail) ? redExpect.mustFail.map(String) : null;
      const mustPass = Array.isArray(redExpect.mustPass) ? redExpect.mustPass.map(String) : [];
      if (mustFail === null) error('criteria.json: redExpect.mustFail должен быть массивом ID');
      if (mustFail !== null && mustFail.length === 0 && meta.risk !== 'low') error('criteria.json: redExpect.mustFail пуст');
      for (const id of [...(mustFail || []), ...mustPass]) {
        if (!jsonIds.includes(id)) error('criteria.json: redExpect ссылается на неизвестный критерий ' + id);
        const criterion = criteria.criteria.find((c) => String(c.id) === id);
        if (criterion && isManual(criterion)) error('criteria.json: redExpect не должен ссылаться на manual-критерий ' + id);
      }
      for (const id of (mustFail || [])) if (mustPass.includes(id)) error('criteria.json: критерий ' + id + ' одновременно mustFail и mustPass');
      const declared = new Set([...(mustFail || []), ...mustPass]);
      for (const c of criteria.criteria) if (!isManual(c) && !declared.has(String(c.id))) error('criteria.json: критерий ' + c.id + ' не указан в redExpect');
      if (redExpect.reasons !== undefined) {
        if (typeof redExpect.reasons !== 'object' || redExpect.reasons === null || Array.isArray(redExpect.reasons)) {
          error('criteria.json: redExpect.reasons должен быть объектом');
        } else {
          for (const [id, reason] of Object.entries(redExpect.reasons)) {
            if (!(mustFail || []).includes(id)) error('criteria.json: redExpect.reasons для ' + id + ', а он не в mustFail');
            if (typeof reason !== 'string' || reason.trim() === '') error('criteria.json: redExpect.reasons[' + id + '] пуст');
          }
        }
      }
      if (meta.risk !== 'low') {
        for (const id of (mustFail || [])) {
          const reason = (redExpect.reasons || {})[id];
          if (typeof reason !== 'string' || reason.trim() === '') {
            error('criteria.json: для risk=' + meta.risk + ' нужна причина падения redExpect.reasons[' + id + ']');
          }
        }
      }
    }
  } else if (meta.risk !== 'low') {
    error('criteria.json: для risk=' + meta.risk + ' нужен redExpect (mustFail/mustPass)');
  }
  if (meta.risk !== 'low' && !criteria.criteria.some((c) => Array.isArray(c.tags) && c.tags.includes('negative'))) {
    error('criteria.json: для risk=' + meta.risk + ' нужен хотя бы один критерий с tags: ["negative"]');
  }

  /*
   * Решения (2.1.0): реестр того, что выбрано сверх механической работы. Смысл —
   * сделать предположение видимым: у семантического решения либо есть исполняемый
   * критерий, либо подтверждение человека; иначе выпуск закрыт (assumed).
   */
  const decisionIssues = [];
  const decisionNote = (message) => decisionIssues.push(message);
  const decisions = meta.decisions;
  if (meta.risk !== 'low' && decisions === undefined) {
    decisionNote('TASK-META.decisions: для risk=' + meta.risk + ' нужен массив решений (пустой — если решений сверх механических нет)');
  }
  if (decisions !== undefined && !Array.isArray(decisions)) {
    decisionNote('TASK-META.decisions должен быть массивом');
  }
  if (Array.isArray(decisions)) {
    const seen = new Set();
    for (const [index, decision] of decisions.entries()) {
      const label = 'решение ' + ((decision && decision.id) ? decision.id : '#' + (index + 1));
      if (!decision || typeof decision !== 'object' || Array.isArray(decision)) { decisionNote(label + ': должен быть объектом'); continue; }
      if (typeof decision.id !== 'string' || decision.id.trim() === '') decisionNote(label + ': нет id');
      else if (seen.has(decision.id)) decisionNote(label + ': повторяется id');
      else seen.add(decision.id);
      if (typeof decision.question !== 'string' || decision.question.trim() === '') decisionNote(label + ': нет question');
      if (typeof decision.chosen !== 'string' || decision.chosen.trim() === '') decisionNote(label + ': нет chosen');
      if (!DECISION_CLASSES.includes(decision.class)) {
        decisionNote(label + ': class должен быть ' + DECISION_CLASSES.join(' | '));
        continue;
      }
      if (decision.class === 'mechanical') continue;
      if (!Array.isArray(decision.options) || decision.options.length < 2) decisionNote(label + ': options — минимум два варианта');
      if (!DECISION_IMPACTS.includes(decision.impact)) decisionNote(label + ': impact должен быть ' + DECISION_IMPACTS.join(' | '));
      if (typeof decision.reversible !== 'boolean') decisionNote(label + ': reversible должен быть boolean');
      if (decision.status !== undefined && !['confirmed', 'assumed'].includes(decision.status)) decisionNote(label + ': status должен быть confirmed | assumed');
      if (decision.evidence !== undefined) {
        const evidence = decision.evidence;
        if (!evidence || typeof evidence !== 'object' || Array.isArray(evidence)) decisionNote(label + ': evidence должен быть объектом');
        else {
          if (!DECISION_EVIDENCE_KINDS.includes(evidence.kind)) decisionNote(label + ': evidence.kind должен быть ' + DECISION_EVIDENCE_KINDS.join(' | '));
          if (evidence.kind === 'criterion') {
            if (typeof evidence.ref !== 'string' || !jsonIds.includes(evidence.ref)) decisionNote(label + ': evidence.ref должен называть критерий задания (' + (evidence.ref || '—') + ')');
          } else if (typeof evidence.ref !== 'string' || evidence.ref.trim() === '') {
            decisionNote(label + ': evidence.ref обязателен (раздел спецификации, ссылка на ответ заказчика)');
          }
        }
      }
      if (decision.confirmation !== undefined) {
        const confirmation = decision.confirmation;
        if (!confirmation || typeof confirmation !== 'object' || Array.isArray(confirmation)) decisionNote(label + ': confirmation должен быть объектом');
        else {
          if (!['customer', 'human'].includes(confirmation.kind)) decisionNote(label + ': confirmation.kind должен быть customer | human');
          if (typeof confirmation.who !== 'string' || confirmation.who.trim() === '') decisionNote(label + ': confirmation.who обязателен');
          if (typeof confirmation.at !== 'string' || confirmation.at.trim() === '') decisionNote(label + ': confirmation.at обязателен');
        }
      }
      const evidenceKind = decisionEvidenceKind(decision, criteria.criteria);
      const touchesUser = decision.impact === 'user-visible' || decision.impact === 'public-contract';
      if (evidenceKind === 'none' && touchesUser) {
        decisionNote(label + ': impact=' + decision.impact + ' требует исполняемого критерия (evidence.kind=criterion) или подтверждения человека (confirmation)');
      }
      if (evidenceKind === 'none' && decision.status === 'confirmed') {
        decisionNote(label + ': status=confirmed без доказательства — так нельзя');
      }
      if (evidenceKind !== 'none' && decision.status === 'assumed') {
        warn(label + ': status=assumed, хотя доказательство есть — уберите assumed');
      }
      if (evidenceKind === 'none' && !touchesUser) {
        warn(label + ': решение assumed — приёмка возможна, но releaseReady будет false до подтверждения');
      }
    }
  }
  const decisionsApplied = applyLevel(policy.decisions, decisionIssues);
  errors.push(...decisionsApplied.errors);
  warnings.push(...decisionsApplied.warnings);

  const secrets = scanSecrets(taskMd + NL + criteria.raw);
  for (const s of secrets) error('Похоже на секрет (' + s.name + ') в строке ' + s.line + ': ' + s.excerpt);

  if (taskMd.includes('см. переписк') || taskMd.includes('как обсуждали') || taskMd.toLowerCase().includes('as discussed')) {
    warn('task.md ссылается на переписку — исполнитель её не видит');
  }

  if (exists(files.lock)) {
    const check = verifyLock(repo, taskDir, meta, taskMd, criteria);
    for (const e of check.errors) error('criteria.lock: ' + e);
  } else if (strict) error('criteria.lock отсутствует (--strict): выполните task-hash --write');
  else warn('criteria.lock отсутствует: выполните task-hash --write до красного прогона');

  /*
   * Атака спецификации (2.2.0): если файл есть — проверяем; если policy.attack=fail
   * и файла нет, для medium/high это ошибка. Уровень строгости — в конфиге.
   */
  const attackFile = path.join(taskDir, 'attack.json');
  if (exists(attackFile)) {
    const attackCheck = evaluateAttack(readJson(attackFile), { meta, config });
    const appliedAttack = applyLevel(policy.attack, attackCheck.issues);
    const appliedFamily = applyLevel(policy.roles.modelFamily, attackCheck.familyIssues);
    for (const e of [...appliedAttack.errors, ...appliedFamily.errors]) error('attack.json: ' + e);
    for (const w of [...appliedAttack.warnings, ...appliedFamily.warnings]) warn('attack.json: ' + w);
  } else if (policy.attack === 'fail' && meta.risk !== 'low') {
    error('attack.json: атака спецификации не проводилась (policy.attack=fail)');
  }

  if (meta.base) {
    const ref = git(repo, ['rev-parse', '--verify', String(meta.base) + '^{commit}']);
    if (ref.exitCode !== 0) warn('TASK-META.base не разрешается в коммит: ' + meta.base);
  }

  if (argv.json) {
    console.log(JSON.stringify({ ok: errors.length === 0, task: id, errors, warnings }, null, 2));
  } else {
    console.log('task-lint: ' + (id || '(без id)') + ' — ' + (errors.length ? 'ОШИБКИ' : 'ок'));
    for (const e of errors) console.log('  ERROR ' + e);
    if (!argv.quiet) for (const w of warnings) console.log('  WARN  ' + w);
    if (errors.length) console.log(NL + 'Исправьте ошибки до красного прогона.');
  }
  process.exit(errors.length ? 1 : 0);
} catch (err) {
  if (argv.json) console.log(JSON.stringify({ ok: false, errors: [err.message], warnings }, null, 2));
  else console.error('task-lint: ' + err.message);
  process.exit(err.exitCode || 1);
}
