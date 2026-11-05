/**
 * 0082 (WC-44): откуда взялась спека и не грязное ли это дерево.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { sourceProvenance, provenanceWarning, DEV_SPEC, VENDOR_SPEC } from '../lib/deploy.js';

test('рабочее дерево — dev, грязный источник даёт предупреждение', () => {
  const dev = sourceProvenance(DEV_SPEC);
  assert.equal(dev.kind, 'dev');
  const dirty = provenanceWarning({ kind: 'dev', dirty: true, describe: 'v2.6.36-3-g7c9512f-dirty' });
  assert.match(dirty, /грязное рабочее дерево/u);
  assert.match(dirty, /-dirty/u);
  const clean = provenanceWarning({ kind: 'dev', dirty: false, describe: 'v2.6.36' });
  assert.match(clean, /рабочее дерево/u);
  assert.doesNotMatch(clean, /грязное/u);
});

test('vendor и чужой каталог предупреждений не дают', () => {
  assert.equal(sourceProvenance(VENDOR_SPEC).kind, 'vendor');
  assert.equal(provenanceWarning({ kind: 'vendor' }), null);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-prov-'));
  try {
    assert.equal(sourceProvenance(tmp).kind, 'other');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
