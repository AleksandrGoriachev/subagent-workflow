# NOTE: задание 0024 аннулировано (I-3)

Дата: 2026-10-29.

Причина: **дефект границ, найденный `task-verify`:** `tools/pack-plugin.mjs` изменён (пункт 5 контракта — проверка
LICENSE в tarball), но не входил в `allowedPaths`. Плюс в `allowedPaths` остался лишний `docs/tasks/0022/**`
от предыдущей ревизии контракта.

Работа исполнителя сохранена патчем `C:\Users\Goryachev\Documents\deepseek-harness\default-workspace\.tmp\0024-fix.patch`
и передана в `docs/tasks/0025` с исправленными границами.
