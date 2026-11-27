# Задание 0185. task-accept разложен + отклонение тени 0181 названо (переиздание 0183–0184)

<!-- TASK-META
{
  "id": "0185",
  "version": 1,
  "title": "task-accept.mjs разложен на lib/accept, а расхождение тени 0181 названо в реестре отклонений (selftest зелёный)",
  "risk": "medium",
  "created": "2026-11-27",
  "owner": "координатор",
  "executor": "subagent:executor",
  "acceptor": "subagent:judge",
  "deviation": "корень пакета вне разрешённых корней спавна узла judge (root-not-allowed); приёмку выполняет отдельная сессия узла judge",
  "issuedBy": { "kind": "agent", "session": "session-eceafc45-4b60-4614-abe3-c21aa1a76432", "model": "deepseek-flash" },
  "base": "HEAD",
  "criteria": "criteria.json",
  "allowedPaths": [
    "spec/scripts/task-accept.mjs",
    "spec/scripts/lib/accept/**",
    "docs/shadow-deviations.json",
    "spec/checks/accept-split.mjs",
    "spec/checks/accept-split-0184.mjs",
    "docs/tasks/0185/**"
  ],
  "protectedPaths": [
    "spec/checks/accept-split-0185.mjs",
    "spec/scripts/task-verify.mjs",
    "spec/scripts/task-red.mjs",
    "spec/scripts/task-hash.mjs",
    "spec/scripts/task-lint.mjs",
    "VERSION",
    "package.json"
  ],
  "redAllowDirty": [
    "docs/tasks/0185/**"
  ],
  "hashExclude": [],
  "decisions": [
    {
      "id": "D1",
      "class": "mechanical",
      "question": "Что выносить из CLI приёмки, а что оставить",
      "chosen": "Оркестрация (аргументы, замок, актор, независимость, свежий прогон, запись, кандидат) остаётся в task-accept.mjs; вынесены обслуживающие части: прогресс/fail, createCandidate, validateVerify, engineShadow. ignoredPaths, вызов createCandidate( и signRecord( остаются в CLI — их читают проверки candidate-ignored-delete и contract-discipline",
      "options": ["вынести всё в модули (правка проверок)", "вынести обслуживание, CLI и маркеры совместимости оставить"],
      "impact": "internal",
      "evidence": { "kind": "criterion", "ref": "C2" },
      "reversible": true
    },
    {
      "id": "D2",
      "class": "mechanical",
      "question": "Почему тень 0181 разошлась и как это закрыть",
      "chosen": "Первый verify 0181 упал на C4 (после раскладки common.mjs TOOL стал 0.0.0: engine-version искал VERSION на уровень выше); дефект исправлен, повторный verify зелёный. Журнал append-only, поэтому оба доказательства остались и тень видит конфликт verify exit 0/1. Отклонение называется записью реестра с точной привязкой к трём строкам доказательств",
      "options": ["удалить старую строку журнала (подделка истории)", "назвать отклонение в реестре"],
      "impact": "internal",
      "evidence": { "kind": "criterion", "ref": "C4" },
      "reversible": true
    }
  ],
  "resultShape": { "artifact": "spec/scripts/lib/accept/*.mjs (4 модуля) + тонкий task-accept.mjs + запись реестра отклонений 0181", "format": "код+данные+проверки", "criterion": "C4" },
  "securityReview": false,
  "humanSignoff": false,
  "followUps": ["0183 закрыто: маркер C3 не совпал с кодом", "0184 закрыто: удаляемый файл был объявлен в protectedPaths"]
}
-->

## Цель

CLI приёмки перестаёт быть файлом на 1091 строку, и одновременно закрывается долг: расхождение теневого
движка по 0181 названо в реестре отклонений с точной привязкой к строкам доказательств. Selftest снова
зелёный, потому что отклонение объяснено, а не скрыто.

## Что не входит

1. Изменение поведения приёмки: аргументы, коды выхода, тексты отказов, подпись записи.
2. Вынос оркестрации (аргументы, замок, актор, независимость, запись) — остаётся в CLI.
3. Правка проверок движка и исторических фактов: журнал append-only, старые строки не переписываются.

## Инварианты

1. `node spec/scripts/task-accept.mjs --help` печатает прежнюю подсказку и выходит 0.
2. В task-accept.mjs остаются `export function ignoredPaths` (git ls-files --others --ignored, без check-ignore), вызовы `createCandidate(` и `signRecord(`.
3. Запись реестра привязана ровно к трём строкам доказательств verify 0181; любая новая строка снимает её действие.

## Границы знания

1. Дано: репозиторий пакета и это задание.
2. Менять можно только allowedPaths; проверка `spec/checks/accept-split.mjs` неприкосновенна.
3. Не коммитить, не пушить, не деплоить.

## Среда

- node 25, Windows. Тяжёлые прогоны — сторожем движка (`gate.mjs`, `job.mjs`).
- Полный набор: `node tools/check-tests.mjs`.

## Отчёт

1. Что вынесено и что осталось в CLI; какая запись добавлена в реестр и к каким строкам.
2. Файлы — полными путями.
3. Каждый критерий — команда, exit код, дословный вердикт.

## Коммит

Кандидата создаёт `task-accept`; коммит — после записи о приёмке.

<!-- CRITERIA:BEGIN -->
## Критерии приёмки

| ID | Проверка | Ожидание |
| --- | --- | --- |
| C1 | `node spec/checks/accept-split-0185.mjs c1` | `ACCEPT-SPLIT OK c1` (4 модуля на месте, каждый ≤ 200 строк) |
| C2 | `node spec/checks/accept-split-0185.mjs c2` | `ACCEPT-SPLIT OK c2` (CLI ≤ 900 строк, маркеры совместимости на месте) |
| C3 | `node spec/checks/accept-split-0185.mjs c3` | `ACCEPT-SPLIT OK c3` (компараторы отвергают потерю модуля и маркера) |
| C4 | `node tools/check-tests.mjs` | exit 0 (selftest зелёный, включая SHADOW: отклонение 0181 названо) |
| C5 | `node spec/checks/candidate-ignored-delete.mjs c2` | `CANDIDATE-IGNORED OK c2` (фильтр путей в CLI на месте) |
| C6 | `node -e "…existsSync('spec/checks/accept-split.mjs') || existsSync('spec/checks/accept-split-0184.mjs')…"` | `STALE-CHECK OK` (ложные проверки 0183 и 0184 удалены) |
<!-- CRITERIA:END -->
