# Задание 0038. Кнопки внешнего движка видимо недоступны и объясняют причину

<!-- TASK-META
{
  "id": "0038",
  "version": 1,
  "title": "Внешний движок: disabled-кнопки выглядят и объясняются как недоступные",
  "risk": "medium",
  "created": "2026-11-02",
  "owner": "архитектор",
  "executor": "subagent:executor",
  "acceptor": "subagent:judge",
  "issuedBy": { "kind": "agent", "session": "session-b8721a2a-456c-48a2-94cd-8030d895a8e8", "model": "unknown" },
  "base": "HEAD",
  "criteria": "criteria.json",
  "allowedPaths": [
    "plugin/lib/client.js",
    "docs/tasks/0038/**"
  ],
  "protectedPaths": [
    "plugin/test/client.test.mjs"
  ],
  "redAllowDirty": [
    "docs/tasks/0038/**"
  ],
  "hashExclude": [
    "artifacts/**"
  ],
  "decisions": [],
  "securityReview": false,
  "humanSignoff": false,
  "followUps": []
}
-->

## Цель

На воркспейсе с внешним движком (`engine.source === "mapping"`) кнопка «Обновить движок»
действительно отключена, но выглядит активной: `opacity: 0.55`, курсор `default`, причина только
в tooltip. Заказчик нажимает и не понимает, что произошло. Нужно, чтобы недоступность была видна
и объяснена на месте: заметный disabled-стиль (`opacity: 0.45`, `cursor: not-allowed`),
`aria-disabled="true"` и явная подпись «недоступно: движок внешний» рядом с кнопкой.

## Что не входит

1. Серверная логика (`409 engine-external`) не меняется.
2. Поведение кнопок на обычном (не внешнем) движке не меняется.
3. Тексты подсказки `externalEngineHint` не меняются.

## Инварианты

1. На внешнем движке кнопка обновления остаётся `disabled` и получает `aria-disabled="true"`.
2. Видимый стиль отличается от обычной кнопки: `opacity: 0.45`, `cursor: not-allowed`.
3. Рядом с кнопкой есть видимый текст «недоступно: движок внешний».
4. На обычном движке кнопка не получает ни `aria-disabled`, ни подписи «недоступно».

## Границы знания

1. Менять можно: `plugin/lib/client.js`, файлы задания.
2. `plugin/test/client.test.mjs` защищён: не править.
3. Не коммить, не пушить, не деплоить.

## Среда

- `node plugin/tools/test.mjs` — все тесты панели (включая новый)
- `node spec/checks/engine-root.mjs` — регресс: 409 и резолв карты

<!-- CRITERIA:BEGIN -->
## Критерии приёмки

| ID | Проверка | Ожидание |
| --- | --- | --- |
| C1 | `node plugin/tools/test.mjs` | exit 0, в stdout `plugin test:` и нет падений |
| C2 | `node spec/checks/engine-root.mjs` | exit 0, в stdout `ENGINE ROOT OK` |
| C3 | статическая проверка `plugin/lib/client.js` | есть `aria-disabled`, `not-allowed`, `opacity: 0.45`, `недоступно: движок внешний` |
<!-- CRITERIA:END -->

## Отчёт

1. Что изменено в `client.js` — построчно.
2. Полные пути файлов.
3. Дословный вывод C1 и C2.
4. `git status --short`.

## Коммит

Только после записи о приёмке. Коммит делает архитектор по принятому кандидатному SHA.
