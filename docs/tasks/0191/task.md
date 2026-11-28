# Задание 0191. INSTALL.md: ожидание узла графа — факт (project_graph_wait)

<!-- TASK-META
{
  "id": "0191",
  "version": 1,
  "title": "INSTALL.md описывает принятый project_graph_wait (0385), а не отрицает ожидание узла",
  "risk": "low",
  "created": "2026-11-28",
  "owner": "координатор",
  "executor": "subagent:executor",
  "acceptor": "subagent:judge",
  "deviation": "корень пакета вне разрешённых корней спавна узла judge (root-not-allowed); приёмку выполняет отдельная сессия узла judge",
  "issuedBy": { "kind": "agent", "session": "session-eceafc45-4b60-4614-abe3-c21aa1a76432", "model": "deepseek-flash" },
  "base": "HEAD",
  "criteria": "criteria.json",
  "allowedPaths": [
    "INSTALL.md",
    "docs/tasks/0191/**"
  ],
  "protectedPaths": [
    "spec/checks/install-wait.mjs",
    "VERSION",
    "package.json"
  ],
  "redAllowDirty": [
    "docs/tasks/0191/**"
  ],
  "hashExclude": [],
  "decisions": [
    {
      "id": "D1",
      "class": "mechanical",
      "question": "Что делать с разделом «Ожидание узла графа» после принятия 0385",
      "chosen": "Заменить отрицание фактом: project_graph_wait, формат { childId, state, waitedMs, exitCode?, tail? }, значения state, лимиты 30000/0..60000 и два повтора после running; старую формулировку «wait/status нет» убрать",
      "options": ["оставить как было", "обновить документ по письму structure--09"],
      "impact": "internal",
      "evidence": { "kind": "criterion", "ref": "C1" },
      "reversible": true
    }
  ],
  "resultShape": { "artifact": "INSTALL.md, раздел «Ожидание узла графа»; spec/checks/install-wait.mjs c1|c2", "format": "документ+проверка", "criterion": "C1" },
  "securityReview": false,
  "humanSignoff": false,
  "followUps": []
}
-->

## Цель

INSTALL.md перестаёт утверждать, что штатного ожидания узла графа нет: после 0385 у structure есть
`project_graph_wait` с согласованным форматом, и документ обязан совпадать с кодом, а не с прежним состоянием.

## Что не входит

1. Код движка и панели: инструмент живёт у structure (`registerRunTool`), наш пакет его не реализует.
2. Раздел «Длинные прогоны и замеры» про `job.mjs` — остаётся.
3. Правка требований к structure: требование закрыто их заданием.

## Инварианты

1. В INSTALL.md нет утверждений «штатного wait/status нет» и «ждать нечем».
2. Есть имя `project_graph_wait`, формат ответа, значения `running`/`finished`/`unknown`, `waitedMs`, `exitCode`, `tail`.
3. Указаны лимиты: по умолчанию 30000 мс, допустимо 0..60000, большее обрезается до 60000, повтор после `running` — не больше двух раз, дальше `job.mjs`.

## Границы знания

1. Дано: репозиторий пакета, письмо structure--09 и это задание.
2. Менять можно только allowedPaths; проверка `spec/checks/install-wait.mjs` неприкосновенна.
3. Не коммитить, не пушить, не деплоить.

## Среда

- node 25, Windows. Тяжёлые прогоны — сторожем движка.
- Полный набор: `node tools/check-tests.mjs` (документ и проверка — selftest и затронутые тесты).

## Отчёт

1. Что заменено в INSTALL.md.
2. Файлы — полными путями.
3. Каждый критерий — команда, exit код, дословный вердикт.

## Коммит

Кандидата создаёт `task-accept`; коммит — после записи о приёмке.

<!-- CRITERIA:BEGIN -->
## Критерии приёмки

| ID | Проверка | Ожидание |
| --- | --- | --- |
| C1 | `node spec/checks/install-wait.mjs c1` | `INSTALL-WAIT OK c1` (факт описан, старого отрицания нет) |
| C2 | `node spec/checks/install-wait.mjs c2` | `INSTALL-WAIT OK c2` (компаратор отвергает потерю имени инструмента) |
| C3 | `node tools/check-tests.mjs` | exit 0 (selftest и затронутые тесты) |
<!-- CRITERIA:END -->
