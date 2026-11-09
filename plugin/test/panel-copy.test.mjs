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
  assert.match(client, /Якоря — общие правила контура/u);
  assert.match(client, /docs\/anchors\.json/u);
});

test('c2: у действия есть последствие, а не только название', () => {
  assert.match(client, /ставит вашу человеческую подпись под его текущей редакцией/u);
  assert.match(client, /Без подписи проверки считают набор неутверждённым/u);
});

test('c3: кнопка несёт title с последствием', () => {
  assert.match(client, /Подписывает текущий список правил человеческим ключом/u);
});

test('c4: approved mockup keeps the list visible and bounded', () => {
  assert.match(client, /anchorList: \{ maxHeight: "320px", overflowY: "auto"/u);
  assert.match(client, /Проверяется автоматически/u);
  assert.match(client, /Якоря утверждены: ключ/u);
  assert.match(client, /Обновить данные/u);
  assert.match(client, /Сейчас/u);
});
