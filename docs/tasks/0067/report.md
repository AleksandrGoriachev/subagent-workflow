# Отчёт по заданию 0067

## 1. Что изменено

1. **`plugin/lib/archive.mjs` (новый)** — чистый модуль без спавнов и сети:
   - `sha256Hex(buffer)` — sha256 в нижнем регистре hex;
   - `extractTarGz(buffer)` — `zlib.gunzipSync` + разбор tar ustar: имя 0..100,
     размер (восьмеричный) 124..136, typeflag 156 (`0`/`\0` — файл, `5` — каталог,
     `x`/`g`/`L` и прочие служебные — пропускаются вместе с данными), prefix 345..500
     (склеивается с именем через `/`), данные выровнены по 512, пустой хвост
     игнорируется. Возвращает `Map<path, Buffer>`, каталогов в Map нет.
2. **`plugin/lib/release-source.mjs` (новый)** — без спавнов и пайпов:
   - `parseLatestRelease(json)` → `{ version, tag, tarballUrl, sha256Url }`; версия из
     `tag_name` без ведущей `v`; tarball — ассет `/^subagent-workflow-.*\.tar\.gz$/`,
     sha256 — ассет с тем же именем + `.sha256`; нет ассета — понятная ошибка;
   - `prepareEngineSpec({ apiBase, repo, fetchImpl })` — GET
     `${apiBase}/repos/${repo}/releases/latest`, скачивание tarball и `.sha256`,
     сверка `sha256Hex(payload)` (расхождение — ошибка до распаковки), распаковка в
     `fs.mkdtempSync(path.join(os.tmpdir(), 'wf-release-'))`, срезание общего верхнего
     каталога, проверка `VERSION` и `scripts/init.mjs`, возврат
     `{ specRoot, version, cleanup }`. `cleanup()` удаляет временный каталог.
3. **`plugin/lib/api.js`**:
   - `createWorkflowRuntime` принимает `updateSource` (из `config.updateSource`, с
     запасным `options.updateSource`), нормализует и сохраняет в `runtime.updateSource`;
     умолчания — `https://api.github.com` и `AleksandrGoriachev/subagent-workflow`;
   - в маршруте `/api/update` при `body.source === 'release'` вызывается
     `prepareEngineSpec` (apiBase/repo из `runtime.updateSource`), затем
     `updateWorkflowAsync(root, { specRoot: spec.specRoot, allowInProgress })`;
     успешный ответ содержит `source: 'release'` и `targetVersion` = версия релиза;
     ошибка сети/подписи — 502 `{ code: 'release-unavailable', error }`;
     `cleanup()` вызывается в `finally`; без `source` поведение прежнее.
4. **`plugin/lib/client.js`**:
   - константы действия «Обновить из релиза» и короткий текст, что версия
     скачивается из релиза GitHub (tarball + sha256), а не из сборки панели;
   - при ответе `up-to-date` или `panel-older` в заметке обновления показывается
     действие «Обновить из релиза» (POST `/api/update` с
     `{ root, confirm: true, source: 'release' }`);
   - в тех же состояниях (версия совпадает со сборкой / сборка старше движка)
     действие показано и в карточке «Версия движка»; остальные ветки не менялись.
5. **`docs/tasks/0067/report.md` (этот файл)** — отчёт; задание, критерии и замок не
   правились.

## 2. Файлы (полные пути)

- `C:\Users\Goryachev\Documents\deepseek-harness\default-workspace\subagent-workflow-v2\plugin\lib\archive.mjs` (новый)
- `C:\Users\Goryachev\Documents\deepseek-harness\default-workspace\subagent-workflow-v2\plugin\lib\release-source.mjs` (новый)
- `C:\Users\Goryachev\Documents\deepseek-harness\default-workspace\subagent-workflow-v2\plugin\lib\api.js`
- `C:\Users\Goryachev\Documents\deepseek-harness\default-workspace\subagent-workflow-v2\plugin\lib\client.js`
- `C:\Users\Goryachev\Documents\deepseek-harness\default-workspace\subagent-workflow-v2\docs\tasks\0067\report.md`

## 3. Проверки

Рабочий каталог всех команд:
`C:\Users\Goryachev\Documents\deepseek-harness\default-workspace\subagent-workflow-v2`.

### C1 — `node spec/checks/release-update.mjs c1`

```text
RELEASEUPDATE OK c1
```

exit code: **0**.

### C2 — `node spec/checks/release-update.mjs c2`

```text
RELEASEUPDATE OK c2
```

exit code: **0**.

### C3 — `node plugin/tools/test.mjs`

```text
plugin test: 7 файл(ов)
✔ GET /workflow/api/status reports the repository and policy (10248.3163ms)
✔ GET /workflow/api/tasks returns the board with stages and skipped files (7225.9197ms)
✔ GET /workflow/api/task/:id returns decisions, attack, coverage and record (8899.1423ms)
✔ GET /workflow/api/policy matches the doctor policy line (5849.9537ms)
✔ GET /workflow/api/compat reports versions and recommendations (6013.9168ms)
✔ a registered workspace is readable even when it is not a configured root (6599.7462ms)
✔ non-GET methods answer 405 with Allow: GET (5792.8746ms)
✔ unknown routes answer 404 and a foreign root answers 400 (5378.7058ms)
✔ a non-loopback peer is rejected (4461.0867ms)
✔ a traversal-shaped task id is rejected (4713.1368ms)
✔ GET /workflow/api/checks lists the read-only checks (5507.1244ms)
✔ POST /workflow/api/run returns the log of a passing check and writes nothing (7246.5671ms)
✔ a failing check is a result, not an error (6580.1942ms)
✔ run rejects unknown checks, missing tasks and absent scripts (6047.0168ms)
✔ run is POST-only and other routes stay GET-only (4601.5207ms)
✔ POST /workflow/api/guard flips only guard.enabled and logs it (4699.6407ms)
✔ guard route is POST-only and validates its body and root (5432.0317ms)
✔ a full request sweep does not change files or git status (9198.8033ms)
✔ POST /workflow/api/deploy разворачивает движок в корень workspace (0.7.0) (5247.5948ms)
✔ deploy без confirm ничего не пишет, POST-only и проверяет корень (1786.8117ms)
✔ POST guard/deploy требуют application/json — иначе 415 и никакой записи (5722.461ms)
✔ POST guard/deploy отвергают чужой Origin — 403, до записи (6700.3199ms)
✔ deploy создаёт ключ проекта и не трогает глобальный ключ (8995.1254ms)
✔ POST /workflow/api/update обновляет движок и защищает незавершённые задания (0.8.0) (7181.1575ms)
✔ POST /workflow/api/update target engine-repo обновляет репозиторий внешнего движка (0042) (9683.0376ms)
✔ client bundle registers the Workflow conversation view (53.9687ms)
✔ panel renders a real board, task card and policy page (15040.8459ms)
✔ policy page toggles the guard flag with confirmation (0.5.0) (10790.0692ms)
✔ panel follows the current workspace and opens compatibility (8424.0803ms)
✔ badges explain themselves: hints on hover and focus (WC-1) (9597.2939ms)
✔ card aria-label carries effect and regress hints, card shows «Регресс» (0.4.1) (10618.1668ms)
✔ badge «эффект» colored by policy severity, not by status (0.4.1) (18772.0037ms)
✔ card says «не проверялось» when gates did not check the effect (0.4.1) (9921.2103ms)
✔ diagnostics buttons run a read-only check and show the log (v2, step 1) (12267.7265ms)
✔ panel does not substitute a foreign project: empty state first, configured roots on request (6281.7145ms)
✔ empty state deploys the engine with confirmation (0.7.0) (13877.8421ms)
✔ empty non-git workspace: deploy performs git init, then installs the engine (0.9.3) (6391.6799ms)
✔ compatibility tab offers the same deploy button (0.7.0) (2335.723ms)
✔ package manifest declares the DSH bundle and client halves (1.126ms)
✔ deployed engine shows versions and guards update with unfinished tasks (0.8.0) (5891.2597ms)
✔ карточка panel-older: понижение не предлагается (5676.1887ms)
✔ mapped workspace reads the external engine and disables writes (0.9.0) (6014.495ms)
✔ карточка external: обновление в репозитории движка (7050.1343ms)
✔ карточка absent: два действия, без ошибки (4966.2677ms)
✔ карточка mapped: путь, версия, источник (5240.2499ms)
✔ 0.9.3 config: связь задана конфигом профиля (3553.1739ms)
✔ parse/compare versions (6.2216ms)
✔ 2.2.x is compatible (1.7339ms)
✔ 2.0.x reports limited functionality (0.9823ms)
✔ 2.1.x reports missing attack and policy (0.5144ms)
✔ missing workflow directory is an error (0.5502ms)
✔ missing config is an error but missing VERSION is a warning (0.5132ms)
✔ 2.4.5 — рабочее состояние: ни баннера, ни «мы это не показываем» (0.5757ms)
✔ 2.6.0 — рабочее состояние: guard и запись 2.6.0 входят в диапазон, баннера нет (0.4635ms)
✔ устаревший плагин: совет обновиться есть, баннера «ограничен» нет (0.8208ms)
✔ устаревшая развёрнутая копия — по-прежнему ограничение с советом обновиться (1.034ms)
✔ a 2.2 deployment without the attack gate is limited (0.6001ms)
✔ unknown version is a warning, not a hard failure (0.8043ms)
✔ манифест сохраняет files, dsh и engines.dsh после 0.8.0 (3.9566ms)
✔ PLUGIN_VERSION совпадает с package.json (1.8335ms)
✔ TOOL собирается из PLUGIN_VERSION и не отстаёт (67.9217ms)
✔ POST /api/engine-link: confirm, тип и Origin — до записи (2.6.14) (138.361ms)
✔ POST /api/engine-link: атомарная карта, /api/status называет источник (2.6.14) (1292.5763ms)
✔ POST /api/engine-link: относительный путь, каталог без движка и чужой корень — 400 (2.6.14) (203.1978ms)
✔ POST /api/engine-link: конфиг профиля сильнее кнопки — 409 engine-config (2.6.14) (1420.0037ms)
✔ GET /api/engine/candidates: только воркспейсы с движком, версия и current (2.6.14) (140.3982ms)
✔ writeEngineLink: атомарная запись и отказ на битой карте (2.6.14) (108.8228ms)
✔ engineRootsFile: env WF_ENGINE_ROOTS переопределяет домашний путь (26.1041ms)
✔ readEngineRoots: файла нет — не ошибка, карта не создаётся (7.089ms)
✔ readEngineRoots: битый JSON и не-объект не роняют чтение (91.8266ms)
✔ readEngineRoots: относительные записи пропускаются, дубли нормализуются (23.8914ms)
✔ readEngineRoots: ключи без учёта регистра и хвостового слэша (16.5186ms)
✔ resolveEngine: движок в воркспейсе — source workspace (60.8601ms)
✔ resolveEngine: карта даёт source mapping (75.0229ms)
✔ resolveEngine: карта на каталог без движка — installed false, запись не запрещена (28.7147ms)
✔ resolveEngine: нет карты — source none (23.4331ms)
✔ resolveEngine: env WF_ENGINE_ROOTS подхватывается в момент вызова (72.5638ms)
✔ resolveEngine: конфиг профиля (engines.roots) сильнее карты (2.6.14) (151.2ms)
✔ resolveEngine: битая и относительная связь в конфиге (2.6.14) (142.9353ms)
✔ resolveEngine: локальный движок сильнее конфига (2.6.14) (83.9103ms)
✔ API: /api/status отдаёт engine mapping, чтение идёт из движка (3710.9414ms)
✔ API: POST guard/deploy/update при mapping — 409 engine-external до любых действий (155.0688ms)
✔ API: обычный воркспейс не получает 409 — guard пишет как раньше (909.1009ms)
✔ API: битая карта не роняет панель (730.5369ms)
✔ compareVersions сравнивает версии числом по сегментам (0041) (6.3942ms)
✔ updateWorkflow отвергает понижение движка до списка задач и без записей (0041) (4301.5162ms)
✔ POST /workflow/api/update отдаёт 409 panel-older с подсказкой (0041) (3457.7408ms)
✔ canonicalize and sha256 match the gates (5.7009ms)
✔ decisions summary matches the gates (3.6789ms)
▶ stage matrix matches the artifact set
  ✔ contract (10111.8741ms)
  ✔ attack (6809.7131ms)
  ✔ unresolved (8414.2072ms)
  ✔ lock (6376.0453ms)
  ✔ red (6965.0351ms)
  ✔ green (6590.3805ms)
  ✔ coverage (7404.5926ms)
  ✔ accepted (5335.1571ms)
  ✔ remarks (6050.7463ms)
  ✔ legacy (6627.0585ms)
  ✔ mismatch (7997.0384ms)
✔ stage matrix matches the artifact set (78686.238ms)
✔ lock is in sync with a fresh contract (6384.2144ms)
✔ a changed protected file breaks the lock (5856.0063ms)
✔ task card carries assumed decisions, attack and record v6 (7641.8526ms)
✔ a hidden assumed decision is caught against the contract (7204.3022ms)
✔ repository view reads config, version, protected hashes and skipped files (6109.8913ms)
✔ policy view matches doctor wording and values (3719.9718ms)
✔ reading a repository does not change worktree files or git status (8295.9366ms)
✔ a task without criteria is incomplete (0.8986ms)
✔ an unreadable acceptance record is visible, not silently ignored (5721.8416ms)
✔ a UTF-16 acceptance record is read instead of being ignored (6112.7749ms)
✔ a v5 record with assumed decisions is accepted but not release-ready (5848.2511ms)
✔ effectsView: решение на измерителе — цепь собрана (0.7544ms)
✔ effectsView: решение мимо цепи — unlinked и название в списке (0.436ms)
✔ effectsView: решение требует эффекта, а effect не объявлен — missing (0.9205ms)
✔ effectsView: измеритель на себе — invalid с объяснением (0.4299ms)
✔ effectsView: ворота записали несогласованность — mismatch (0.7132ms)
✔ effectsView: без решений с impact и без effect — none, а не «ok» (0.515ms)
✔ effectsView: required и missing — ровно правило ворот, без оглядки на class/evidence (2.1321ms)
✔ boardTask: строгость проблемы эффекта приходит из policy, а не из статуса (6581.7792ms)
✔ readBaseline: читает долг и помечает просроченный срок (16.914ms)
✔ readBaseline: файла нет — совместимо и молча (5.6729ms)
ℹ tests 122
ℹ suites 0
ℹ pass 122
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 163933.5725
```

exit code: **0** (122 pass, 0 fail).

### C4 — `node spec/selftest.mjs`

```text
PASS  regress: medium без красного — нарушение
PASS  regress: low без красного и без обхода — нарушение
PASS  regress: low + allowMissingRed — законный долг
PASS  regress: запись v3 — legacy
PASS  regress: подпись не сходится — untrusted
PASS  regress: свежий красный — ok
PASS  regress: красный от другого контракта — нарушение
PASS  regress: baseline просрочен
PASS  regress: baseline находит запись по задаче и статусу
PASS  regress: задача из baseline с регрессом всё равно валит прогон
PASS  regress: погашенный долг валит только при --strict и просрочке
PASS  regress: нарушение не гасится baseline
PASS  regress: --write-baseline берёт только законный долг
PASS  regress: нарушения попадают в baseline только с --include-violations
PASS  запись medium с отдельной сессией принимается
PASS  подмена поля ломает подпись
PASS  запись v3 принимается как legacy
PASS  самоприёмка (сессия = issuedBy) отклоняется
PASS  medium без аттестованной сессии отклоняется
PASS  declared-актор не проходит для medium
PASS  high-risk с ключом агента отклоняется
PASS  high-risk с человеческим ключом принимается
PASS  low с declared-актором принимается
PASS  актор harness: env / separate-session
PASS  актор runner: env / separate-session
PASS  актор ci: declared / declared
PASS  актор manual: declared / declared
PASS  пустое окружение: none/declared, сессии и источника нет
PASS  legacy-конфиг: primary → harness, fallback → manual
PASS  legacy-конфиг не меняет поведения: env/separate-session и declared
PASS  конфиг без legacy-полей не падает: дефолты подставлены
PASS  неизвестный вид источника: ошибка конфига, а не сессия
PASS  модель берётся из modelSources, без них — unknown
PASS  запись с источником runner и separate-session принимается
PASS  источник ci с уровнем separate-session отклоняется
PASS  запись v5 с assumed-решением принимается, но releaseReady=false
PASS  releaseReady=true при assumed-решениях отклоняется
PASS  спрятанный assumed ловится по контракту
PASS  красный прогон от другого контракта отклоняется
PASS  запись со ссылкой на отсутствующий attack.json отклоняется
PASS  metadata-коммит с правкой кода отклоняется
PASS  acceptance внутри кандидата отклоняется
PASS  U1: решение ссылается на измеритель — связь есть
PASS  U2: решение ссылается на носитель — связь есть
PASS  U3: решение вне цепи эффекта — ошибка с именем решения и цепи
PASS  U4: наружу выходит только несвязанное решение
PASS  U5: внутреннее решение вне цепи — не нарушение
PASS  U6: доказательство спецификацией — не применимо
PASS  U7: manual-критерий — человеческое доказательство, не применимо
PASS  U8a: mechanical user-visible без эффекта — required ловит, consistency молчит
PASS  U8b: mechanical user-visible вне цепи — consistency не применяется
PASS  U9: решений нет — правило молчит, checked=false
PASS  U10: решение входит во вторую цепь — pass
PASS  U11: мусор в decisions не роняет проверку
PASS  U12: невалидный эффект не даёт каскада consistency
PASS  R1: согласованная запись принимается
PASS  R2: ok=false при согласованном контракте — расхождение записи
PASS  R4: links не совпадают с контрактом
PASS  R5: запись без блока (до 2.4.0) не ломается
PASS  R6: запись без блока и без флага не ломается
PASS  R3a: policy.decisions=fail валит несогласованную запись
PASS  R3b: policy.decisions=warn — предупреждение, запись принимается
PASS  TOOL совпадает с VERSION
PASS  doctor: без задач risk: high про ключ human-* молчит
PASS  doctor: задача risk: high включает предупреждение о human-*

SELFTEST OK
```

exit code: **0**.

### C5 — `node spec/checks/gate-rules.mjs`

```text
PASS F-7: пересечение allowedPaths/protectedPaths — ошибка
PASS F-7 контроль: без пересечения — ок
PASS F-7 узость: свои task.md/criteria.json — ок
PASS F-7 узость: шаблон docs/tasks/0001/*.md — ошибка
PASS covers: шаблон из allowedPaths без covers — WARN и exit 0
PASS covers: конкретный файл из allowedPaths без covers — ERROR и exit 1
PASS covers: файл из allowedPaths под шаблоном covers — ок, exit 0
PASS F-5: пустой mustFail без noRed — ошибка
PASS F-5 контроль: noRed с причиной — ок
PASS F-6: при несовпадении причина и вывод напечатаны
PASS F-8: verify.json сохранён как verify.executor.json

GATE RULES OK
```

exit code: **0**.

### Дополнительно — `node spec/checks/pipe-free.mjs c1`

```text
PIPEFREE OK c1
```

exit code: **0**.

## 4. Отклонения от задания

Материальных отклонений нет. Уточнения, принятые по смыслу §Инварианты:

1. **Расположение specRoot в архиве.** Задание требует проверить `VERSION` и
   `scripts/init.mjs`. В фикстуре проверки (и в текущем формате релиза) архив
   содержит верхний каталог `subagent-workflow-X.Y.Z/` с `VERSION` в корне и
   движком в `spec/`. `prepareEngineSpec` поэтому принимает оба расклада:
   `<root>/spec/scripts/init.mjs` (specRoot = `<root>/spec`) и
   `<root>/scripts/init.mjs` (specRoot = `<root>`); `VERSION` ищется в корне,
   рядом со specRoot и внутри него. Это не меняет контракт, а делает релиз
   устойчивым к обоим layout'ам.
2. **Место действия «Обновить из релиза».** Кроме заметки после ответа
   `up-to-date`/`panel-older`, действие показано в карточке «Версия движка» в тех
   же двух состояниях — чтобы кнопка была видна сразу, а не только после клика
   «Обновить движок». Другие ветки обновления не менялись.
3. **Тело запроса кнопки** — ровно `{ root, confirm: true, source: "release" }`,
   как в задании, без `allowInProgress`: при незавершённых заданиях сервер
   ответит 409 `tasks-in-progress`, и панель покажет его текст.
4. **Защита от path traversal** в `release-source.mjs`: абсолютные пути и `..`
   в записях архива отвергаются до записи на диск (сверх задания, security).
5. **502 `release-unavailable`** отдаётся телом `{ code, error }`, как в задании.
6. `cleanup()` вызывается в `finally` и на успехе, и на отказе init; ошибка
   удаления временного каталога не превращает успешное обновление в ошибку.

## 5. `git status --short`

```text
 M plugin/lib/api.js
 M plugin/lib/client.js
?? docs/tasks/0067/criteria.lock
?? docs/tasks/0067/gates.jsonl
?? docs/tasks/0067/red.json
?? docs/tasks/0067/report.md
?? plugin/lib/archive.mjs
?? plugin/lib/release-source.mjs
```