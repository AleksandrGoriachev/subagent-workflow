/*
 * Якоря: статус и утверждение по слою.
 *
 * 0187: часть маршрутизатора plugin/lib/api/router.js; вход — router.js.
 */
import { loadConfig } from '../../state.js';
import { anchorsStatus, approveAnchors } from '../../anchors.js';
import { sendJson } from '../http.js';

export async function anchors(ctx) {
  const { runtime, selection, url, req, res, rel } = ctx;
  const anchorsLayer = url.searchParams.get('layer') === 'project' ? 'project' : 'contour';
  sendJson(res, 200, anchorsStatus(selection.root, loadConfig(selection.root), anchorsLayer));
  return;
}

export async function approve(ctx) {
  const { runtime, selection, url, req, res, rel } = ctx;
  const anchorsLayer = url.searchParams.get('layer') === 'project' ? 'project' : 'contour';
  try {
    sendJson(res, 200, approveAnchors(selection.root, loadConfig(selection.root), anchorsLayer));
  } catch (error) {
    sendJson(res, 200, { ok: false, problems: [error && error.message ? error.message : String(error)] });
  }
  return;
}

