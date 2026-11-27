/*
 * 0184: печать итога приёмки — вынесена из task-accept.mjs.
 * Формат строк — часть контракта: те же поля и порядок, что печатал CLI.
 */
import path from 'node:path';
import { relPosix, formatGateRow, formatGateSummary, finalizationLines } from '../common.mjs';

export function printAcceptance(input) {
  const {
    json, record, meta, acceptor, entry, actorNode, deviation, actor, independence, keyId, acceptorRun,
    decisionSummary, attackCheck, recordActorModel, recordModelSource, actorModelLevel, acceptorInfo,
    releaseReady, contractCommit, candidate, localVcs, files, verify, repo, taskDir, SCRIPT_DIR,
    acceptanceRel, taskRel,
  } = input;
  if (json) {
    console.log(JSON.stringify(record, null, 2));
  } else {
    console.log('task-accept: ' + meta.id + ' принят');
    console.log('  acceptor      ' + acceptor + ' (' + entry.kind + ')');
    console.log('  node          ' + (actorNode || (deviation ? '— (deviation)' : '—')));
    console.log('  actor         ' + actor.kind + ' / ' + (actor.session || '—') + ' [' + actor.attestedBy + ']'
      + (actor.source ? ' ' + actor.source + ' (' + actor.sourceKind + ')' : ''));
    console.log('  independence  ' + independence.level + ' (нужно ' + independence.required + ')');
    console.log('  key           ' + keyId);
    console.log('  fresh run     ' + (acceptorRun.fresh ? 'да (' + acceptorRun.nonce + ')' : 'нет (reused)'));
    console.log('  decisions     ' + decisionSummary.count + ' (assumed: ' + (decisionSummary.assumed.join(', ') || 'нет') + ')');
    console.log('  attack        ' + (attackCheck ? attackCheck.summary.total + ' находок, blocking ' + attackCheck.summary.blocking + ', без решения ' + attackCheck.summary.unresolved : 'нет'));
    console.log('  actor model   ' + recordActorModel + ' (' + recordModelSource + ')');
    console.log('  model level   ' + actorModelLevel
      + (actorModelLevel === 'unknown'
        ? ' (независимость: семейства моделей не объявлены в config.models; сверка приёмщика — строка acceptor)'
        : ''));
    console.log('  acceptor      ' + (acceptorInfo
      ? 'узел ' + acceptorInfo.node + ', run ' + acceptorInfo.runId + ', модель ' + (acceptorInfo.model || '—')
        + ' против ' + (acceptorInfo.declaredModel || '—') + ' → ' + acceptorInfo.verdict
      : 'свидетельства запуска нет (TASK-META.acceptorNode не объявлен и --run не передан)'));
    console.log('  releaseReady  ' + releaseReady + (decisionSummary.assumed.length ? ' — есть решения без подтверждения' : ''));
    console.log('  contract      ' + contractCommit);
    console.log('  candidate     ' + (candidate.commit || '— (vcs: none, коммита нет)'));
    console.log('  tree          ' + (candidate.tree || '— (vcs: none)'));
    if (localVcs) console.log('  vcs           none (база — хеши контракта, кандидат — digest дерева)');
    console.log('  acceptance    ' + files.acceptance);
    console.log('');
    /* 0055: те же строки, что печатают ворота, — приёмщику не нужен повторный прогон. */
    for (const row of verify.results || []) console.log(formatGateRow(row));
    console.log(formatGateSummary(verify.results || []));
    console.log('');
    /*
     * 0097 (WC-32): строка accept пишется в gates.jsonl уже после сборки
     * кандидата, поэтому reset --hard её выбрасывает, если не добавить файл в
     * индекс. Печатаем оба пути — иначе журнал молча теряет приёмку.
     */
    const gateRel = relPosix(repo, path.join(taskDir, 'gates.jsonl'));
    /*
     * 0011 (F-2): путь к проверке записи вычисляется от самого скрипта
     * относительно корня репозитория. В пакете это spec/scripts/…, в
     * развёрнутой копии — docs/subagent-workflow/scripts/…; прежнее
     * «scripts/…» в развёрнутой копии не существовало.
     */
    const checkScriptRel = relPosix(repo, path.join(SCRIPT_DIR, 'task-check-acceptance.mjs'));
    /*
     * 0135 (2.6.109): подсказку собирает finalizationLines — первая строка
     * называет роль (координатор, не приёмщик), рядом с reset --hard стоит
     * предупреждение о незакоммиченных отслеживаемых правках вне кандидата.
     */
    if (localVcs) {
      console.log('Финализация: git не используется (vcs: none) — запись и факты остаются в рабочем дереве.');
      console.log('  проверка записи: node ' + checkScriptRel + ' --file ' + acceptanceRel + ' --repo . --task ' + taskRel);
    } else for (const line of finalizationLines({
      candidate: candidate.commit,
      acceptanceRel,
      gateRel,
      checkScriptRel,
      taskId: meta.id,
    })) console.log(line);
  }
}
