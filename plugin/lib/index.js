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

/**
 * 0077 (WC-60): чтение ctx.tools может БРОСАТЬ ("cannot get property \"tools\"
 * without inject"), и в 0.9.14 это обрывало сам probeApply до writeFileSync —
 * файл не появлялся, хотя apply() продолжался. Поэтому сервис читается здесь,
 * в try/catch, а не в объектном литерале.
 */
function toolsProbe(ctx) {
  try {
    const service = ctx ? ctx.tools : undefined;
    return {
      hasCtxTools: Boolean(service),
      typeofCtxTools: typeof service,
      guardType: typeof (service && service.guard),
      toolsError: null,
    };
  } catch (error) {
    return {
      hasCtxTools: false,
      typeofCtxTools: 'unavailable',
      guardType: 'unavailable',
      toolsError: error && typeof error.message === 'string' ? error.message : String(error),
    };
  }
}

function probeApply(ctx, config, extra) {
  try {
    const dir = path.join(os.homedir(), '.dsh', 'workflow');
    fsSync.mkdirSync(dir, { recursive: true });
    fsSync.writeFileSync(path.join(dir, 'plugin-apply.json'), JSON.stringify({
      at: new Date().toISOString(),
      ...toolsProbe(ctx),
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
    /* 0077 (WC-60): живое состояние сторожа в /workflow/api/status, а не в файле. */
    guard: () => guardState,
  });
  ctx.inject(['webServer'], (webCtx) => registerWorkflowWeb(webCtx, runtime));
}
