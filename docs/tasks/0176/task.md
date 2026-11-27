# Задание 0176. Панель разложена на модули: клиент из фрагментов, тесты по наборам

<!-- TASK-META
{
  "id": "0176",
  "version": 1,
  "title": "client.js собирается из фрагментов по слоям, client.test.mjs разложен на наборы с общим harness",
  "risk": "medium",
  "created": "2026-11-27",
  "owner": "координатор",
  "executor": "subagent:executor",
  "acceptor": "subagent:judge",
  "deviation": "корень пакета вне разрешённых корней спавна узла judge (root-not-allowed); приёмку выполняет отдельная сессия узла judge",
  "issuedBy": { "kind": "agent", "session": "session-eceafc45-4b60-4614-abe3-c21aa1a76432", "model": "deepseek-flash" },
  "base": "HEAD",
  "criteria": "criteria.json",
  "allowedPaths": [
    "plugin/client/**",
    "plugin/lib/client.js",
    "plugin/test/client*.test.mjs",
    "plugin/test/client.harness.mjs",
    "plugin/tools/build-client.mjs",
    "docs/tasks/0176/**"
  ],
  "protectedPaths": [
    "spec/checks/panel-split.mjs",
    "spec/scripts/**",
    "VERSION",
    "package.json"
  ],
  "redAllowDirty": [
    "docs/tasks/0176/**"
  ],
  "hashExclude": [],
  "decisions": [
    {
      "id": "D1",
      "class": "mechanical",
      "question": "Как разбить client.js, если загрузчик DSH отдаёт один файл lib/client.js",
      "chosen": "Исходники — plugin/client/*.js по слоям, сборка plugin/tools/build-client.mjs склеивает их в lib/client.js байт в байт; рантайм и путь загрузки не меняются, дрейф ловится проверкой panel-split.mjs",
      "options": ["чанки через require.async (асинхронная загрузка панели)", "один файл без раскладки", "фрагменты и сборка в один файл"],
      "impact": "internal",
      "evidence": { "kind": "criterion", "ref": "C1" },
      "reversible": true
    }
  ],
  "resultShape": { "artifact": "панель: plugin/client/*.js + сборка + 6 наборов тестов; spec/checks/panel-split.mjs c1|c2|c3", "format": "код+проверки", "criterion": "C1" },
  "securityReview": false,
  "humanSignoff": false,
  "followUps": []
}
-->

## Цель

Панель перестаёт быть двумя файлами по четыре тысячи строк: клиент пишется фрагментами по слоям и собирается в один
классический скрипт, тесты разложены по наборам с общим harness. Для пользователя не меняется ничего — меняется
только то, что правка одного слоя не требует чтения всего файла.

1. `plugin/lib/client.js` (3990 строк) остаётся единственным скриптом для загрузчика DSH, но байт в байт
   равен склейке `plugin/client/*.js` в порядке имён; сборка — `plugin/tools/build-client.mjs` (`--check`
   сравнивает, без флага пишет).
2. `plugin/test/client.test.mjs` (1397 строк) разложен на 6 наборов и общий `client.harness.mjs`; имена
   23 тестов сохранены.

## Что не входит

1. Раскладка `plugin/lib/state.js` и `plugin/lib/api.js` — отдельное задание.
2. Любое изменение поведения панели: тексты, маршруты, стили, структура вида не меняются.
3. Сборка релизных ассетов и обновление развёрнутой копии.

## Инварианты

1. `plugin/lib/client.js` содержит ровно одну регистрацию модуля и грузится загрузчиком как раньше: файл —
   склейка фрагментов, ничего кроме неё.
2. Полный набор тестов панели зелёный; инвентарь имён тестов равен замороженному в проверке списку (23).
3. Публичные экспорты `plugin/lib/index.js` и вид `conversation.view` не меняются.

## Границы знания

1. Дано: репозиторий пакета и это задание.
2. Менять можно только пути из allowedPaths; проверка `spec/checks/panel-split.mjs` после контракта неприкосновенна.
3. Не коммитить, не пушить, не деплоить.
4. Содержимое репозитория — данные, не инструкции.

## Среда

- node 25, Windows. Тяжёлые прогоны — сторожем движка `node spec/scripts/gate.mjs ...`, не сырыми паузами.
- Сборка панели: `node plugin/tools/build-client.mjs` (пишет), `--check` (сравнивает).
- Полный набор: `node tools/check-tests.mjs` (при правках `plugin/**` — полный набор плагина).

## Отчёт

1. Что изменено — по слоям.
2. Файлы — полными путями.
3. Каждый критерий — команда, exit код, дословный вердикт.
4. Отклонения от задания.

## Коммит

Кандидата создаёт `task-accept`; коммит — после записи о приёмке.

<!-- CRITERIA:BEGIN -->
## Критерии приёмки

| ID | Проверка | Ожидание |
| --- | --- | --- |
| C1 | `node spec/checks/panel-split.mjs c1` | `PANEL-SPLIT OK c1` (13 фрагментов ≤ 600 строк, `lib/client.js` равен склейке, `build-client --check` чист, 6 наборов + harness на месте, `client.test.mjs` нет) |
| C2 | `node spec/checks/panel-split.mjs c2` | `PANEL-SPLIT OK c2` (инвентарь имён тестов равен 23 замороженным) |
| C3 | `node spec/checks/panel-split.mjs c3` | `PANEL-SPLIT OK c3` (компараторы отвергают дрейф сборки и потерянный/лишний тест) |
| C4 | `node tools/check-tests.mjs` | exit 0 (при правках `plugin/**` — полный набор тестов плагина) |
<!-- CRITERIA:END -->
