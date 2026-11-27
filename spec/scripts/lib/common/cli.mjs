/*
 * CLI-примитивы: fail, parseArgv, reportFatal.
 *
 * 0181: часть spec/scripts/lib/common.mjs; публичный вход — common.mjs.
 */
export function fail(message, exitCode = 1) {
  const err = new Error(message);
  err.exitCode = exitCode;
  throw err;
}

export function parseArgv(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--') { out._.push(...argv.slice(i + 1)); break; }
    if (a.startsWith('--')) {
      const eq = a.indexOf('=');
      if (eq !== -1) out[a.slice(2, eq)] = a.slice(eq + 1);
      else {
        const next = argv[i + 1];
        if (next !== undefined && !next.startsWith('--')) { out[a.slice(2)] = next; i += 1; }
        else out[a.slice(2)] = true;
      }
    } else out._.push(a);
  }
  return out;
}


export function reportFatal(gate, message, options = {}) {
  const NL = String.fromCharCode(10);
  const prefix = String(gate) + ': ';
  const text = message === undefined || message === null ? '' : String(message);
  if (options.stderr !== false) console.error(prefix + text);
  const lines = text.split(NL).map((line) => line.trim()).filter((line) => line !== '');
  if (options.json === true) {
    console.log(JSON.stringify({ ok: false, errors: lines.length > 0 ? lines : [text] }, null, 2));
    return;
  }
  if (lines.length > 0) console.log(prefix + lines[0]);
}

