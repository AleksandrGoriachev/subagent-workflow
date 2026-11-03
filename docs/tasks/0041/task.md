# Задание 0041. Сборка панели старше движка: понижение запрещено, панель объясняет

<!-- TASK-META
{
  "id": "0041",
  "version": 1,
  "title": "сборка панели старше движка: обновление отказывает вместо понижения, панель говорит прямо",
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
    "plugin/test/**",
    "spec/SPEC.md",
    "docs/tasks/0041/**"
  ],
  "protectedPaths": [
    "spec/checks/panel-older.mjs",
    "docs/tasks/0041/task.md",
    "docs/tasks/0041/criteria.json"
  ],
  "redAllowDirty": [
    "docs/tasks/0040/**"
  ],
  "hashExclude": [],
  "decisions": [
    {
      "id": "D1",
      "class": "semantic",
      "impact": "user-visible",
      "question": "Что делать, если сборка панели старше движка (targetVersion < deployed)",
      "chosen": "отказ с кодом panel-older и подсказкой обновить панель; движок не меняется — понижение запрещено",
      "options": [
        "отказать и сказать, что обновлять нужно панель",
        "разрешить понижение движка до сборки панели"
      ],
      "reversible": true,
      "status": "confirmed",
      "evidence": { "kind": "criterion", "ref": "C1" }
    },
    {
      "id": "D2",
      "class": "semantic",
      "impact": "internal",
      "question": "Как сравнивать версии движка",
      "chosen": "числовое сравнение по сегментам (export compareVersions): 2.6.10 новее 2.6.9; пустая строка даёт 0",
      "options": [
        "числовое сравнение по сегментам",
        "строковое сравнение (2.6.10 < 2.6.9)"
      ],
      "reversible": true,
      "status": "confirmed",
      "evidence": { "kind": "criterion", "ref": "C1" }
    }
  ],
  "securityReview": false,
  "humanSignoff": false,
  "followUps": []
}
-->

## Цель

Панель, собранная со старой спекой, не должна предлагать и тем более выполнять «обновление»
движка до версии ниже установленной. Вместо этого — честный отказ с объяснением: обновлять нужно
панель, а не понижать движок.

## Зачем

Заказчик показал панель 0.9.0 (вложенная спека 2.6.11) над движком 2.6.12: в шапке «доступна
v2.6.11», в разделе «Версия движка» — «Доступно в этой сборке панели: v2.6.11» и активная кнопка
«Обновить движок». Воспроизведено исполнением: POST /api/update на репозитории с VERSION 99.0.0
ответил 200 и понизил движок до версии сборки — prepareUpdate отказывает только при равенстве
версий. Понижение движка — потеря функций и предсказуемая поломка ворот; так быть не должно.

## Что не входит

1. Автообновление самой панели и скачивание tarball из сети — панель по-прежнему офлайн.
2. Изменение прямого обновления (target > deployed) и кодов up-to-date, tasks-in-progress.
3. Проверка подписи и приёмки — не трогается.
4. Версия пакета и панели двигаются релизом архитектора после приёмки.

## Инварианты

1. prepareUpdate сравнивает версии числом и при target < deployed возвращает
   {ok:false, code:'panel-older', version: deployed, targetVersion: target, hint} — до списка
   незавершённых заданий и до любых записей; VERSION и deploy.log не меняются.
2. POST /api/update отдаёт 409 с кодом panel-older и непустой подсказкой: обновите панель
   (tarball из latest release), понижение запрещено.
3. Равенство версий остаётся up-to-date (409), отсутствие confirm — 400; прямое обновление
   (target > deployed) работает как раньше.
4. export compareVersions(a, b) в plugin/lib/deploy.js: числовое сравнение по сегментам,
   -1 | 0 | 1; пустая/нечисловая строка не бросает исключение.
5. Панель при availableVersion < installedVersion: в шапке и в разделе движка говорит
   «сборка панели старше» и «понижение движка запрещено», кнопка обновления не предлагает
   понижение (неактивна с объяснением); слово «ошибка» не используется.
6. Не коммитить, не пушить, не ставить теги; версии пакета не двигать.

## Границы знания

1. Тебе дан этот файл, criteria.json, проверка spec/checks/panel-older.mjs и репозиторий пакета.
2. Менять можно только пути из allowedPaths.
3. Проверка задания: node spec/checks/panel-older.mjs c1|c2 (каждый печатает одну строку).
4. Регресс: node spec/checks/update-flow.mjs, node spec/selftest.mjs, node spec/checks/deployed-copy.mjs.

## Среда

- Node.js 20+, Windows, git в PATH; сеть не нужна.
- Проверки пишут только во временные каталоги.

## Что сделать

1. **plugin/lib/deploy.js** — export compareVersions(a, b) по инварианту 4; в prepareUpdate отказ
   panel-older до задач и записей (инвариант 1); ни up-to-date, ни обычное обновление не менять.
2. **plugin/lib/api.js** — код panel-older в статусы маршрута /api/update (409) и в тело ответа;
   подсказка доходит до клиента.
3. **plugin/lib/client.js** — состояние «сборка панели старше» по инварианту 5: в шапке вместо
   «доступна vX» — «сборка панели старше», в разделе движка — «понижение движка запрещено» с
   объяснением, кнопка обновления неактивна и не открывает подтверждение.
4. **plugin/test/** — тесты compareVersions, отказа panel-older на уровне маршрута и карточки;
   один тест обязан называться ровно «карточка panel-older: понижение не предлагается»
   (его ищет проверка задания). Прежние тесты обновления не ломать.

## Критерии приёмки

<!-- CRITERIA:BEGIN -->
| ID | Проверка | Ожидание |
| --- | --- | --- |
| C1 | node spec/checks/panel-older.mjs c1 | exit 0, в выводе PANEL-OLDER OK c1 |
| C2 | node spec/checks/panel-older.mjs c2 | exit 0, в выводе PANEL-OLDER OK c2 |
| C3 | node spec/checks/update-flow.mjs | exit 0, в выводе UPDATE FLOW OK |
| C4 | node spec/selftest.mjs | exit 0, в выводе SELFTEST OK |
| C5 | node spec/checks/deployed-copy.mjs | exit 0, в выводе DEPLOYED COPY OK |
<!-- CRITERIA:END -->

## Отчёт

1. Что изменено, по файлам.
2. Полный вывод C1–C5.
3. git status --short, git diff --stat.
4. Что осталось незакрытым.

## Коммит

Не коммить. Кандидатный коммит создаёт task-accept; выпуск версии и теги — архитектор.