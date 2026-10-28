# NOTE: задание 0017 аннулировано (I-3)

Дата: 2026-10-29.

Причина: **дефект границ контракта, найденный исполнителем до приёмки.** В `allowedPaths` не было
`spec/scripts/lib/common.mjs` (там меняется `TOOL` на 2.6.3), а в `covers` — `.github/workflows/ci.yml`
(пункт 9 требует добавить шаги CI). `task-verify` дал бы «файл вне allowedPaths» и «изменённый файл не
покрыт ни одним критерием».

Работа исполнителя сохранена патчем `C:\Users\Goryachev\Documents\deepseek-harness\default-workspace\.tmp\0017-fix.patch`
и передана в `docs/tasks/0018` с исправленными границами. Красный 0017 остаётся историей.
