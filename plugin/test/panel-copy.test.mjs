/**
 * 0113: элемент панели обязан объяснять себя.
 *
 * Проверяется текст карточки якорей в исходнике клиента: объяснение простыми
 * словами, последствие нажатия и title у кнопки. Тест ловит удаление подсказки —
 * иначе кнопка «Утвердить якоря» снова станет непонятной.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const client = fs.readFileSync(path.join(import.meta.dirname, '..', 'lib', 'client.js'), 'utf8');

test('c1: карточка якорей объясняет, что это такое', () => {
  assert.match(client, /Семантические якоря/u);
  assert.match(client, /Якоря — короткий список правил/u);
  assert.match(client, /docs\/anchors\.json/u);
});

test('c2: у действия есть последствие, а не только название', () => {
  assert.match(client, /подпись фиксирует, что вы эти правила прочитали и приняли/u);
  assert.match(client, /Пока подписи нет, проверки считают правила неутверждёнными/u);
});

test('c3: кнопка несёт title с последствием', () => {
  assert.match(client, /Подписать утверждение человеческим ключом/u);
});
