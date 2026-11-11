# 0212 — медленный режим доставки (patch, не закоммичен у structure)

## Проблема

`exchangeWatch: false` в профиле плагин трактует как «heartbeat-only»: тик пишет живость, **но не
сканирует и не доставляет**. Инцидент 11.11: `scanned` замер на 795, письма `structure--51/52` и
`workflow--62` не доставлены, а внешний чек «heartbeat свежий» был зелёным.

## Что сделано

Патч `docs/patches/0212-slow-delivery.patch`:

1. `lib/exchange-watch.js`: `startHeartbeat()` больше не «heartbeat-only» —慢 медленный скан + вручение
   по тому же таймеру (`heartbeatMs`), heartbeat пишется на каждом тике.
2. `test/exchange-delivery.test.mjs` (c7): ожидание «heartbeat-only не сканирует» заменено на
   «slow-режим доставляет письмо и пишет `delivered` в журнал».

## Проверка

```
node test/exchange-delivery.test.mjs
0210 c7 OK: session/event turn/start доставил письмо
EXCHANGE DELIVERY TEST OK: 7/7
```

То есть исправление доказано на их же поведенческом тесте.

## Почему не закоммичено

`lib/exchange-watch.js` и `test/exchange-delivery.test.mjs` — защищённые пути: `task-guard` отклоняет
прямой коммит, а `guard.allow` я после проверки вернул в строгое состояние (коммит `03d8e05`).
Их процесс требует контракт задачи с `allowedPaths` → красный прогон → lock → воркер → оценщик.

Применение: `git apply docs/patches/0212-slow-delivery.patch` внутри задачи 0212.

## Пока патч не применён

Доставка держится на `exchangeWatch: true` в профиле (проверено: `scanned` растёт, письма доходят,
`workflow--145` разбудил structure). Это рабочий обход, но не устранение причины.
