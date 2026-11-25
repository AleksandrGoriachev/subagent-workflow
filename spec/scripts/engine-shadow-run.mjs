#!/usr/bin/env node
/*
 * 0142/2.6.111: пересчёт тени движка для одной задачи.
 *
 * Тень пишется приёмкой (0152) и по умолчанию выключена. Когда меняется правило
 * движка (0142: покрытие подписи правил), старая тень остаётся с вердиктом по
 * прежнему правилу и обнуляет шаг SHADOW в selftest. Инструмент пересчитывает
 * факты задачи (convertToWorkspace с --force; бэкап делает конвертер) и пишет
 * docs/tasks/<id>/engine-shadow.json ровно тем же кодом, что приёмка
 * (evaluateWorkspaceTask), поэтому формат совпадает с task-accept.
 *
 * Приёмку инструмент не трогает: acceptance.json только читается, вердикт и
 * подписи не меняются. Это пересчёт доказательства, а не новая приёмка.
 *
 *   node spec/scripts/engine-shadow-run.mjs --task docs/tasks/0141 [--repo <dir>] [--workspace <dir>] [--json]
 */
import fs from 'node:fs';
import path from 'node:path';
import { isMainModule } from './lib/common.mjs';
import { parseArgv, readJson, writeJson, repoRoot } from './lib/common.mjs';
import { convertToWorkspace } from './facts-convert.mjs';
import { evaluateWorkspaceTask, loadAcceptors } from '../engine.mjs';

/**
 * Пересчитать тень одной задачи.
 * @returns {{ok: boolean, file: string, task: string, facts?: string, shadow?: object, passed?: number, applicable?: number, problems: string[]}}
 */
export function runShadow(taskDir, options = {}) {
  const dir = path.resolve(String(taskDir));
  const taskId = path.basename(dir);
  const repo = path.resolve(String(options.repo || repoRoot(dir)));
  /* Воркспейс по умолчанию — корень пакета: docs/tasks/<id> лежит на три уровня ниже. */
  const workspace = path.resolve(String(options.workspace || path.resolve(dir, '..', '..', '..')));
  const shadowFile = path.join(dir, 'engine-shadow.json');
  const converted = convertToWorkspace(dir, workspace, { force: true, repoRoot: repo });
  if (!converted.ok) {
    /* Формат отказа тот же, что у task-accept: тень «не проверена», а не «принята». */
    writeJson(shadowFile, { at: new Date().toISOString(), task: taskId, status: 'not-checked', problems: converted.problems });
    return { ok: false, file: shadowFile, task: taskId, problems: converted.problems };
  }
  const result = evaluateWorkspaceTask(workspace, taskId, { acceptors: loadAcceptors(workspace) });
  const acceptanceFile = path.join(dir, 'acceptance.json');
  const acceptance = fs.existsSync(acceptanceFile) ? readJson(acceptanceFile) : null;
  const acceptanceStatus = String((acceptance && acceptance.status) || 'accepted');
  const agree = acceptanceStatus === (result.verdict === 'accepted' ? 'accepted' : 'rejected');
  const shadow = {
    at: new Date().toISOString(),
    task: taskId,
    run: result.run,
    engineVerdict: result.verdict,
    acceptanceStatus,
    agree,
    report: result.report.map((item) => ({ id: item.id, status: item.status, detail: item.detail })),
  };
  writeJson(shadowFile, shadow);
  return {
    ok: true,
    file: shadowFile,
    task: taskId,
    facts: converted.file,
    shadow,
    passed: result.passed,
    applicable: result.applicable,
    problems: converted.problems,
  };
}

if (isMainModule(import.meta.url)) {
  const argv = parseArgv(process.argv.slice(2));
  if (argv.help) {
    console.log('Usage: node spec/scripts/engine-shadow-run.mjs --task <dir> [--repo <dir>] [--workspace <dir>] [--json]');
    process.exit(0);
  }
  const task = typeof argv.task === 'string' ? argv.task : (typeof argv._[0] === 'string' ? argv._[0] : '');
  if (!task) {
    console.log('нужен --task <dir>');
    process.exitCode = 2;
  } else {
    const run = runShadow(task, {
      repo: typeof argv.repo === 'string' ? argv.repo : undefined,
      workspace: typeof argv.workspace === 'string' ? argv.workspace : undefined,
    });
    for (const problem of run.problems || []) console.log('shadow: PROBLEM ' + problem);
    if (!run.ok) {
      console.log('shadow: не проверено — ' + (run.problems || []).join('; '));
      process.exitCode = 1;
    } else {
      if (argv.json) console.log(JSON.stringify({ file: run.file, facts: run.facts, ...run.shadow }, null, 2));
      else console.log('shadow: ' + run.task + ' ' + run.shadow.engineVerdict + ' — agree=' + run.shadow.agree + ' (' + run.passed + '/' + run.applicable + ')');
      /* Расхождение тени с приёмкой — сигнал, а не тишина; приёмку это не блокирует. */
      if (!run.shadow.agree) process.exitCode = 1;
    }
  }
}
