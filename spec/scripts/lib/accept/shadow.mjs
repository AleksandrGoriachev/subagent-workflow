/*
 * 0184: теневой прогон движка ограничений — вынесен из task-accept.mjs.
 * Ничего не блокирует и не меняет вердикт; пишет engine-shadow.json.
 */
import fs from 'node:fs';
import path from 'node:path';
import { readJson, writeJson } from '../common.mjs';
import { convertToWorkspace } from '../../facts-convert.mjs';
import { evaluateWorkspaceTask, loadAcceptors as loadEngineAcceptors } from '../../../engine.mjs';

/**
 * 0152 (P2a): теневой прогон движка ограничений. Ничего не блокирует и не меняет
 * вердикт: конвертирует задачу в факты, оценивает C1–C10 и записывает сравнение
 * с фактической приёмкой. Цель — статистика расхождений до переключения.
 * По умолчанию выключена (чужой воркспейс не трогаем).
 */
export function engineShadow(repo, taskDir, meta, record) {
  /*
   * 0153: тень по умолчанию ВЫКЛЮЧЕНА. Приёмка живёт в чужих воркспейсах, и
   * молча создавать там docs/facts/ и engine-shadow.json нельзя. Включается
   * явно: WF_ENGINE_SHADOW=1 или "engineShadow": true в workflow.config.json.
   */
  const config = readJson(path.join(repo, 'docs', 'subagent-workflow', 'workflow.config.json')) || {};
  const enabled = String(process.env.WF_ENGINE_SHADOW || '') === '1' || config.engineShadow === true;
  if (!enabled) return;
  try {
    /*
     * 0158: если факты уже есть и цепь цела — не пересобираем. Пересборка с --force
     * стёрла бы подписанный sealed-факт (его не восстановить из источников), а для
     * теневого прогона достаточно прочитать существующую цепь.
     */
    const factsFile = path.join(repo, 'docs', 'facts', String(meta.id) + '.jsonl');
    const existing = fs.existsSync(factsFile) ? readFactFile(factsFile) : null;
    const converted = existing && existing.ok
      ? { ok: true, rows: existing.rows.length, signed: existing.rows.filter((row) => row.signature).length }
      : convertToWorkspace(taskDir, repo, { repoRoot: repo, force: true });
    if (!converted.ok) {
      writeJson(path.join(taskDir, 'engine-shadow.json'), { at: new Date().toISOString(), task: meta.id, status: 'not-checked', problems: converted.problems });
      console.log('engine (тень): не проверено — ' + (converted.problems || []).join('; '));
      return;
    }
    const result = evaluateWorkspaceTask(repo, meta.id, { acceptors: loadEngineAcceptors(repo) });
    const agree = String(record.status || 'accepted') === (result.verdict === 'accepted' ? 'accepted' : 'rejected');
    writeJson(path.join(taskDir, 'engine-shadow.json'), {
      at: new Date().toISOString(),
      task: meta.id,
      run: result.run,
      engineVerdict: result.verdict,
      acceptanceStatus: record.status || 'accepted',
      agree,
      report: result.report.map((item) => ({ id: item.id, status: item.status, detail: item.detail })),
    });
    console.log('engine (тень): ' + result.verdict + ' — ' + (agree ? 'совпадает с приёмкой' : 'РАСХОЖДЕНИЕ с приёмкой') + ' (' + result.passed + '/' + result.applicable + ')');
  } catch (error) {
    try { writeJson(path.join(taskDir, 'engine-shadow.json'), { at: new Date().toISOString(), task: meta.id, status: 'error', problem: String(error && error.message ? error.message : error) }); } catch { /* тень не ломает приёмку */ }
    console.log('engine (тень): ошибка — ' + String(error && error.message ? error.message : error));
  }
}
