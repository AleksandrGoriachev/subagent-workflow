# Задание 0047 — отчёт исполнителя

## 1. Что изменено

1. `spec/checks/panel-older.mjs`, функция `c2`: вместо спавна полного набора
   (`plugin/tools/test.mjs`) гоняется узкий набор
   `node --test plugin/test/client.test.mjs plugin/test/panel-older.test.mjs`.
   Проверки текста карточки (`CARD_WORDS`, `CARD_TEST`) и сообщение об ошибке
   с хвостом вывода не тронуты.
2. `spec/checks/engine-link.mjs`, функция `c4`: вместо полного набора — узкий
   `node --test plugin/test/client.test.mjs plugin/test/engine-link.test.mjs`.
   Сообщение об ошибке с хвостом вывода не тронуто.
3. `spec/checks/engine-link.mjs`: убраны версии-литералы из кода (комментарии
   не тронуты):
   - `2.6.12 → 1.7.0`, `2.6.13 → 1.8.0`, `2.6.10 → 1.6.0`, `2.6.14 → 1.9.0`
     одинаково во всех местах: `engineAt(...)`, `eq(..., version, ...)` в c1/c2/c3,
     кандидаты c3, фикстуры c5;
   - `CARD_TESTS`: `'0.9.3 absent: два действия, без ошибки'` →
     `'карточка absent: два действия, без ошибки'`, `'0.9.3 mapped: путь, версия, источник'` →
     `'карточка mapped: путь, версия, источник'`.
4. `plugin/test/client.test.mjs`: те же два названия тестов переименованы
   (тела тестов, утверждения и данные не менялись).

Смысл проверок не менялся: те же утверждения, те же сообщения (кроме
переименованных названий).

## 2. Файлы (полные пути)

- C:\Users\Goryachev\Documents\deepseek-harness\default-workspace\subagent-workflow-v2\spec\checks\panel-older.mjs
- C:\Users\Goryachev\Documents\deepseek-harness\default-workspace\subagent-workflow-v2\spec\checks\engine-link.mjs
- C:\Users\Goryachev\Documents\deepseek-harness\default-workspace\subagent-workflow-v2\plugin\test\client.test.mjs
- C:\Users\Goryachev\Documents\deepseek-harness\default-workspace\subagent-workflow-v2\docs\tasks\0047\report.md (этот отчёт)

Защищённые файлы (`spec/checks/narrow-suite.mjs`, `plugin/lib/**`, `plugin/tools/**`,
`package.json`, `pnpm-lock.yaml`) не тронуты.

## 3. Проверки — команда и дословный вывод

### C1 `node spec/checks/narrow-suite.mjs c1` — exit 0
```
NARROW OK c1
```

### C2 `node spec/checks/narrow-suite.mjs c2` — exit 0
```
NARROW OK c2
```

### C3 `node spec/checks/narrow-suite.mjs c3` — exit 0 (чистый одиночный прогон)
```
  panel-older.mjs c2: OK за 54 с
  engine-link.mjs c4: OK за 55 с
NARROW OK c3
C3 TOTAL 109.1 с, exit 0
```

### C4 `node spec/selftest.mjs` — exit 0
```
SELFTEST OK
```

### Регресс `node spec/checks/version-drift.mjs` — exit 0
```
PASS engine-link.mjs: без литералов версий
PASS panel-older.mjs: без литералов версий
VERSION DRIFT OK
```

## 4. Замер «до/после»

| Что | До | После |
| --- | --- | --- |
| `panel-older.mjs c2` | ≈113 с (спавн полного набора; полный набор сейчас — 98.8 с, 122 теста) | 54 с |
| `engine-link.mjs c4` | ≈113 с (тот же полный набор) | 55 с |
| `narrow-suite.mjs c3` целиком | ≈3.9 мин на базе (2 × полный набор) | 109.1 с |

Первый прогон c3 шёл одновременно с `selftest` и дал 82 с / 68 с — это завышение
из-за конкуренции; выше — чистый одиночный прогон.

## 5. Отклонения от задания

Нет по существу. Два уточнения:
- в `panel-older.mjs` узкий набор передан абсолютными путями
  (`path.join(PKG, 'plugin', 'test', ...)`), а не относительными
  `plugin/test/...`: это тот же `node --test` с теми же двумя файлами, но не
  зависит от `cwd`;
- в `c2` `panel-older.mjs` сохранён прежний `spawnSync` с pipe-выводом
  (так было до задания), в `c4` `engine-link.mjs` — прежний `runCapture`
  через файлы (в песочнице DSH pipe-вывод умирает EPERM).

## 6. Что гонялось и сколько раз

- `narrow-suite.mjs c1` — 2 раза (после первой правки и после правки комментария);
- `narrow-suite.mjs c2` — 2 раза;
- `narrow-suite.mjs c3` — 2 раза (первый — параллельно с `selftest`, второй — чистый);
- `spec/selftest.mjs` — 2 раза (до и после правки комментария в panel-older.mjs);
- `spec/checks/version-drift.mjs` — 2 раза;
- полный набор `node plugin/tools/test.mjs` — 1 раз (122 теста, pass 122, fail 0, 98.8 с, exit 0).

## 7. `git status --short`

```
 M plugin/test/client.test.mjs
 M spec/checks/engine-link.mjs
 M spec/checks/panel-older.mjs
?? docs/tasks/0047/criteria.lock
?? docs/tasks/0047/red.json
```

(`criteria.lock` и `red.json` появились до начала работы — их создал стенд
приёмки; `docs/tasks/0047/**` в `redAllowDirty`. Коммит не делался.)
