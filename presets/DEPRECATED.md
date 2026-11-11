# Прототип пресетов узлов — ИСТОЧНИК ТРЕБОВАНИЙ, не код

Статус с 2026-11-11: **устаревает**. Реализация — задача structure **0202** (срок 12.11 18:00):
`nodes[].preset`, `structure/presets/<id>.json` + `lock.json`, валидатор (`preset-missing`,
`preset-hash-mismatch`, `preset-not-immutable`, `preset-gate-bypass`), гейт активации
(`guard.enabled`, `release-receipt --online` в preflight).

Что это означает:

- этот каталог — **требования**, по которым structure пишет свой валидатор; наш код здесь не канон;
- после приёмки 0202 наш `presets/` и проверка `spec/checks/node-presets.mjs` удаляются;
- если поведение вашего валидатора разойдётся с этим прототипом — прав structure, а не прототип;
  расхождение фиксируется в exchange как вопрос, а не правится здесь.

Проверка, пока прототип жив: `node spec/checks/node-presets.mjs --repo .`
