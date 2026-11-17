# HANDOVER — 2026-11-18 (якоря: переоценка, подпись, кнопка в панели)

Передача в новую сессию. Контекст предыдущей переполнен; здесь — состояние на момент ухода.
Читать файлы, а не пересказ. Мой проект — только `subagent-workflow-v2` (движок + панель);
`dsh-project-graph` — не мой, туда не ходить без указания.

## 0. Главное

1. Выпуск **2.6.82 опубликован** (коммит `216f0cc`, тег `v2.6.82`): task-close, проектный allowlist,
   `job.mjs` со STALE/heartbeat, маркер стадий `task-accept`. Structure обновила движок и закрыла свои
   задания по отчёту (письмо `structure--210`).
2. После выпуска сделана **панель 0.9.36** (коммит `8fd6a43`): утверждение якорей в предпросмотре по
   слою «контур/проект». Панель **не выпущена** (в релизе 2.6.82 панель 0.9.35); в GUI работает через
   junction на `plugin` после перезапуска DSH.
3. Сделана **переоценка якорей** (контур A1–A14 + проектный набор P1–P3). Файлы лежат в рабочем
   дереве **без подписи владельца** — это единственный блокер: до подписи `anchor-freshness` красный,
   `selftest` (проверка ANCHORS) не пройдёт, коммит якорей не сделан.

## 1. Состояние версий

- пакет `subagent-workflow` **2.6.82** (VERSION/package.json/README/SPEC/TOOL/CHANGELOG согласованы,
  `tools/check-version.mjs` — PASS); тег `v2.6.82`; релиз
  https://github.com/AleksandrGoriachev/subagent-workflow/releases/tag/v2.6.82
  (8 ассетов, `SMOKE-v2.6.82.json` ok: tar.gz 1 644 850 б sha256 `2f2cfd49…3018e`, zip sha256 `c66f3dec…2dcae`);
- панель **0.9.36** в `plugin/package.json` и `plugin/lib/compat.js` (в релизе 2.6.82 была 0.9.35);
- наш развёрнутый движок `default-workspace/docs/subagent-workflow/VERSION` = **2.6.82**;
- у structure движок 2.6.82 (по её письму, самостоятельно не проверял).

## 2. Что сделано (коммиты, последние сверху)

| коммит | содержание |
| --- | --- |
| `8fd6a43` | panel 0.9.36: утверждение якорей по слою контур/проект (anchors.js, api.js, client.js, compat.js, test, BACKLOG WC-81) |
| `216f0cc` | release 2.6.82 |
| `b85f059` | job.mjs: heartbeat 5 с, STALE, проверка start, wait 30 мин; task-accept: маркер стадий в `~/.dsh/workflow/progress/`; job-runner c4–c5 |
| `a94739c` | regress-allowlist c8–c10 (сквозной прогон) |
| `040228d` | проектный allowlist: `docs/subagent-workflow/regress.allowlist.json`, `--allowlist`, `allowed`/`allowlistExpired`, SPEC §6.2 |
| `a12500f` | task-close --full удаляет attack.json/preflight.json; check c7 |
| `23963c0` | task-close: closure.json, аудит `task-closures.jsonl`, guard/lint/accept/verify, SPEC §7.1 |

Проверки после изменений: `selftest` OK, `e2e` OK, `closure-accounting` c1–c7, `regress-allowlist` c1–c10,
`job-runner` c1–c5, панельные тесты 47/47, `anchors-approve` 12/12.

## 3. БЛОКЕР: подписи якорей (владелец, не агент)

Агент подписи не ставит (И1). Черновики уже лежат по путям утверждения с `at`, но `signature = null`:

- контур: `subagent-workflow-v2/docs/anchors.approval.json` (hash `fe5c4e10375f…b61b11`, 8098 б);
- проект: `default-workspace/docs/anchors.approval.json` (hash `1db1f4aa1e29…ee118`, 2211 б).

Команды для PowerShell (полные пути):

```powershell
$sign = 'C:\Users\Goryachev\Documents\deepseek-harness\default-workspace\subagent-workflow-v2\spec\scripts\sign.mjs'
$key  = 'C:\Users\Goryachev\.dsh\keys\human-user.key.pem'
node $sign sign --file 'C:\Users\Goryachev\Documents\deepseek-harness\default-workspace\subagent-workflow-v2\docs\anchors.approval.json' --key $key --id human-user
node $sign sign --file 'C:\Users\Goryachev\Documents\deepseek-harness\default-workspace\docs\anchors.approval.json' --key $key --id human-user
```

Или кнопкой в панели после перезапуска DSH (см. §4) — она подпишет выбранный набор сама.

После подписи: прогнать `node spec/checks/anchor-freshness.mjs` и `node spec/checks/anchor-freshness.mjs --project <default-workspace>`,
затем закоммитить якоря (пакет) и проектный набор (воркспейс). Только после этого `selftest` снова зелёный.

## 4. Панель: кнопка утверждения (0.9.36, нужен перезапуск DSH)

- В карточке «Семантические якоря» появился переключатель **«Контур (движок)» / «Проект (этот воркспейс)»**
  (виден только когда в корне есть оба набора) и кнопка **«Утвердить якоря»**, которая подписывает
  показанный набор.
- API: `GET /api/anchors?layer=contour|project`, `POST /api/anchors/approve?layer=…`; слой по умолчанию contour.
- Подпись ставит сервер панели человеческим ключом `~/.dsh/keys/human-user.key.pem`; агентский ключ
  отклоняется. Ключ есть на диске; `human-user` зарегистрирован как `kind: human` в
  `docs/subagent-workflow/acceptors.json` нашего воркспейса.
- Панель подключена junction’ом: `~/.dsh/profiles/desktop/node_modules/dsh-workflow-console -> subagent-workflow-v2/plugin`,
  поэтому новый код подхватывается **перезапуском DSH**, релиз для своей GUI не обязателен.
- Выпустить панель для других воркспейсов — только следующим релизом (2.6.83), вместе с движком.

## 5. Переоценка якорей: что записано, но не закоммичено

Файлы в рабочем дереве пакета:

- `docs/anchors.json` (M): A1–A6, A8–A12 — `confirmed.version = 2.6.82`, `confirmed.date = 2026-11-18`;
  **A7: `inWork` → `semi`** (человеческая процедура, `shared-impact.mjs` нет, WC-69 не реализован);
  **A14: `inWork` → `auto`** (`plugin-test test/c11-role-binding.test.mjs` + C11 в `spec/engine.mjs`).
- `docs/ANCHORS.md` (M): A7 обновлён, добавлены разделы 13/14, потолок «не больше 15 (сейчас 14)».
- `docs/ANCHORS-REVIEW-2026-11-18.md` (??): протокол переоценки — какие проверки и с каким результатом.
- `docs/anchors.approval.draft.json` (??): черновик контурного утверждения.

Проектный набор воркспейса (новый, untracked): `default-workspace/docs/anchors.json` —
P1 (закрытое без приёмки не расширяет allowedPaths), P2 (мёртвый сторож → STALE), P3 (приёмка отдельной
сессией с подписью); все `auto`, с `proof` (команда + артефакт); `docs/anchors.approval.draft.json` рядом.

Прогоны, на которых основаны подтверждения: guard-acceptance --all; relock-policy c1/c2; model-source;
gates-journal c1/c2; plugin network-contract/release-check; outgoing-headers; job-runner c1–c5;
c11-role-binding; acceptance-record/p0; выпуск 2.6.82 (SMOKE).

## 6. Переписка и гейт

- отправлены: `--183` (ответ 207), `--184` (208), `--185` (209), `--186` (проверка доставки),
  `--187` (объявление 2.6.82), `--188` (чек-лист закрытия после обновления движка);
- structure: `--207`, `--208`, `--209`, `--210` (закрытия 0133/0207/0283/0284/0287/0288 + проектный allowlist);
- последняя проверка их гейта: `требуют хода: 0`, непрочитано 0, ошибок формата 18 (легаси);
- их коммиты и аудит закрытий **не проверял** (чужой воркспейс); принято по отчёту.

## 7. Бэклог и открытые вопросы

- `plugin/BACKLOG.md`: все строки `done`, плюс добавлен **WC-81** (0.9.36, утверждение якорей по слою).
- **Якоря**: подпись (блокер) → коммит; после — `anchor-freshness` должен быть зелёным без WARN о релизах.
- **Обмен**: закрыто (`effe2aa`). `tools/exchange-inbox.mjs` — память прочтения **по корню** каталога
  (`<пакет>/.tmp/exchange-seen`, вне архива и git) и точечная `--mark <письмо>`; журнал плагина —
  вспомогательный источник, не доказательство. 14 разобранных писем отмечены, ящик пуст.
  Документ: `docs/EXCHANGE-INBOX.md`.
- **Шов**: `coordination/ANCHORS-both.json` отсутствует; согласовано ли его заводить — не решено.
- **`guard.enabled`**: в `spec/workflow.config.json` выключен осознанно — решение владельца не принято.
- **retro/backlog.json**: 5 accepted, 15 proposed — ждут решения владельца.
- Не моё: 0276–0279 (переданы structure), `release-1` (preset-denied-command), PTC-пресет judge
  (профиль/промпт узла).

## 8. Уроки этой сессии (не повторять)

1. **`run_code` убивает дерево процессов**: detached-потомок из run_code не выживает; `job.mjs`, запущенный
   из `pwsh`, живёт. Тяжёлые прогоны — через `pwsh run_in_background` или `job.mjs` из pwsh/оболочки.
2. **Сторож W1**: `job_output(wait=true, timeout_ms > 120000)` отклоняется; бюджет 120000 мс;
   для тяжёлого — job.mjs; `wait` без `--timeout` теперь 30 мин, мёртвый сторож → `STALE`.
3. **Подпись якорей — только человек**. Агент не подписывает ни контур, ни проект; готовить черновик,
   давать полный путь и команду — можно.
4. **Коммит только через `tools/commit.ps1`**; прямой `git commit` в pwsh запрещён (`processPolicy=fail`).
5. **Релиз — только `node tools/release.mjs release <версия>`**: он сам делает commit+tag+push, архивы,
   draft → smoke → publish. Заранее коммитить версию нельзя: при пустом индексе `commit.ps1` откажет.
6. **Чужой воркспейс** — не читать/не запускать без указания (W5).

## 9. Следующие шаги по порядку

1. Владелец подписывает два `anchors.approval.json` (команды в §3) **или** перезапускает DSH и жмёт кнопку
   по слоям (контур, затем проект).
2. Прогнать `anchor-freshness` (контур и `--project`), затем `selftest`.
3. Закоммитить якоря: пакет — `docs/anchors.json`, `docs/ANCHORS.md`, `docs/ANCHORS-REVIEW-…`, `docs/anchors.approval.json`
   (и draft); воркспейс — `docs/anchors.json`, `docs/anchors.approval.json`.
4. Если панель 0.9.36 нужна другим — выпуск 2.6.83 (движок 2.6.83 + панель 0.9.36), затем письмо structure.
5. Закрыть недоделку обмена: точечная отметка `--mark <письмо>` + по-корневая память прочтения.
