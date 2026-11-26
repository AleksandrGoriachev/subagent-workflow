#!/usr/bin/env node
/*
 * 0092 (WC-20): контракт до красного — mustPass должны быть зелёными на базе.
 *
 * Usage: node task-preflight.mjs --task <dir> [--repo <dir>] [--json]
 * Дешёвые mustPass идут первыми; дорогие не запускаются, если дешёвая упала.
 * Exit 0 — контракт согласован с базой; exit 1 — mustPass красный, красный прогон
 * докажет ошибку контракта, а не поведение.
 *
 * 0164: тот же вход умеет проверять сам контракт ДО запуска узла — режим --contract
 * (или любой вызов с --paths, который без него не имеет смысла). Находка проекта
 * support: исполнитель узнал об отсутствии TASK-META и о недопустимом имени каталога
 * только на первом write, после половины работы. Режим контракта только читает, без
 * git и без записи, и называет каждую причину отдельной строкой с файлом и полем.
 *
 *   --contract          проверить контракт: имя каталога, task.md, TASK-META, поля,
 *                       criteria, принятое задание
 *   --paths "a,b"       (режим контракта) пути, которые узел собирается править:
 *                       каждый обязан попадать под allowedPaths
 */
import fs from 'node:fs';
import path from 'node:path';
import { parseArgv, readTask, repoRoot, reportFatal, matchesAny } from './lib/common.mjs';
import { preflightMustPass } from './lib/preflight.mjs';

const argv = parseArgv(process.argv.slice(2));
if (argv.help) {
  console.log('Usage: node task-preflight.mjs --task <dir> [--repo <dir>] [--json] [--contract] [--paths "a,b"]');
  console.log('Без --contract и без --paths: гоняет mustPass-критерии на текущем дереве (база).');
  console.log('С --contract: проверяет сам контракт до запуска узла и называет причину отказа.');
  process.exit(0);
}

const taskArg = String(argv.task || argv._[0] || '');
const contractMode = argv.contract === true || typeof argv.paths === 'string';

/* 0164: режим контракта — только чтение, коды 0/1/2, причина в каждой строке. */
if (contractMode) {
  const repo = path.resolve(String(argv.repo || process.cwd()));
  if (taskArg === '') {
    console.log('ПРЕФЛАЙТ: нужен --task docs/tasks/<id>');
    process.exit(2);
  }
  const taskDir = path.resolve(repo, taskArg);
  if (!fs.existsSync(taskDir) || !fs.statSync(taskDir).isDirectory()) {
    console.log('ПРЕФЛАЙТ: нет каталога задания ' + taskDir);
    process.exit(2);
  }
  const id = path.basename(taskDir);
  const taskRel = 'docs/tasks/' + id;
  const problems = [];

  /* 1. Имя каталога: только четыре цифры; суффикс молча выключает поиск задания. */
  if (!/^[0-9]{4}$/u.test(id)) {
    problems.push('каталог задания «' + id + '»: допустимо только четыре цифры (например 0164); суффикс после номера не допускается');
  }

  /* 2. task.md и блок TASK-META. */
  const taskMdFile = path.join(taskDir, 'task.md');
  let meta = null;
  if (!fs.existsSync(taskMdFile)) {
    problems.push('нет файла ' + taskRel + '/task.md');
  } else {
    const text = fs.readFileSync(taskMdFile, 'utf8');
    const match = text.match(/<!--\s*TASK-META\s*([\s\S]*?)-->/);
    if (!match) {
      problems.push('в ' + taskRel + '/task.md нет блока TASK-META (<!-- TASK-META { … } -->)');
    } else {
      try {
        meta = JSON.parse(match[1].trim());
      } catch (error) {
        problems.push('TASK-META не разбирается как JSON: ' + String(error && error.message ? error.message : error));
      }
    }
  }

  /* 3. Обязательные поля — с именем поля в причине. */
  const allowedPaths = [];
  if (meta !== null && (typeof meta !== 'object' || Array.isArray(meta))) {
    problems.push('TASK-META должна быть объектом, а не ' + (Array.isArray(meta) ? 'массивом' : typeof meta));
    meta = null;
  }
  if (meta !== null) {
    const declaredId = String(meta.id || '');
    if (declaredId === '') problems.push('поле id в TASK-META не задано');
    else if (/^[0-9]{4}$/u.test(id) && declaredId !== id) {
      problems.push('поле id «' + declaredId + '» не совпадает с каталогом «' + id + '»');
    }
    if (!['low', 'medium', 'high'].includes(String(meta.risk || ''))) {
      problems.push('поле risk в TASK-META: «' + String(meta.risk || '') + '» — ожидается low, medium или high');
    }
    if (typeof meta.owner !== 'string' || meta.owner.trim() === '') {
      problems.push('поле owner в TASK-META не задано: контракт не называет владельца');
    }
    if (Array.isArray(meta.allowedPaths)) {
      for (const item of meta.allowedPaths) if (typeof item === 'string' && item.trim() !== '') allowedPaths.push(item.trim());
    }
    if (allowedPaths.length === 0) problems.push('allowedPaths в TASK-META пуст или не массив: узлу нечего править');
  }

  /* 4. Критерии: файл из TASK-META (по умолчанию criteria.json) обязан существовать. */
  const criteriaRel = String((meta && meta.criteria) || 'criteria.json');
  const lightMode = meta !== null && String(meta.mode || '') === 'light';
  if (!lightMode && !fs.existsSync(path.resolve(taskDir, criteriaRel))) {
    problems.push('нет ' + criteriaRel + ', указанного в TASK-META (для лёгкой задачи укажите mode: "light")');
  }

  /* 5. Принятое задание — отдельная причина, а не «нет META». */
  if (fs.existsSync(path.join(taskDir, 'acceptance.json'))) {
    problems.push('задание уже принято (' + taskRel + '/acceptance.json): новые правки оформляются новым заданием');
  }

  /* 6. Покрытие заявленных путей: каждый обязан попадать под allowedPaths. */
  const declaredPaths = String(argv.paths || '')
    .split(/[,;]/u).map((value) => value.trim()).filter((value) => value !== '');
  if (declaredPaths.length > 0 && meta !== null) {
    for (const declared of declaredPaths) {
      if (!matchesAny(declared, allowedPaths)) {
        problems.push('путь ' + declared + ' не покрыт allowedPaths: '
          + (allowedPaths.length === 0 ? '(список пуст)' : allowedPaths.join(', ')));
      }
    }
  }

  if (problems.length > 0) {
    for (const problem of problems) console.log('ПРЕФЛАЙТ: ' + problem);
    console.log('префлайт: отказ, причин ' + problems.length);
    process.exit(1);
  }
  console.log('префлайт: OK — контракт ' + id + ', allowedPaths ' + allowedPaths.length
    + (declaredPaths.length > 0 ? ', проверено путей ' + declaredPaths.length : ''));
  process.exit(0);
}

/* 0092: прежний режим — mustPass на базе. */
const taskDir = path.resolve(taskArg || '.');
const repo = path.resolve(String(argv.repo || repoRoot(taskDir)));
try {
  const { criteria } = readTask(taskDir);
  const report = await preflightMustPass({
    repo,
    criteria,
    log: (line) => { if (argv.json !== true) console.log(line); },
  });
  if (argv.json === true) {
    console.log(JSON.stringify({ repo, task: path.basename(taskDir), ...report }, null, 2));
  } else if (report.empty) {
    console.log('PREFLIGHT: mustPass не объявлены — проверять нечего');
  } else {
    console.log('ИТОГ preflight: ' + (report.ok ? 'mustPass зелёные на базе' : 'mustPass красные на базе — контракт сломан')
      + (report.skipped.length ? ', пропущено дорогих: ' + report.skipped.join(',') : ''));
  }
  process.exit(report.ok ? 0 : 1);
} catch (error) {
  reportFatal('task-preflight', error);
}
