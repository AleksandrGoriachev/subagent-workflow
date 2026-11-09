/**
 * 0130: привести контурные якоря к общему словарю области и переоформить утверждение.
 *
 * Что делает:
 *  1. docs/anchors.json: sides "workflow" -> "contour" (движок — контурная сторона);
 *     layer контурных якорей остаётся contour, enforcedBy не трогаем.
 *  2. Печатает, что изменилось, и НЕ подписывает: подпись ставит владелец кнопкой.
 *  3. Пишет backup anchors.json рядом (.bak-<время>).
 *
 * Запуск: node tools/migrate-anchors-sides.mjs --repo <корень движка> [--dry-run]
 */
import fs from 'node:fs';
import path from 'node:path';

const argv = process.argv.slice(2);
const value = (flag) => { const index = argv.indexOf(flag); return index >= 0 ? argv[index + 1] : undefined; };
const repo = path.resolve(value('--repo') || process.cwd());
const dry = argv.includes('--dry-run');
const file = path.join(repo, 'docs', 'anchors.json');

const text = fs.readFileSync(file, 'utf8');
const data = JSON.parse(text);
let changed = 0;
for (const anchor of Array.isArray(data.anchors) ? data.anchors : []) {
  if (anchor && anchor.sides === 'workflow') { anchor.sides = 'contour'; changed += 1; }
  if (anchor && anchor.scope === 'workflow') { anchor.scope = 'contour'; changed += 1; }
}
console.log('файл:', file);
console.log('полей изменено:', changed);
if (changed === 0) { console.log('нечего менять'); process.exit(0); }
if (dry) { console.log('--dry-run: запись не выполнена'); process.exit(0); }
const backup = file + '.bak-' + Date.now();
fs.copyFileSync(file, backup);
fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n');
console.log('backup:', backup);
console.log('записано. Дальше: подпись владельца кнопкой в панели (approval перезапишется в форме 0.3).');
