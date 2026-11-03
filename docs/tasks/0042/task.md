# Задание 0042. Внешний движок обновляется в своём репозитории; доктор из панели не краснеет

<!-- TASK-META
{
  "id": "0042",
  "version": 1,
  "title": "внешний движок: обновление в его репозитории; doctor из панели говорит правду о контексте",
  "risk": "medium",
  "created": "2026-11-03",
  "owner": "архитектор",
  "executor": "subagent:executor",
  "acceptor": "subagent:judge",
  "issuedBy": {
    "kind": "agent",
    "session": "session-5c236846-8633-4428-b773-1f2ef0b814ed",
    "model": "deepseek-v4.1-flash"
  },
  "base": "HEAD",
  "criteria": "criteria.json",
  "allowedPaths": [
    "plugin/lib/deploy.js",
    "plugin/lib/api.js",
    "plugin/lib/client.js",
    "plugin/lib/checks.js",
    "plugin/test/**",
    "spec/scripts/doctor.mjs",
    "spec/SPEC.md",
    "docs/tasks/0042/**"
  ],
  "protectedPaths": [
    "spec/checks/external-engine.mjs",
    "spec/checks/panel-doctor.mjs",
    "docs/tasks/0042/task.md",
    "docs/tasks/0042/criteria.json"
  ],
  "redAllowDirty": [
    "docs/tasks/0042/**"
  ],
  "hashExclude": [],
  "decisions": [
    {
      "id": "D1",
      "class": "semantic",
      "impact": "user-visible",
      "question": "Как обновлять движок, который воркспейс читает по карте или конфигу",
      "chosen": "явный запрос target: engine-repo в POST /api/update обновляет репозиторий движка (engine.root) с confirm; воркспейс не меняется; выдуманное «доступно» больше не обещается",
      "options": [
        "обновлять репозиторий движка по явному запросу из панели",
        "оставить только отказ engine-external и ручное обновление вне панели"
      ],
      "reversible": true,
      "status": "confirmed",
      "evidence": { "kind": "criterion", "ref": "C1" }
    },
    {
      "id": "D2",
      "class": "semantic",
      "impact": "user-visible",
      "question": "Что делать doctor, когда панель запускает его без сессии агента",
      "chosen": "панель помечает контекст WF_CHECK_CONTEXT=panel; две проверки актора становятся WARN с прямой формулировкой, вне панели вердикт прежний",
      "options": [
        "маркер контекста и WARN в панели",
        "оставить FAIL: пользователь видит красное на здоровом воркспейсе"
      ],
      "reversible": true,
      "status": "confirmed",
      "evidence": { "kind": "criterion", "ref": "C3" }
    }
  ],
  "securityReview": false,
  "humanSignoff": false,
  "followUps": []
}
-->

## Цель

Панель не должна обещать действие, которое по правилам не выполняет, и не должна краснеть по
свойству, которого у неё структурно нет. Две правки в одном задании, потому что заказчик увидел
их одновременно на воркспейсе с внешним движком.

## Зачем

1. split-optimizer читает движок по карте; панель показывала «Доступно в этой сборке панели: vX» и
   отказывала в обновлении (409 engine-external) — обещание без действия. Обновлять надо репозиторий
   движка, и теперь это можно сделать из панели явно.
2. doctor, запущенный кнопкой, живёт в процессе DSH-хоста, где нет DSH_SESSION_ID, и всегда давал
   «2 строгих замечаний» на здоровом воркспейсе. Это дефект проверки, а не воркспейса.

## Что не входит

1. Запись в воркспейс с внешним движком остаётся запрещённой (409 engine-external) — граница 0034 не меняется.
2. Автообновление панели и скачивание из сети — по-прежнему нет.
3. Смысл проверок актора вне панели не меняется: без сессии доктор так же красен.
4. Версии пакета и панели двигаются релизом после приёмки.

## Инварианты

1. POST /api/update с телом {root, target: 'engine-repo', confirm: true} для воркспейса, чей движок
   внешний (source mapping|config), обновляет РЕПОЗИТОРИЙ ДВИЖКА до версии сборки панели и отвечает
   200 с полем engineRepo; VERSION воркспейса не появляется, его файлы не меняются.
2. Без confirm: true тот же запрос — 400; без target — прежнее поведение (409 engine-external для
   внешнего движка).
3. Для локального движка (source workspace) target: 'engine-repo' — 400 с кодом engine-not-external,
   VERSION не меняется: отдельного репозитория у него нет.
4. После обновления /api/status того же воркспейса отдаёт новую версию внешнего движка.
5. Панель для внешнего движка пишет «обновляется в репозитории движка» и называет путь; строка
   «Доступно в этой сборке панели» не показывается вовсе (её нет в тексте клиента).
6. Панель запускает проверки с WF_CHECK_CONTEXT=panel; doctor.mjs при этом маркере переводит
   «актор виден окружению» и «medium возможен в этой сессии» в WARN c формулировкой «проверка
   запущена из панели» и выходит 0, если других проблем нет. Вне панели (маркера нет) вердикт и код
   возврата прежние.
7. Не коммитить, не пушить, версии не двигать.

## Границы знания

1. Тебе дан этот файл, criteria.json, две проверки: spec/checks/external-engine.mjs (c1–c2) и
   spec/checks/panel-doctor.mjs (c1) — они защищены.
2. Менять можно только пути из allowedPaths.
3. Проверка задания: node spec/checks/external-engine.mjs c1|c2, node spec/checks/panel-doctor.mjs c1.
4. Регресс: node spec/checks/update-flow.mjs, node spec/selftest.mjs, node spec/checks/deployed-copy.mjs.

## Среда

- Node.js 20+, Windows, git в PATH; сеть не нужна.
- Проверки пишут только во временные каталоги; init в фикстуре создаёт ключ в её .wf-keys.

## Что сделать

1. **plugin/lib/api.js** — ветка target: 'engine-repo' в POST /api/update по инвариантам 1–3:
   подтверждение, разрешённый корень, отказ engine-not-external для локального движка, ответ с
   engineRepo, from, version; запись идёт в репозиторий движка через существующий механизм
   обновления (не дублировать его логику).
2. **plugin/lib/deploy.js** — если для этого нужен помощник (резолв репозитория движка, проверка
   source), добавь чистой функцией; поведение прямого обновления не меняй.
3. **plugin/lib/client.js** — текст состояния внешнего движка по инварианту 5 и кнопка «Обновить
   движок в репозитории движка» вместо обещания «доступно»: нажатие спрашивает подтверждение и шлёт
   {root, target: 'engine-repo', confirm: true}, затем перечитывает состояние.
4. **plugin/lib/checks.js** — WF_CHECK_CONTEXT: 'panel' в окружении дочерней проверки.
5. **spec/scripts/doctor.mjs** — ветка маркера по инварианту 6: severity WARN для двух проверок,
   строка-пояснение про контекст панели, итог и код возврата.
6. **plugin/test/** — тесты ветки engine-repo и текстов карточки; один тест обязан называться ровно
   «карточка external: обновление в репозитории движка» (его ищет проверка задания).

## Критерии приёмки

<!-- CRITERIA:BEGIN -->
| ID | Проверка | Ожидание |
| --- | --- | --- |
| C1 | node spec/checks/external-engine.mjs c1 | exit 0, в выводе EXTERNAL-ENGINE OK c1 |
| C2 | node spec/checks/external-engine.mjs c2 | exit 0, в выводе EXTERNAL-ENGINE OK c2 |
| C3 | node spec/checks/panel-doctor.mjs c1 | exit 0, в выводе PANEL-DOCTOR OK c1 |
| C4 | node spec/checks/update-flow.mjs | exit 0, в выводе UPDATE FLOW OK |
| C5 | node spec/selftest.mjs | exit 0, в выводе SELFTEST OK |
| C6 | node spec/checks/deployed-copy.mjs | exit 0, в выводе DEPLOYED COPY OK |
<!-- CRITERIA:END -->

## Отчёт

1. Что изменено, по файлам.
2. Полный вывод C1–C6.
3. git status --short, git diff --stat.
4. Что осталось незакрытым.

## Коммит

Не коммить. Кандидатный коммит создаёт task-accept; выпуск версии и теги — архитектор.
