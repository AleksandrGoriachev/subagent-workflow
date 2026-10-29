# Задание 0020. Проверки не хардкодят версии; фикстуры узости F-7 и covers

<!-- TASK-META
{
  "id": "0020",
  "version": 1,
  "title": "проверки не хардкодят версии; фикстуры узости F-7 и covers",
  "risk": "medium",
  "created": "2026-10-29",
  "owner": "архитектор",
  "executor": "subagent:executor",
  "acceptor": "subagent:judge",
  "issuedBy": {
    "kind": "agent",
    "session": "session-b8721a2a-456c-48a2-94cd-8030d895a8e8",
    "model": "deepseek-v4.1-flash"
  },
  "base": "HEAD",
  "criteria": "criteria.json",
  "allowedPaths": [
    "spec/checks/acceptance-schema.mjs",
    "spec/checks/deploy-safety.mjs",
    "spec/checks/panel-deploy.mjs",
    "spec/checks/gate-rules.mjs",
    "spec/scripts/lib/common.mjs",
    "spec/SPEC.md",
    "CHANGELOG.md",
    "docs/tasks/0020/**"
  ],
  "protectedPaths": [
    "spec/checks/version-drift.mjs",
    "docs/tasks/0020/task.md",
    "docs/tasks/0020/criteria.json"
  ],
  "redAllowDirty": [
    "docs/tasks/0020/**"
  ],
  "hashExclude": [],
  "decisions": [
    {
      "id": "D1",
      "class": "mechanical",
      "impact": "internal",
      "question": "Где проверяются версии",
      "chosen": "только tools/check-version.mjs; spec/checks/* читают VERSION и plugin/package.json динамически и не содержат литералов",
      "options": [
        "хардкод в каждой проверке",
        "единая точка + чтение файлов"
      ],
      "reversible": true
    }
  ],
  "securityReview": false,
  "humanSignoff": false,
  "followUps": []
}
-->

## Цель

Убрать из проверок литералы версий — иначе каждая проверка краснеет после следующего релиза (так вышло с `deploy-safety`: она ждала 2.6.3 и упала на 2.6.4 сразу после приёмки 0019, до тега). Плюс закрепить фикстурами узость исключения F-7 и `WARN` по `covers`, и внести `verify.executor.json` в артефакты задания.

## Зачем

1. **Регресс от 0019.** `spec/checks/deploy-safety.mjs` содержит `'2.6.3'` и `'0.7.1'`; `panel-deploy.mjs` и `acceptance-schema.mjs` — `'0.7.1'`. После выпуска 2.6.4 `deploy-safety` падает с `FAIL спека 2.6.3 — сейчас 2.6.4`, CI красный. Версии — дело `tools/check-version.mjs`.
2. **Приёмщик 0019 (замечание 1).** `gate-rules.mjs` не фиксирует узость исключения F-7 (свои `task.md`/`criteria.json` vs шаблон `docs/tasks/0001/*.md`) и `WARN` по `covers`; это доказано только ручными пробами, регрессию не поймает.
3. **Приёмщик 0019 (замечание 3).** `verify.executor.json` не входит в `TASK_ARTIFACTS` (`spec/scripts/lib/common.mjs`), поэтому в задании без `docs/tasks/<id>/**` в `allowedPaths` он станет обычным untracked-файлом.

## Что не входит

1. Сверка `acceptance.json` с заданием и подписью — отдельное задание.
2. `patternsIntersect` (эвристика двух wildcard-сегментов) — не меняем.
3. Версия спеки остаётся **2.6.4** (релиз ещё не выпущен); `check-version` не меняется.
4. Правки панели и её проверок поведения — отдельное задание.

## Инварианты

1. **Ни одного литерала текущей версии** в `spec/checks/*.mjs` (комментарии не считаются): версии читаются из `VERSION` и `plugin/package.json`.
2. **Версии по-прежнему проверяются** — `tools/check-version.mjs` остаётся единственной точкой и продолжает зелёным на 2.6.4.
3. **Проверки не ослаблены:** `deploy-safety` продолжает проверять ключи, порядок init и 415/403; `panel-deploy` — кнопку, ключ проекта и сборку; `acceptance-schema` — схему, манифест, сборщик.
4. **Новые фикстуры ловят регресс:** исключение F-7 только для собственных `task.md`/`criteria.json`; `docs/tasks/0001/*.md` — пересечение; `WARN` по `covers` для непокрытого файла.
5. `spec/checks/version-drift.mjs`, `docs/tasks/0020/{task.md,criteria.json}`, `acceptance.json`, `criteria.lock`, `red.json` не трогать; не коммитить, не пушить, не ставить теги.

## Границы знания

1. Тебе дан этот файл, `criteria.json` и репозиторий. Чужие проекты не читай.
2. Менять можно только пути из `allowedPaths`.
3. Проверка задания: `node spec/checks/version-drift.mjs`; полный набор — `node spec/selftest.mjs`, `node spec/e2e.mjs`, `node spec/checks/gate-rules.mjs`, `node spec/checks/deployed-copy.mjs`, `node tools/check-version.mjs`.

## Среда

- Node.js, Windows.

## Что сделать

1. **`spec/checks/deploy-safety.mjs`** — убрать литералы `2.6.3`/`0.7.1`; проверять: `VERSION` читается (непустой и совпадает с `package.json` спеки), `plugin/package.json` версия совпадает с `compat.PLUGIN_VERSION`, в SPEC есть абзац «Версия <VERSION>:» (динамически). Никаких утверждений про конкретный номер.
2. **`spec/checks/panel-deploy.mjs`** — версия плагина из `plugin/package.json` (динамически), без литерала.
3. **`spec/checks/acceptance-schema.mjs`** — то же: имя/версия плагина и `files` читаются из манифеста.
4. **`spec/checks/gate-rules.mjs`** — добавить фикстуры: своё `task.md`/`criteria.json` в protectedPaths → lint ок; шаблон `docs/tasks/0001/*.md` → ERROR; файл из `allowedPaths` без `covers` → WARN и exit 0.
5. **`spec/scripts/lib/common.mjs`** — `verify.executor.json` в `TASK_ARTIFACTS`.
6. **`spec/SPEC.md`/`CHANGELOG.md`** — строка в абзац «Версия 2.6.4:» про «версии только в check-version», без смены номера версии.

## Критерии приёмки

<!-- CRITERIA:BEGIN -->
| ID | Проверка | Ожидание |
| --- | --- | --- |
| C1 | node spec/checks/version-drift.mjs | exit 0, в выводе VERSION DRIFT OK |
| C2 | node spec/selftest.mjs | exit 0 |
| C3 | node spec/e2e.mjs | exit 0 |
| C4 | node spec/checks/gate-rules.mjs | exit 0, в выводе GATE RULES OK |
| C5 | node spec/checks/deploy-safety.mjs | exit 0 |
| C6 | node tools/check-version.mjs | exit 0, в выводе VERSION OK: 2.6.4 |
<!-- CRITERIA:END -->

## Отчёт

1. Что изменено и где.
2. Вывод каждой проверки целиком (C1–C6).
3. `git status --short`, `git diff --stat`.
4. Что осталось незакрытым.

## Коммит

Не коммить. Кандидатный коммит создаёт `task-accept`; пуш и теги — архитектор.
