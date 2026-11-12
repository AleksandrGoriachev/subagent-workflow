# Обмен между воркспейсами — диаграмма классов

Источник: `dsh-project-graph/lib/exchange-watch.js` (178 КБ), `lib/digest.js`, `lib/exchange.js`, `lib/boxes.js`, `lib/index.js` (apply).

```mermaid
classDiagram
  direction LR

  class ExchangeWatcher {
    <<factory>> createExchangeWatcher(options)
    roots : string[]
    boxDirs : string[]
    tickMs : number
    seen : Map~file, mtime~
    retried : Map~key, at~
    startErrors : Map~target, reason~
    heartbeatTimer
    +start() disposer
    +startHeartbeat() disposer
    +tick() Promise
    +stop()
  }

  class WakeThrottle {
    <<factory>> createWakeThrottle(options)
    branches : Map~box\0thread, at~
    boxes : Map~box, at[]~
    branchMs = 15min
    boxLimit = 5
    boxWindowMs = 60min
    +allow(box, branch, now, {skipBranch}) Verdict
    +mark(box, branch, now)
  }

  class ExchangeFolders {
    <<module>> declaredExchangeBoxes()
    <<module>> declaredExchangeWorkspaces()
    <<module>> resolveFolderBox()
    <<module>> readExchangeFolders()
    roots : string[]
  }

  class DirectoryScanner {
    <<module>> messageFiles(dirs)
    +scan() file[]
  }

  class Message {
    <<value>> parseMessage(text, file)
    file : string
    from : string
    to : string
    status : request|question|answer|report|ack
    thread : string
    ref : string
    replyTo : string
    subject : string
    at : ISO8601
  }

  class ParticipantRegistry {
    <<module>> participantLabel(root, participants, exchange)
    <<module>> labelRoots(roots, options)
    <<module>> addresseeLabels(to)
    participants : Map~label, root~
  }

  class AddresseeResolver {
    <<internal>>
    liveAgents()
    activityFor(target, now) Map~sessionId, at~
    resolveWakeSpawn(input)
    getSessionController()
    +resolve(message) DeliveryPlan|null
  }

  class AcceptanceGate {
    <<module>> acceptanceByBox(runtime, list)
    +gate(box, to) invited|disconnected|''
  }

  class WakeDecision {
    <<module>> shouldWake(status)
    <<module>> isWakeAnswer(answerRef, addressee)
    <<module>> wakeDecision(letter, context)
    REPLY_WAKE_STATUSES = request, question
    +decide(message, ctx) {wake, cause}
  }

  class DigestBuilder {
    <<module>> buildWakeDigest(letters)
    <<module>> wakeText(items)
    +render(batch) string
  }

  class DeliveryPlan {
    <<value>>
    boxDir : string
    items : Item[]
    text : string
    sent : boolean
    handed : boolean
    target : string
    reason : string
    failure : string
  }

  class HandleChannel {
    <<module>> sendViaHandle(handle, text, {timeoutMs})
    forms : {text} | {text,parts} | {text,content}
    +send() {ok, shape, errors}
  }

  class ControllerChannel {
    <<runtime>> sessionController.prompt(request, signal)
    requestId = exchange:<letter>
    mode = queue
    +prompt(sessionId, text) Promise
  }

  class SpawnChannel {
    <<module>> resolveWakeSpawn()
    +spawn(root, node) childId
  }

  class DecisionsJournal {
    <<module>> noteDecision(row)
    <<module>> noteScan()
    <<module>> readDecisionRows(file)
    <<module>> letterStates(rows)
    <<module>> stateOfLetter(states, file)
    states = scanned|delivered|pending|error
    +write(row)
  }

  class SeenLedger {
    <<module>> readSeenMemory()
    <<module>> writeSeenMemory(map)
    <<module>> recoverFalseSeen()
    +mark(file, mtime)
    +has(file)
  }

  class Heartbeat {
    <<module>> writeHeartbeat()
    <<module>> readHeartbeat()
    <<module>> heartbeatState()
    lastTickAt : ISO
    scanned : number
    producer : 'exchange-watch'
    pid : number
  }

  class Telemetry {
    <<module>> writeTelemetry(event)
    event : string
    fields : object
  }

  class AckMarker {
    <<module>> markAck(roots, runtime, message)
  }

  class DigestDelivery {
    <<module>> deliverExchangeDigest(options)
    throttle = 5min
    digest.json
  }

  class PluginApply {
    <<entry>> lib/index.js apply(ctx, config)
    exchangeWatch : boolean
    exchangeBacklogMs : number
    schedule : boolean
  }

  PluginApply --> ExchangeWatcher : создаёт
  ExchangeWatcher --> DirectoryScanner : тик
  ExchangeWatcher --> Message : parse
  ExchangeWatcher --> ParticipantRegistry
  ExchangeWatcher --> ExchangeFolders
  ExchangeWatcher --> AcceptanceGate
  ExchangeWatcher --> AddresseeResolver
  ExchangeWatcher --> WakeDecision
  ExchangeWatcher --> WakeThrottle
  ExchangeWatcher --> DigestBuilder
  ExchangeWatcher --> DeliveryPlan
  ExchangeWatcher --> DecisionsJournal
  ExchangeWatcher --> SeenLedger
  ExchangeWatcher --> Heartbeat
  ExchangeWatcher --> Telemetry
  ExchangeWatcher --> AckMarker

  DeliveryPlan --> HandleChannel
  DeliveryPlan --> ControllerChannel
  DeliveryPlan --> SpawnChannel

  AddresseeResolver ..> ParticipantRegistry
  AddresseeResolver ..> ControllerChannel
  WakeDecision ..> Message
  WakeThrottle ..> Message : thread key
  DigestDelivery ..> ExchangeWatcher : digest.json
```

## Как читается поток

```
tick()
  ├─ DirectoryScanner.messageFiles(dirs)          → все .md в ящиках
  ├─ Message.parseMessage(text)                   → статус/адресат/ref
  ├─ ParticipantRegistry + ExchangeFolders        → кому принадлежит ящик
  ├─ AcceptanceGate                               → папка принята адресатом?
  ├─ WakeDecision.shouldWake / isWakeAnswer       → будить или skip:no-wake
  ├─ WakeThrottle.allow(box, thread, skipBranch)  → лимиты 15 мин / 5 в час
  ├─ AddresseeResolver.resolve(message)           → DeliveryPlan (handle|controller|spawn)
  │     ├─ HandleChannel.sendViaHandle            → формы {text}|{parts}|{content}
  │     ├─ ControllerChannel.prompt               → сессия адресата (queue)
  │     └─ SpawnChannel.spawn                     → новая сессия (если asleep)
  ├─ DecisionsJournal.write(row)                  → delivered / error / skip:*
  └─ SeenLedger.mark(file) + Heartbeat.write()
```

## Где ломается (наблюдение 12.11)

Письма проходят сканирование и запись `scanned` (счётчик растёт), затем попадают в
`skip:cooldown` **без строки о причине**. Это значит:

1. `AddresseeResolver.resolve(message)` возвращает пустой план (ни handle, ни controller, ни spawn);
2. `DeliveryPlan` не создаётся — следовательно, ни `delivered`, ни `error`, ни `no-handover` не пишутся;
3. `retried` помечает письмо как «попытка была», и следующий проход показывает `skip:cooldown`.

То есть дефект находится на стыке **ParticipantRegistry → AddresseeResolver**, а не в каналах доставки
и не в лимите ветки.
