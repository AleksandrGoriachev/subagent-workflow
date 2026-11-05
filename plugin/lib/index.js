/**
 * dsh-workflow-console host half.
 *
 * Read-only: registers the \`/workflow\` prefix route when the web server is
 * available. There is no settings service, no command, no tool and no write
 * path — the panel is a view over the repository.
 */
import os from 'node:os';
import path from 'node:path';
import * as fsSync from 'node:fs';
import { createWorkflowRuntime, registerWorkflowWeb } from './api.js';
import { registerWaitGuard } from './wait-guard.js';

export const name = 'dsh-workflow-console';

/** Resolve \`ctx.workspaceRegistry\` without requiring it to be injected. */
function resolveWorkspaceRegistry(ctx) {
  const candidates = [
    () => ctx.workspaceRegistry,
    () => (ctx.get ? ctx.get('workspaceRegistry') : undefined),
    () => (ctx.reflect && ctx.reflect.get ? ctx.reflect.get('workspaceRegistry', false) : undefined),
  ];
  for (const read of candidates) {
    try {
      const registry = read();
      if (registry && typeof registry.list === 'function') return registry;
    } catch {
      /* try the next resolution path */
    }
  }
  return null;
}

function probeApply(ctx, config, extra) {
  try {
    const dir = path.join(os.homedir(), '.dsh', 'workflow');
    fsSync.mkdirSync(dir, { recursive: true });
    fsSync.writeFileSync(path.join(dir, 'plugin-apply.json'), JSON.stringify({
      at: new Date().toISOString(),
      hasCtxTools: Boolean(ctx && ctx.tools),
      typeofCtxTools: typeof (ctx && ctx.tools),
      guardType: typeof (ctx && ctx.tools && ctx.tools.guard),
      getTools: Boolean(ctx && typeof ctx.get === 'function' && ctx.get('tools')),
      injectType: typeof (ctx && ctx.inject),
      onType: typeof (ctx && ctx.on),
      configKeys: config && typeof config === 'object' ? Object.keys(config) : null,
      ...(extra || {}),
    }, null, 2) + String.fromCharCode(10), 'utf8');
  } catch { /* диагностика не имеет права ломать плагин */ }
}

export function apply(ctx, config = {}) {
  /*
   * 2.6.32 (0073, WC-55): сторож долгих ожиданий — часть плагина, а не память
   * агента. Политика берётся из конфига (waitPolicy/waitBudgetMs/jobScript)
   * или из блока enforcement воркспейса; ошибка сторожа не отменяет панель.
   */
  let guardState = null;
  try {
    guardState = registerWaitGuard(ctx, config);
  } catch (error) {
    guardState = { error: String(error && error.message ? error.message : error) };
  }
  probeApply(ctx, config, { guardState });
  const runtime = createWorkflowRuntime(config, {
    getWorkspaceRegistry: () => resolveWorkspaceRegistry(ctx),
  });
  ctx.inject(['webServer'], (webCtx) => registerWorkflowWeb(webCtx, runtime));
}
