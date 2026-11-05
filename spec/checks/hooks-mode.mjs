#!/usr/bin/env node
/*
 * Право исполнения хуков — часть поставки, а не настройка раннера.
 *
 * Урок 2.5.1: spec/hooks/* лежали в git с режимом 100644. Linux молча
 * игнорирует неисполняемый хук, поэтому на ubuntu-latest два push-кейса
 * падали («хуки не активны»), а шаг `chmod +x spec/hooks/*` в CI это
 * скрывал: локально без него проверки красные, в CI зелёные. Сломанная
 * проверка хуже отсутствующей — она создаёт видимость покрытия.
 *
 * 2.6.8: режим в индексе и чистый ci.yml — необходимые, но не достаточные
 * условия. Хук, заменённый на `exit 0`, сохраняет и режим 100755, и текст
 * ci.yml, поэтому проверка обязана увидеть поведение. Сценарий повторяет e2e:
 * временный репозиторий, движок развёрнут из spec/ (init), guard включён,
 * настоящий `git commit`. Коммит вне задания отклоняет commit-msg, метка
 * обхода его разрешает. Ослабленный pre-commit (exit 0) коммит не пропускает —
 * его отклоняет commit-msg, — поэтому работу pre-commit видно по раннему
 * отчёту аудита: без этого отчёта проверка краснеет.
 *
 * На Windows хуки исполняет sh из Git for Windows — так же, как в e2e;
 * собственного требования «sh в PATH» у проверки нет.
 *
 * Файл защищён замком задания, поэтому ослабление проверки видно в записи
 * приёмки.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSyncPipeFree } from '../scripts/lib/common.mjs';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
/* 2.6.2: проверка относится к пакету (spec/checks); в развёрнутой копии spec/SPEC.md нет — SKIP. */
if (!fs.existsSync(path.join(ROOT, 'spec', 'SPEC.md'))) {
  console.log('SKIP: проверка относится к пакету (spec/checks), а не к развёрнутой копии');
  process.exit(0);
}
const HOOKS = ['pre-commit', 'commit-msg', 'pre-push'];
const CI = path.join(ROOT, '.github', 'workflows', 'ci.yml');
let failed = 0;

const fail = (message) => { failed += 1; console.log('FAIL ' + message); };
const pass = (message) => console.log('PASS ' + message);

function git(args, cwd = ROOT) {
  const result = spawnSyncPipeFree('git', args, { cwd, encoding: 'utf8' });
  return { code: result.status, out: String(result.stdout || ''), err: String(result.stderr || '') };
}

/* Режим в индексе — это то, что получит checkout на POSIX-машине. */
const listed = git(['ls-files', '-s', '--', 'spec/hooks']);
if (listed.code !== 0) {
  fail('git ls-files -s spec/hooks: ' + (listed.err.trim() || 'exit=' + listed.code));
} else {
  const modes = new Map();
  for (const line of listed.out.split(/\r?\n/)) {
    const parsed = line.match(/^(\d{6}) [0-9a-f]+ \d+\t(.+)$/);
    if (parsed) modes.set(parsed[2], parsed[1]);
  }
  for (const hook of HOOKS) {
    const rel = 'spec/hooks/' + hook;
    if (!modes.has(rel)) { fail(rel + ': нет в индексе'); continue; }
    const mode = modes.get(rel);
    if (mode !== '100755') fail(rel + ': режим ' + mode + ', ожидалось 100755 (git update-index --chmod=+x)');
    else pass(rel + ': 100755');
  }
}

/* CI обязан проверять режим, а не подменять его chmod-ом. */
let ci = '';
try { ci = fs.readFileSync(CI, 'utf8'); } catch { ci = ''; }
if (ci === '') {
  fail('нет .github/workflows/ci.yml');
} else {
  if (/chmod\s+\+x\s+spec\/hooks/.test(ci)) fail('CI чинит права хуков (chmod +x spec/hooks): дефект режима замаскирован — шаг убрать');
  else pass('CI не чинит права хуков');
  if (!/node\s+spec\/checks\/hooks-mode\.mjs/.test(ci)) fail('в CI нет шага node spec/checks/hooks-mode.mjs: регрессию режима никто не поймает');
  else pass('CI запускает проверку режима хуков');
}

/*
 * Поведенческий сценарий (2.6.8). Временный репозиторий: init разворачивает
 * движок из spec/ и ставит локальный core.hooksPath, поэтому проверяется
 * настоящий git commit, а не CLI. Каталог удаляется в finally.
 */
function behavior() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-hooks-'));
  const repo = path.join(tmp, 'repo');
  const keys = path.join(tmp, 'keys');
  /*
   * Хуки зовут node через `command -v node`. Каталог текущего интерпретатора
   * добавляется в PATH: иначе хук молча пропустит проверку, и «коммит прошёл»
   * ничего не доказывал бы.
   */
  const env = {
    ...process.env,
    PATH: path.dirname(process.execPath) + path.delimiter + String(process.env.PATH || ''),
  };
  const at = (args) => spawnSyncPipeFree('git', ['-C', repo, ...args], { cwd: repo, encoding: 'utf8', env });
  const text = (result) => String(result.stdout || '') + String(result.stderr || '');
  try {
    fs.mkdirSync(repo, { recursive: true });
    const initRepo = at(['init', '-q']);
    if (initRepo.status !== 0) { fail('поведение: git init во временном репозитории: ' + text(initRepo).trim()); return; }
    at(['config', 'user.email', 'hooks-mode@local']);
    at(['config', 'user.name', 'hooks-mode']);

    const deploy = spawnSyncPipeFree(process.execPath, [
      path.join(ROOT, 'spec', 'scripts', 'init.mjs'), '--repo', repo, '--key-out', keys,
    ], { cwd: repo, encoding: 'utf8', env, timeout: 300000 });
    if (deploy.status !== 0) { fail('поведение: init не развернул движок из spec/: ' + text(deploy).trim().slice(-400)); return; }

    const configFile = path.join(repo, 'docs', 'subagent-workflow', 'workflow.config.json');
    let config;
    try { config = JSON.parse(fs.readFileSync(configFile, 'utf8')); }
    catch (error) { fail('поведение: после init нет workflow.config.json (' + error.message + ')'); return; }
    config.guard = { mode: 'fail', allow: [], bypassMarker: 'workflow-bypass', enabled: true };
    fs.writeFileSync(configFile, JSON.stringify(config, null, 2) + '\n');

    const hooksPath = at(['config', '--get', 'core.hooksPath']);
    if (hooksPath.status !== 0) { fail('поведение: init не выставил локальный core.hooksPath'); return; }

    fs.mkdirSync(path.join(repo, 'src'), { recursive: true });
    fs.writeFileSync(path.join(repo, 'src', 'probe.js'), 'export const probe = 1;\n');
    at(['add', 'src/probe.js']);

    /* 1. Коммит вне задания отклоняется — и отклоняет его guard, а не что попало. */
    const denied = at(['commit', '-m', 'probe: изменение вне задания']);
    const deniedText = text(denied);
    if (denied.status === 0) {
      fail('поведение: включённый guard не отклонил коммит вне задания');
    } else if (!/не покрыт/.test(deniedText) || !/probe\.js/.test(deniedText)) {
      fail('поведение: коммит отклонён без сообщения guard: ' + deniedText.trim().slice(-300));
    } else {
      pass('поведение: включённый guard отклоняет коммит вне задания');
    }

    /* 2. Метка обхода разрешает тот же коммит. */
    const allowed = at(['commit', '-q', '-m', 'probe: срочно [workflow-bypass: hooks-mode]']);
    const allowedText = text(allowed);
    if (allowed.status !== 0) {
      fail('поведение: метка обхода не разрешила коммит: ' + allowedText.trim().slice(-300));
    } else {
      pass('поведение: метка обхода разрешает коммит');
      /*
       * 3. pre-commit обязан отчитаться аудитом индекса. Ослабленный хук
       * (`exit 0`) коммит не пропускает за commit-msg, поэтому единственный
       * наблюдаемый след его работы — этот отчёт; без него проверка снова
       * смотрела бы только на режим и текст CI.
       */
      if (/аудит индекса/.test(allowedText)) pass('поведение: pre-commit печатает аудит индекса');
      else fail('поведение: pre-commit не отчитался аудитом индекса — похоже, заменён на exit 0');
    }
  } finally {
    /*
     * На Windows каталог может быть занят только что завершившимся дочерним
     * процессом: ретраи и best-effort, чтобы уборка не превращала зелёный
     * прогон в случайный EPERM.
     */
    try { fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 50, retryDelay: 200 }); } catch { /* оставить ОС */ }
  }
}

try {
  behavior();
} catch (error) {
  fail('поведение: сценарий не выполнился: ' + (error && error.message ? error.message : error));
}

if (failed > 0) {
  console.log('');
  console.log('HOOKS MODE FAIL: ' + failed);
  process.exit(1);
}
console.log('');
console.log('HOOKS MODE OK');
