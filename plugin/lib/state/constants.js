/*
 * Константы состояния: уровни политики, классы решений, стадии, умолчания конфига.
 *
 * 0179: часть state.js; публичный вход — plugin/lib/state.js (баррель).
 */
import { PLUGIN_VERSION } from '../compat.js';
export const TOOL = 'dsh-workflow-console/' + PLUGIN_VERSION;
export const POLICY_LEVELS = ['off', 'warn', 'fail'];
export const DECISION_CLASSES = ['mechanical', 'semantic', 'contract'];
export const DECISION_IMPACTS = ['internal', 'user-visible', 'public-contract'];
export const DECISION_EVIDENCE_KINDS = ['criterion', 'spec', 'customer', 'human'];
export const REMARK_CLASSES = ['blocking', 'non-blocking', 'follow-up'];

export const STAGES = [
  { code: 'incomplete', label: 'неполный' },
  { code: 'contract', label: 'контракт' },
  { code: 'attack', label: 'атака' },
  { code: 'lock', label: 'замок' },
  { code: 'red', label: 'красный' },
  { code: 'green', label: 'зелёный' },
  { code: 'accepted', label: 'принято' },
  { code: 'remarks', label: 'замечания' },
];

export const STAGE_LABELS = Object.fromEntries(STAGES.map((item) => [item.code, item.label]));
export const STAGE_ORDER = STAGES.map((item) => item.code);

export const DEFAULT_CONFIG = {
  version: 1,
  tasksDir: 'docs/tasks',
  keysFile: 'docs/subagent-workflow/acceptors.json',
  logs: 'local',
  actor: { primaryEnv: 'DSH_SESSION_ID', fallbackEnv: 'TASK_ACTOR_SESSION', modelEnv: 'DSH_MODEL' },
  policy: { decisions: 'fail', coverage: 'fail', attack: 'off', roles: { modelFamily: 'warn' } },
  models: {},
  roles: {},
  verifyTimeoutMs: 1800000,
};

