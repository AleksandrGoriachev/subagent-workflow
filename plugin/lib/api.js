/**
 * HTTP half: loopback-only routes for the panel.
 *
 * The handler is a pure wiring function (mock request/response objects work in
 * tests) so the routes can be exercised without a DSH host. Read routes are GET
 * and go through state.js. POST routes are the three explicit exceptions:
 * /api/run runs one of the package's read-only gates and returns its log (never
 * writes, signs or accepts); /api/guard flips guard.enabled in
 * workflow.config.json (logged to guard.log); /api/deploy runs the bundled
 * spec's init.mjs in the selected root — the panel's second explicit write, and
 * it happens only with confirm: true; /api/update (0.8.0) re-runs init --force
 * to move a deployed copy to the bundled version, blocked by tasks without an
 * acceptance record unless allowInProgress is set.
 *
 * 2.6.3 (B4): the writing POST routes (/api/guard, /api/deploy, /api/update)
 * require
 * `Content-Type: application/json` (415 otherwise) and an Origin of this host or
 * no Origin at all (403 otherwise). The checks run before the body is read and
 * before anything is written: a cross-site `text/plain` request — a browser
 * "simple request" with no preflight — cannot flip the guard or start a deploy.
 *
 * 2.6.9 (0034): a workspace without an engine (split-optimizer) may read one
 * from outside by mapping in ~/.dsh/workflow/engine-roots.json (env
 * WF_ENGINE_ROOTS). GET routes then read the mapped repository and /api/status
 * reports engine {installed, root, source}. The three writing POST routes answer
 * 409 engine-external for source 'mapping' — before the body is read when the
 * panel has a single root, and right after it otherwise — so such a workspace is
 * never modified.
 */
import { API_PREFIX } from './api/constants.js';
import { createWebHandler, warn } from './api/router.js';

export { API_PREFIX, PLUGIN_NAME, DEFAULT_UPDATE_SOURCE } from './api/constants.js';
export { createWorkflowRuntime } from './api/roots.js';
export { createWebHandler } from './api/router.js';

export function registerWorkflowWeb(ctx, runtime) {
  const handler = createWebHandler(runtime);
  const route = { kind: 'prefix', path: API_PREFIX, handler };
  try {
    ctx.effect(() => ctx.webServer.register(route));
  } catch (error) {
    warn(ctx, 'Web routes at "' + API_PREFIX + '" were not registered: ' + (error && error.message ? error.message : String(error)));
  }
}

