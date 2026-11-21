# Задание 0090. 2.6.89: стоп по тишине и витрина метрик

<!-- TASK-META
{
  "id": "0090",
  "version": 1,
  "title": "2.6.89: стоп по тишине вместо часового бюджета; метрики эффективности на доске",
  "risk": "medium",
  "created": "2026-11-21",
  "owner": "координатор",
  "executor": "subagent:coordinator",
  "acceptor": "subagent:judge",
  "issuedBy": { "kind": "agent", "session": "session-ba966ecd-86bd-4412-871e-61d3edf046d5", "model": "deepseek-flash" },
  "base": "HEAD",
  "criteria": "criteria.json",
  "allowedPaths": [
    "plugin/lib/wait-guard.js",
    "plugin/lib/api.js",
    "plugin/lib/client.js",
    "plugin/test/silence-guard.test.mjs",
    "spec/scripts/init.mjs",
    "spec/SPEC.md",
    "tools/launch-metrics.mjs",
    "docs/tasks/0090/**"
  ],
  "protectedPaths": [
    "spec/checks/**",
    "tools/commit.ps1",
    "tools/release.mjs"
  ],
  "redAllowDirty": [
    "docs/tasks/0090/**"
  ],
  "hashExclude": [],
  "decisions": [
    {
      "id": "D1",
      "class": "semantic",
      "question": "Чем ограничивать цикл узла вместо часового бюджета",
      "chosen": "Стоп по тишине: узел может работать сколько нужно, но разрыв между событиями больше enforcement.silenceMs (по умолчанию 10 мин) превращает следующее долгое ожидание в отказ «сдай промежуточный результат». Время как лимит длительности не используется.",
      "options": ["Часовой бюджет nodeBudgetMs (отвергнут заказчиком)", "Стоп по тишине между событиями"],
      "impact": "user-visible",
      "evidence": { "kind": "criterion", "ref": "C1" }
    },
    {
      "id": "D2",
      "class": "mechanical",
      "question": "Как наблюдать эффективность",
      "chosen": "Снимок метрик публикуется в воркспейс (.dsh/workflow/metrics.json) командой launch-metrics --publish; панель читает его через /workflow/api/metrics и показывает вкладкой «Метрики» без тяжёлого пересчёта в браузере.",
      "options": ["Считать метрики в API на каждый запрос", "Публиковать снимок и показывать кэш"],
      "impact": "internal",
      "evidence": { "kind": "criterion", "ref": "C2" }
    }
  ],
  "securityReview": false,
  "humanSignoff": false,
  "followUps": [
    "релиз 2.6.89 отдельной задачей",
    "включить enforcement.silenceMs в workflow.config.json воркспейса и обновить снимок метрик"
  ]
}
-->

## Цель

У цикла узла появляется честный ограничитель — **тишина**, а не длительность: работающий узел не режется
по часам, а зависший (нет событий) теряет право на новое долгое ожидание и обязан сдать промежуточный
результат. Эффективность видна на доске: панель показывает снимок метрик (длинные ходы, петли, killed,
отказы на сессию).

## Что не входит

1. Часовой бюджет `nodeBudgetMs` как политика — остаётся выключенным (решение заказчика).
2. Пересчёт метрик в браузере на каждый запрос — панель читает опубликованный снимок.
3. Правки структуры и чужих плагинов.

## Инварианты

1. Разрыв между событиями больше `enforcement.silenceMs` → следующее долгое ожидание отклоняется с текстом «тишина» и требованием промежуточной сдачи; короткие вызовы проходят.
2. `silenceMs: 0` отключает проверку; отсутствие ключа — профильный дефолт (10 минут).
3. Повтор вызова после отказа (2.6.88) и маршрут `job.mjs` сохраняются.
4. `launch-metrics --publish <корень>` пишет снимок в `<корень>/.dsh/workflow/metrics.json` с полем `generatedAt`.
5. API отдаёт снимок по `/workflow/api/metrics`; панель имеет вкладку «Метрики».

<!-- CRITERIA:BEGIN -->
## Критерии приёмки

| ID | Проверка | Ожидание |
| --- | --- | --- |
| C1 | `node --test --test-name-pattern="тишина" plugin/test/silence-guard.test.mjs` | PASS: отказ по тишине |
| C2 | `node tools/launch-metrics.mjs --publish .tmp/metrics-publish-test` | exit 0, файл `.dsh/workflow/metrics.json` создан |
| C3 | `node -e "const s=require('fs').readFileSync('plugin/lib/api.js','utf8');process.exit(s.includes('/api/metrics')?0:1)"` | exit 0 |
| C4 | `node -e "const s=require('fs').readFileSync('plugin/lib/client.js','utf8');process.exit(s.includes('Метрики')?0:1)"` | exit 0 |
| C5 | `node plugin/tools/test.mjs` | exit 0 |
| C6 | `node spec/selftest.mjs` | `SELFTEST OK` |
<!-- CRITERIA:END -->
