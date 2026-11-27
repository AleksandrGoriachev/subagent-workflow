/*
 * Ответы состояния: guard и сведения о репозитории для панели.
 *
 * 0180: часть plugin/lib/api.js; публичный вход — plugin/lib/api.js.
 */
import { policyView } from '../state.js';
import { compatView, PLUGIN_VERSION } from '../compat.js';
import { availableVersion, tasksInProgress } from '../deploy.js';
export function guardPayload(runtime) {
  try {
    return runtime && typeof runtime.guard === 'function' ? runtime.guard() : null;
  } catch (error) {
    return { error: error && typeof error.message === 'string' ? error.message : String(error) };
  }
}

export function repoInfoPayload(info) {
  const policy = policyView(info.config, { root: info.root, configPath: info.configPath });
  return {
    root: info.root,
    /* 0.8.0: обновление движка — версия сборки и задания без приёмки. */
    availableVersion: availableVersion(),
    tasksInProgress: tasksInProgress(info.root),
    tasksDir: info.tasksDir,
    configPath: info.configPath,
    configLoaded: info.configLoaded,
    packageVersion: info.packageVersion,
    specVersion: info.specVersion,
    versionSource: info.versionSource,
    head: info.head,
    workflow: info.workflow,
    policy,
    compat: compatView({
      pluginVersion: PLUGIN_VERSION,
      packageVersion: info.packageVersion,
      specVersion: info.specVersion,
      versionSource: info.versionSource,
      workflow: info.workflow,
      config: info.config,
      tasks: [],
    }),
  };
}

/**
 * Create the request handler. \`runtime\` is the object returned by
 * {@link createWorkflowRuntime}; tests pass the same object.
 */
