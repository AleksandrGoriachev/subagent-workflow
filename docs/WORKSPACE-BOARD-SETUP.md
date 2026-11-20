# Развёртывание воркспейса-оркестратора «dsh-kanban-board» (доска реалма)

## Конкретика

- **Имя воркспейса:** `dsh-kanban-board`
- **Корень:** `C:\Users\Goryachev\Documents\deepseek-harness\dsh-kanban-board`
- **GitHub:** https://github.com/AleksandrGoriachev/dsh-kanban-board (репозиторий уже создан)
- **Роль в реалме:** оркестратор/архитектор — владеет доской, журналом, реестром проектов.

**Состояние на момент создания (проверено):** воркспейс уже поднят (GUI DSH его создал), внутри `.git`
(ветка `master`, без коммитов, без remote), `.gitignore`, `docs/`, `.wf-keys/`, `.dsh/`. DSH при
создании воркспейса автоматически развернул движок workflow (`docs/subagent-workflow/`).

Важно про «движок не ставится»: §16 анализа говорил, что доска живёт не в движке. DSH разворачивает движок
в каждый новый воркспейс по умолчанию — это нормально и не мешает: движок даёт `docs/subagent-workflow/scripts/`
(в т.ч. `job.mjs`) и `docs/subagent-workflow/templates/`, но для доски мы их **не используем как
исполнение**: оркестратор не заводит `docs/tasks`, он ведёт только `board/`.

---

Цель: поднять отдельный воркспейс, который владеет **доской оркестрации** реалма (эпики, наряды, журнал)
и подключён к GitHub. Исполнением он не занимается (см. анализ
`ANALYSIS-KANBAN-WORKSPACES.md`, §15–§16).

Два этапа:
- **Этап 1 (сейчас):** репозиторий + структура каталогов + git + папка обмена + presence. Кода доски ещё нет.
- **Этап 2 (позже):** механика доски (`apply`, `sweep`, `journal`, `replay`, `render`) и, если нужна
  панель — плагин.

---

## 0. Что создаётся и роли

| Объект | Владелец | Что делает |
| --- | --- | --- |
| Новый воркспейс | воркспейс-архитектор реалма | доска, журнал, реестр проектов |
| GitHub-репозиторий | реалм | код доски + протокол + (опц.) данные доски |
| Папка обмена | реалм | письма нарядов/квитанций между воркспейсами |

Рабочие воркспейсы (консоль, прокси, оптимизатор) доску не читают и не пишут — только письма.

---

## 1. Предусловия

- DSH (запущенный web-интерфейс);
- git, `pwsh` 7+, node (≥20);
- доступ к GitHub (аккаунт + токен/ключ).

---

## 2. Каталоги нового воркспейса

```
<новый-воркспейс>/
  README.md
  LICENSE
  .gitignore
  tools/
    commit.ps1               # штатный вход коммита (шаблон ниже)
    exchange-inbox.mjs       # копия из subagent-workflow-v2/tools
    check-exchange.mjs       # копия из default-workspace/tools
  coordination/
    projects.json            # реестр собеседников (владелец — архитектор)
    presence.json            # живость воркспейса
    exchange/
      outbox/                # письма ОТ нас; формат dsh-exchange/1
  board/
    epics/                   # эпики реалма
    tasks/                   # наряды воркспейсам
    journal.jsonl            # append-only журнал переходов
    .sweep.json              # память прочтения обхода
  docs/
    PROTOCOL.md              # ссылка на протокол доски (из ANALYSIS-KANBAN-WORKSPACES.md)
```

---

## 3. Создание GitHub-репозитория

```
Репозиторий уже создан на GitHub, воркспейс уже инициализирован (`master`, без коммитов).
Осталось связать их и сделать первый коммит:

```
cd C:\Users\Goryachev\Documents\deepseek-harness\dsh-kanban-board
git branch -M main
git add .
git commit -m "init: воркспейс-оркестратор доски реалма"
git remote add origin https://github.com/AleksandrGoriachev/dsh-kanban-board.git
git push -u origin main
```

`.gitignore` (минимум):

```
# секреты и приватное
*.key.pem
*.pem
.wf-keys/
# временное
.tmp/
# локальное состояние доски
board/.sweep.json
```

(Репозиторий `AleksandrGoriachev/dsh-kanban-board` уже существует — см. блок выше.)

---

## 4. Git-авторизация в DSH

Токен/креды хранятся в `~/.git-credentials` (единая копия, в файлы воркспейса не копировать).

```
# проверить, что credential fill отдаёт токен
git credential fill <<EOF
protocol=https
host=github.com

EOF
```

Если push падает с ошибкой SSL-бэкенда:

```
git config --local http.sslBackend openssl
```

Для неинтерактивности: `GIT_TERMINAL_PROMPT=0`.

> Если воркспейс работает под политикой workflow (`processPolicy=fail`), прямой `git commit`/`git push`
> в инструменте запрещён — коммитить через `tools/commit.ps1` (шаблон ниже).

---

## 5. Штатный вход коммита — `tools/commit.ps1`

Скопировать адаптированный вариант (как в `default-workspace/tools/commit.ps1`):

```powershell
param([Parameter(Position=0)][string]$Message='',[switch]$DryRun,[switch]$Push,[string]$Tag='',[string]$DeleteTag='')
$ErrorActionPreference='Stop'
$repo = Split-Path -Parent $PSScriptRoot
Set-Location $repo
if ($DeleteTag -ne '') {
  if (@(git tag --list $DeleteTag).Count -eq 0) { Write-Host ('ТЕГ ' + $DeleteTag + ' НЕ НАЙДЕН'); exit 8 }
  git tag -d $DeleteTag
  if ($Push) { git push origin (':' + 'refs/tags/' + $DeleteTag) }
  Write-Host ('ТЕГ ' + $DeleteTag + ' УДАЛЁН.'); exit 0
}
$staged = @(git diff --cached --name-only --diff-filter=ACMRTD)
if ($staged.Count -eq 0 -and -not $Push -and $Tag -eq '') { Write-Host 'КОММИТ НЕ НУЖЕН'; exit 2 }
if ($staged.Count -gt 0) {
  if ($Message -eq '') { Write-Host 'НУЖНО СООБЩЕНИЕ'; exit 2 }
  if ($DryRun) { Write-Host 'ПРОВЕРКА ПРОЙДЕНА'; exit 0 }
  git commit -m $Message
  if ($LASTEXITCODE -ne 0) { exit 4 }
}
if ($Tag -ne '') { git tag $Tag }
if ($Push) { git push origin HEAD; if ($Tag -ne '') { git push origin $Tag } }
exit 0
```

---

## 6. Реестр и живость

`coordination/projects.json` — версионированный, владелец — архитектор:

```json
{
  "version": 1,
  "owner": "architect",
  "peers": [
    { "id": "console",  "root": "<абс. путь>/console-workspace",  "exchange": "<абс. путь>/console-workspace/coordination/exchange" },
    { "id": "proxy",    "root": "<абс. путь>/proxy-workspace",    "exchange": "<абс. путь>/proxy-workspace/coordination/exchange" },
    { "id": "optimizer","root": "<абс. путь>/optimizer-workspace", "exchange": "<абс. путь>/optimizer-workspace/coordination/exchange" }
  ]
}
```

`coordination/presence.json` — обновляется архитектором при каждом ходе/обходе:

```json
{ "version": 1, "workspace": "architect", "sessionId": "<DSH_SESSION_ID>", "at": "<ISO-8601>" }
```

---

## 7. Папка обмена

Письма пишутся **только в свой outbox**; чужие outbox читаются по реестру. Формат письма — `dsh-exchange/1`
(шапка `From/To/Date/Thread/Status/Workspace/Session/Reply-To/Subject`).

Тест доставки (после того как собеседник поднял свою папку):

```
# отправить тестовое письмо соседу
# прочитать свой ящик
node tools/exchange-inbox.mjs --box <путь-к-обмену>
# проверить формат и чей ход
node tools/check-exchange.mjs --box <путь-к-обмену> --me architect
```

---

## 8. Регистрация воркспейса в DSH

1. GUI → Workspaces → добавить путь к новому воркспейсу.
2. Убедиться, что корень появился в списке (`/workflow/api/status` → `roots`), если воркспейс должен
   участвовать в спавне узлов.
3. Панель доски (этап 2) монтируется отдельным плагином в профиле — на этапе 1 не требуется.

---

## 9. Проверка готовности (чек-лист)

- [ ] `git remote -v` показывает origin;
- [ ] `git push -u origin main` прошёл (или через `commit.ps1 -Push`);
- [ ] каталоги `board/epics`, `board/tasks`, `coordination/exchange/outbox` созданы;
- [ ] `presence.json` и `projects.json` на месте, версии проставлены;
- [ ] `node tools/check-exchange.mjs --box ... --me architect` → «формат … ок», exit 0;
- [ ] тестовое письмо соседу ушло и прочитано собеседником (квитанция `Status: report`).

---

## 10. Что дальше (этап 2)

1. Реализовать механику доски (`apply`, `sweep`, `journal`, `replay`, `render`) в этом репозитории;
2. обвязка с обменом (маркеры `[task-accept]`, `[stage-ready]`, `[blocked]`…);
3. панель-плагин (если нужна) — отдельный репозиторий, монтируется профилем владельца;
4. приёмочные проверки — отрицательные кейсы (недопустимый переход, дубль письма, просроченный лиз,
   расхождение журнала).

Протокол доски и разделение «код ↔ модель» — в `subagent-workflow-v2/docs/ANALYSIS-KANBAN-WORKSPACES.md`.
