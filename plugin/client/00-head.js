/**
 * dsh-workflow-console client half (classic browser module).
 *
 * Registered through the DSH module loader as a conversation view: a board of
 * workflow tasks, a task card and the policy page. Read-mostly: POST routes are
 * the read-only gates of /api/run, the guard flag (/api/guard) and one explicit
 * deployment of the engine into the open workspace (/api/deploy, only with
 * confirm: true) — the panel's two writes, both behind a confirmation.
 *
 * Kept as plain classic JS on purpose — DSH serves lib/client.js directly and
 * third-party plugin clients have no bundler (same approach as dsh-llm-memory).
 */
window.__ModuleLoader__.load({
  id: "dsh-workflow-console",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
    const React = require("react");
    const h = React.createElement;

