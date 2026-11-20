# Репозиторий плагина «dsh-kanban-board»

## Назначение

DSH-плагин: канбан-доска распределения задач между воркспейсами, а не между сессиями одного воркспейса.
Обоснование и модель — «ANALYSIS-KANBAN-WORKSPACES.md» (слабые места сессий-как-узлов, двухфазные переходы,
доска у оркестратора, письма как транспорт, код — императив, модель — суждение).

«dsh-kanban-board» — это не оркестратор конкретных проектов и не доска реалма console/proxy/optimizer.
Эти три имени — пример применения для постановки; плагин делает механизм, а не вшивает реалм.
Реалм задаётся конфигурацией, которую владелец кладёт рядом с доской.

## Конкретика

- имя воркспейса/репозитория: dsh-kanban-board
- корень: C:/Users/Goryachev/Documents/deepseek-harness/dsh-kanban-board
- GitHub: https://github.com/AleksandrGoriachev/dsh-kanban-board
- тип: плагин DSH (host-половина + вкладка GUI), как VictorKozachek/dsh-kanban, но адресация — воркспейсы

## Структура репозитория (целевая)

dsh-kanban-board/
  package.json      # манифест плагина: dsh.profile.bundles / dsh.bundle.patch / dsh.client.platform
  README.md  LICENSE  .gitignore
  src/host/         # watcher папок обмена и доски, apply/sweep/journal/replay (логика мотора)
  src/ui/           # вкладка «Канбан» (клиентская половина)
  lib/board.js      # apply, допустимые переходы, журнал (императив, не модель)
  test/             # отрицательные кейсы: недопустимый переход, дубль письма, просроченный лиз, расхождение журнала
  docs/PROTOCOL.md  # формат карточки, переходы, маркеры писем, формат реалма-конфига
  examples/realm.example.json  # console/proxy/optimizer как ПРИМЕР конфигурации реалма
  tools/check-exchange.mjs     # опционально: копия координаторского инструмента

«docs/subagent-workflow/» — движок, который DSH развернул при создании воркспейса. Плагину он не нужен;
не коммитим его (.gitignore: docs/subagent-workflow/) либо удаляем каталог.

## Git (состояние и финал)

Воркспейс уже инициализирован (ветка master, коммит 2d3aca3 init); origin/main имеет Initial commit с LICENSE.
Связываем несвязанные истории:

  git branch -M main
  git commit -m "chore: gitignore .dsh/.tmp/docs-subagent-workflow; убрать локальную память из трека"
  git merge origin/main --allow-unrelated-histories --no-edit
  git push -u origin main

.gitignore (дополнение к существующему): .dsh/  .tmp/  board/.sweep.json  docs/subagent-workflow/

## Монтаж плагина в профиль DSH

1. В манифесте package.json заявить dsh.profile.bundles (host-половина) и dsh.client.platform (клиентская вкладка).
2. Установить бандл в профиль (~/.dsh/profiles/<профиль>/): добавить зависимость и запись в манифест, симлинк в node_modules.
3. Перезапустить DSH; вкладка «Канбан» появляется в правом сайдбаре.
4. Проверка: /workflow/api/status жив, вкладка регистрируется, доска читает папки обмена.

Точный формат манифеста сверять с референсом dsh-kanban (KANBAN.md, раздел установки).

## Конфигурация реалма (runtime, не в репозитории)

Плагин читает конфиг реалма, который владелец кладёт в свой воркспейс-архитектор: поля version, architect
(root, exchange), workspaces[] (id, root, exchange). console/proxy/optimizer — пример записей; плагин
оперирует списком из конфига и ничего про них не знает заранее.

## Чек-лист готовности

- git: origin/main синхронен, LICENSE на месте, .dsh/.wf-keys/движок не в треке
- package.json — валидный манифест плагина (бандлы, платформа)
- host-половина и вкладка регистрируются, DSH перезапущен
- отрицательные кейсы мотора (недопустимый переход, дубль письма, просроченный лиз) зелёные
- на примере реалма: наряд ушёл в воркспейс, квитанция вернулась, переход применён и записан в журнал
