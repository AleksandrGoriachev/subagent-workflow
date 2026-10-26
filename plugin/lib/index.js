/**
 * dsh-workflow-console host half.
 *
 * Read-only: registers the \`/workflow\` prefix route when the web server is
 * available. There is no settings service, no command, no tool and no write
 * path — the panel is a view over the repository.
 */
import { createWorkflowRuntime, registerWorkflowWeb } from './api.js';

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

export function apply(ctx, config = {}) {
  const runtime = createWorkflowRuntime(config, {
    getWorkspaceRegistry: () => resolveWorkspaceRegistry(ctx),
  });
  ctx.inject(['webServer'], (webCtx) => registerWorkflowWeb(webCtx, runtime));
}
