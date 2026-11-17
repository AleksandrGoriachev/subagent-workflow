/**
 * 0.2: независимая проверка обмена — память прочтения по корню и точечная отметка.
 *
 * c1: точечная отметка снимает только названное письмо, повторная — already;
 * c2: память по корню: два каталога с одинаковым именем письма не делят отметку;
 * c3: журнал плагина читается по именам, watermark отсекает историю;
 * c4: пакетная отметка поднимает watermark, письмо новее снова видно;
 * c5: отсутствующее имя не попадает в память;
 * c6: CLI --mark <письмо> точечный, коды выхода 0/1.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { unreadLetters, markLetters, memoryFile, cli } from '../../tools/exchange-inbox.mjs';

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'wf-inbox-'));
}

function letter(target, name, options = {}) {
  const from = options.from || 'structure';
  const to = options.to || 'workflow';
  const text = ['From: ' + from, 'To: ' + to, 'Status: report', 'Subject: ' + name, '', 'text', ''].join('\n');
  const file = path.join(target, name);
  fs.writeFileSync(file, text);
  if (options.mtime) fs.utimesSync(file, options.mtime, options.mtime);
}

function options(memoryDir, legacyFile) {
  return { memoryDir, legacyFile };
}

function names(rows) {
  return rows.map((row) => row.name);
}

test('c1: точечная отметка снимает только названное письмо', () => {
  const dir = tempDir();
  const memoryDir = tempDir();
  const opts = options(memoryDir, path.join(memoryDir, 'none.json'));
  letter(dir, 'a.md');
  letter(dir, 'b.md');
  letter(dir, 'c.md');

  assert.deepEqual(names(unreadLetters(dir, opts)), ['a.md', 'b.md', 'c.md']);

  const result = markLetters(dir, ['b.md'], opts);
  assert.deepEqual(result.marked, ['b.md']);
  assert.deepEqual(result.missing, []);
  assert.deepEqual(names(unreadLetters(dir, opts)), ['a.md', 'c.md']);

  const saved = JSON.parse(fs.readFileSync(memoryFile(dir, memoryDir), 'utf8'));
  assert.equal(saved.version, 2);
  assert.ok(saved.letters['b.md'], 'отметка b.md не записана');
  assert.equal(saved.letters['a.md'], undefined, 'a.md отмечено без команды');

  assert.deepEqual(markLetters(dir, ['b.md'], opts).already, ['b.md']);
});

test('c2: память по корню — соседний каталог не затронут', () => {
  const first = tempDir();
  const second = tempDir();
  const memoryDir = tempDir();
  const opts = options(memoryDir, path.join(memoryDir, 'none.json'));
  letter(first, 'same.md');
  letter(second, 'same.md');

  markLetters(first, ['same.md'], opts);

  assert.equal(unreadLetters(first, opts).length, 0, 'отметка не подействовала в своём каталоге');
  assert.deepEqual(names(unreadLetters(second, opts)), ['same.md'], 'отметка протекла в чужой каталог');
  assert.notEqual(memoryFile(first, memoryDir), memoryFile(second, memoryDir), 'один файл памяти на два корня');
});

test('c3: журнал плагина читается по именам, watermark отсекает историю', () => {
  const dir = tempDir();
  const memoryDir = tempDir();
  const legacyFile = path.join(memoryDir, 'legacy.json');
  const base = Date.now() - 3_600_000;
  letter(dir, 'old.md', { mtime: new Date(base) });
  letter(dir, 'marked.md', { mtime: new Date(base + 60_000) });
  letter(dir, 'fresh.md', { mtime: new Date(base + 120_000) });
  fs.writeFileSync(legacyFile, JSON.stringify({ [path.join(dir, 'marked.md')]: base + 60_000 }));

  const rows = unreadLetters(dir, options(memoryDir, legacyFile));
  assert.deepEqual(names(rows), ['fresh.md'], 'watermark или отметка плагина не учтены');
});

test('c4: пакетная отметка поднимает watermark, новое письмо снова видно', () => {
  const dir = tempDir();
  const memoryDir = tempDir();
  const opts = options(memoryDir, path.join(memoryDir, 'none.json'));
  letter(dir, 'a.md');
  letter(dir, 'b.md');

  const all = names(unreadLetters(dir, opts));
  const result = markLetters(dir, all, { ...opts, advanceWatermark: true });
  assert.equal(result.marked.length, 2);
  assert.equal(unreadLetters(dir, opts).length, 0);

  const saved = JSON.parse(fs.readFileSync(memoryFile(dir, memoryDir), 'utf8'));
  assert.ok(saved.watermark > 0, 'watermark не поднят');

  letter(dir, 'new.md', { mtime: new Date(saved.watermark + 5000) });
  assert.deepEqual(names(unreadLetters(dir, opts)), ['new.md']);
});

test('c5: отсутствующее имя не попадает в память', () => {
  const dir = tempDir();
  const memoryDir = tempDir();
  const opts = options(memoryDir, path.join(memoryDir, 'none.json'));
  letter(dir, 'a.md');

  const result = markLetters(dir, ['nope.md'], opts);
  assert.deepEqual(result.missing, ['nope.md']);
  assert.deepEqual(result.marked, []);
  assert.equal(fs.existsSync(memoryFile(dir, memoryDir)), false, 'память создана без единой отметки');
  assert.deepEqual(names(unreadLetters(dir, opts)), ['a.md']);
});

test('c6: CLI --mark <письмо> точечный, коды выхода 0/1', () => {
  const dir = tempDir();
  const memoryDir = tempDir();
  const legacy = path.join(memoryDir, 'none.json');
  letter(dir, 'a.md');
  letter(dir, 'b.md');
  const base = ['--dir', dir, '--memory-dir', memoryDir, '--seen', legacy];
  const run = (args) => {
    const output = [];
    const code = cli([...base, ...args], { log: (line) => output.push(String(line)), error: (line) => output.push(String(line)) });
    return { code, out: output.join('\n') };
  };

  const partial = run(['--mark', 'b.md']);
  assert.equal(partial.code, 1, 'после точечной отметки осталось письмо — ожидался код 1: ' + partial.out);
  assert.match(partial.out, /отмечено: 1 \(b\.md\)/u);
  assert.match(partial.out, /осталось непрочитанных: 1/u);
  assert.match(partial.out, /a\.md/u);

  const full = run(['--mark', 'a.md']);
  assert.equal(full.code, 0, 'ящик пуст — ожидался код 0: ' + full.out);
  assert.match(full.out, /осталось непрочитанных: 0/u);

  const missing = run(['--mark', 'nope.md']);
  assert.equal(missing.code, 1);
  assert.match(missing.out, /не найдено в каталоге: nope\.md/u);
});
