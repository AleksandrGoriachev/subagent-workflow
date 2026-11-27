/**
 * Общие утилиты движка: единый публичный вход.
 *
 * 0181: реализация разложена по слоям spec/scripts/lib/common/*.mjs (версия,
 * CLI, файлы, процессы, git, глобы, контракт, журнал, замок, секреты, критерии,
 * решения, красный, конфиг). Этот файл — баррель: 105 имён и путь импорта
 * остались прежними, поэтому 106 импортёров не правятся.
 *
 * Слои: engine-version → cli → fsio → proc → git-base → glob → contract-git →
 * git-status → task-contract → journal → lock → secrets → criteria →
 * decisions → red → config. Циклов нет.
 */
export { TOOL, TASK_ARTIFACTS } from './common/engine-version.mjs';
export { fail, parseArgv, reportFatal } from './common/cli.mjs';
export { toPosix, fromPosix, relPosix, resolvePath, exists, readText, readJson, writeText, writeJson, canonicalize, sha256, sha256File, quoteArg } from './common/fsio.mjs';
export { runSync, isMainModule, spawnSyncPipeFree, runCommand, criteriaConcurrency } from './common/proc.mjs';
export { git, headCommit, filesAtCommit, filesAtCommitDetailed, findRepoRoot, repoRoot } from './common/git-base.mjs';
export { checkContractCommitted, sameLockContract } from './common/contract-git.mjs';
export { globToRegExp, matchesAny, patternsIntersect, walkFiles, listRepoFiles, ENGINE_DIR_PATTERNS, protectedManifest } from './common/glob.mjs';
export { parsePorcelainStatus, extrasAtRisk, stashSnapshot, worktreeSnapshot, finalizationLines, dirtyPaths, ownChanges, diffPaths, headDrift, readDiffText } from './common/git-status.mjs';
export { parseTaskMeta, attributionGap, metaAttributionGap, nodeConsistency, extractCriteriaBlock, parseCriteria, taskFiles, readTask } from './common/task-contract.mjs';
export { GATE_JOURNAL, gateJournalFile, gateAt, gateCriteriaOf, gateRecord, chainTip, verifyChain, appendGateRecord, formatGateRow, formatGateSummary, isManual } from './common/journal.mjs';
export { relockAllowed, contractSnapshot, hashProtectedFiles, computeLock, hasAcceptedRecord, hungMessage, acceptanceRepeatGuard, acceptanceNotes, verifyLock, lockOrderHint, assertInsideRepo, stableResults, computeWorktreeDigest } from './common/lock.mjs';
export { SECRET_PATTERNS, scanSecrets, truncate } from './common/secrets.mjs';
export { runCriteria, evaluateExpectation, formatMs } from './common/criteria.mjs';
export { DECISION_CLASSES, DECISION_IMPACTS, DECISION_EVIDENCE_KINDS, decisionsDigest, decisionEvidenceKind, summarizeDecisions, computeCoverage, userFacingDecisions, effectLinks, evaluateEffects } from './common/decisions.mjs';
export { RED_REASON_WINDOW, CHECK_DEFECT_NAMES, detectCheckDefect, matchRedReason, redReasonWindow, evaluateRedExpectation } from './common/red.mjs';
export { ACTOR_SOURCE_KINDS, normalizeActorConfig, loadConfig } from './common/config.mjs';
