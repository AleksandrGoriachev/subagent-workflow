# 0213 — сборка структуры больше не теряет поля узла

## Проблема

`buildStructure` собирал узел из whitelist (`id/role/route/brief/agentPreset/mustDifferFrom`).
Поля `prompt`, `x`, `y`, `anchors`, `schedule` **молча терялись** при перезаписи `structure/graph.json`
через панель. Это ломало главный тезис «структура — заменяемые данные»: пересборка стирала
объявления узлов.

## Что сделано (у structure)

| Коммит | Что |
| --- | --- |
| `ad17065` | `buildGraphDocument(draft, aliases)` — сборка с сохранением `prompt/x/y/anchors/schedule`; `buildStructure` использует её |
| `4d28d7a` | контракт 0213 |
| `1e42899` | причины красного совпадают с выводом |
| `a0643e2` | артефакты красного |

## Доказательства

```
task-red --base HEAD: «Красный доказан: 2 из 2»  (red.json: redProven=true)
node docs/tasks/0213/check.mjs c1 → OK c1: поля сохраняются
node docs/tasks/0213/check.mjs c2 → OK c2: круговой прогон зелёный
node --test test/structure-build-lossless.test.mjs → 1/1 pass
```

Тест `test/structure-build-lossless.test.mjs`: узел с `prompt/x/y/anchors/schedule` проходит сборку
без потерь; неизвестное поле `garbage` не протаскивается. Формы полей повторно проверяет `readGraph`
после записи, поэтому мусор не пролезает.

## Замечание

В отличие от 0210/0212, здесь красный прогон получился **честным**: сначала контракт с падающими
критериями, потом код. Это подтверждает, что их процесс работает, если не коммитить реализацию
раньше контракта.
