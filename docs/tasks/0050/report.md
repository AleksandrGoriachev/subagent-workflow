# Задание 0050 — отчёт исполнителя

## Что изменено

1. `spec/scripts/lib/common.mjs` — две чистые функции, снимок контракта и манифест:
   - `protectedManifest(files, options = {})` — отсортированный уникальный список файлов;
     `docs/subagent-workflow/**` (константа `ENGINE_DIR_PATTERNS`) вне манифеста, при
     `options.locksEngine === true` — внутри. Используется в `hashProtectedFiles` (замок) и в
     `checkContractCommitted` (набор файлов контракта): деплой движка больше не даёт
     «файл контракта не закоммичен/изменён после коммита».
   - `relockAllowed(prev, next)` — сравнивает нормализованные снимки: `allowedPaths`,
     `protectedPaths`, `redAllowDirty` и у критериев `id`, `command`, `cwd`, `timeoutMs`,
     `expect`, а также число и порядок критериев. `covers` и `tags` игнорируются как смысл.
     Разрешённая правка — `{ ok: true, changed: [...] }` (что именно изменилось), любое
     изменение нормализованной части — `{ ok: false, reason, changed }` с причиной
     «… — это новый номер задания, а не re-lock».
   - `contractSnapshot(meta, criteriaList)` — нормализованный снимок
     `{ allowedPaths, protectedPaths, redAllowDirty, criteria: [...] }`.
   - `computeLock` кладёт снимок в замок полем `contract` и строит `protected` через
     `protectedManifest` с флагом `meta.locksEngine === true`.
2. `spec/scripts/task-hash.mjs` — режим `--relock --reason "<текст>"`:
   - требует `--reason`, `red.json` с `redProven: true` и прежний `criteria.lock`;
   - отказывает, если сдвинулся `criteriaSha256` (блок критериев в `task.md`): смысл критериев
     re-lock не меняет;
   - зовёт `relockAllowed(previous.contract, contractSnapshot(meta, criteria.criteria))`;
     при отказе печатает `reason` и выходит 1;
   - при успехе пишет `relock: { at, by, reason, before: {criteriaJsonSha256, taskFileSha256},
     after: {...} }`, обновляет `criteriaJsonSha256`, `taskFileSha256`, `contractCommit` (HEAD)
     и `contract`; оставляет прежние `criteriaSha256`, `attackSha256` и `protected`
     (манифест прежний, хеши не пересчитываются; записи движка отбрасываются по политике
     `protectedManifest`, если задание не объявило `locksEngine`);
   - без `--relock` поведение прежнее: после красного `--write` отказывает; `--verify` не тронут.
3. `docs/tasks/0050/report.md` — этот отчёт.

## Файлы

- `C:\Users\Goryachev\Documents\deepseek-harness\default-workspace\subagent-workflow-v2\spec\scripts\lib\common.mjs`
- `C:\Users\Goryachev\Documents\deepseek-harness\default-workspace\subagent-workflow-v2\spec\scripts\task-hash.mjs`
- `C:\Users\Goryachev\Documents\deepseek-harness\default-workspace\subagent-workflow-v2\docs\tasks\0050\report.md`

Артефакты прогона (созданы `task-verify`, не входят в правку кода):
`docs\tasks\0050\verify.json`, `docs\tasks\0050\verify.log`.

## Проверки — дословно

```
--- c1 ---
RELOCK OK c1
exit=0
--- c2 ---
RELOCK OK c2
exit=0
--- c3 ---
PASS  doctor: без задач risk: high про ключ human-* молчит
PASS  doctor: задача risk: high включает предупреждение о human-*
<пустая строка>
SELFTEST OK
exit=0
```

Полные команды: `node spec/checks/relock-policy.mjs c1`, `node spec/checks/relock-policy.mjs c2`,
`node spec/selftest.mjs`.

## Что гонялось и сколько раз

- `node spec/checks/relock-policy.mjs c1` — 3 раза (2 отдельных + 1 внутри `task-verify`): OK.
- `node spec/checks/relock-policy.mjs c2` — 3 раза (2 отдельных + 1 внутри `task-verify`): OK.
- `node spec/selftest.mjs` — 3 раза (фоновый регресс-джоб, `task-verify` C3, финальный прогон): SELFTEST OK.
- `node spec/scripts/task-verify.mjs --task docs/tasks/0050` — 1 раз: PASS C1 539 ms, C2 523 ms,
  C3 32.9 s, exit 0.
- `node spec/scripts/task-hash.mjs --task docs/tasks/0050 --verify` — 1 раз: «lock совпадает», exit 0.
- `node spec/scripts/task-lint.mjs --task docs/tasks/0050 --strict` — 1 раз: «0050 — ок», exit 0.
- Регресс затронутых ворот (фоном): `deployed-copy.mjs` → DEPLOYED COPY OK; `acceptance-record.mjs` →
  ACCEPTANCE RECORD OK; `contract-selfcheck.mjs` → CONTRACT SELFCHECK OK; `covers-severity.mjs` →
  COVERS SEVERITY OK; `gate-rules.mjs` → GATE RULES OK; `spec/e2e.mjs` → E2E OK.
- Поведенческий прогон `--relock` в отдельном временном git-репозитории (16 проверок): PASS —
  снимок контракта в lock; движок вне `protected`, а с `locksEngine: true` — внутри; `--write`
  после красного по-прежнему отказывает; `--relock` без `--reason`, без `redProven: true` и без
  снимка контракта отказывает; границы и `covers` принимаются, смена команды и сдвиг блока
  критериев отклоняются с причиной; после re-lock `--verify` сходится с замком.

## Отклонения и трактовки

1. `--relock` сохраняет `protected` прежним (хеши не пересчитываются, новые файлы не
   добавляются), но применяет политику манифеста: записи `docs/subagent-workflow/**` из старого
   замка отбрасываются, если задание не объявило `locksEngine`. Это прямое следствие инварианта 3
   («деплой движка не краснит чужой замок») и того, что манифест строится через `protectedManifest`;
   набор защищённых файлов задания re-lock расширить не может.
2. `checkContractCommitted` тоже переведён на `protectedManifest`: без этого файл движка из
   `protectedPaths` давал «файл контракта изменён после коммита» — та же красная чужая правка.
3. `--relock` проходит через общий гейт «контракт закоммичен»: правленые `task.md`/`criteria.json`
   должны быть закоммичены до перезамка. Иначе `lock.contractCommit` указывал бы на старый контракт,
   а `task-verify` всё равно требует закоммиченный и неизменённый контракт.
4. `criteriaSha256` как отдельный гейт re-lock: блок критериев в `task.md` не правится, даже если
   поля `criteria.json` совпадают — иначе «не меняет criteriaSha256» не выполнялось бы.
5. После re-lock красный прогон повторяется (`task-red`): `criteriaJsonSha256`/`contractCommit`
   в `red.json` по условию задания обновились. Команды и ожидания те же (`criteriaSha256` не
   изменился), поэтому повтор дешёвый; команда сама пишет об этом подсказку.
6. При смене `protectedPaths` через re-lock манифест `protected` не пересчитывается (по заданию),
   поэтому `task-verify` может сказать «защищённый файл появился/исчез». Это осознанно: re-lock не
   должен незаметно менять набор защищённых файлов; основной его сценарий — `allowedPaths` и
   `covers` (0046→0054).
7. Замок самого задания 0050 (записан старой версией, без `contract`) не переписывался: после
   красного `--write` не запускался. `task-hash --verify` и `task-verify` подтверждают, что он
   сходится с новым кодом.

## git status --short

```
 M spec/scripts/lib/common.mjs
 M spec/scripts/task-hash.mjs
?? docs/tasks/0050/criteria.lock
?? docs/tasks/0050/red.json
?? docs/tasks/0050/report.md
?? docs/tasks/0050/verify.json
```
