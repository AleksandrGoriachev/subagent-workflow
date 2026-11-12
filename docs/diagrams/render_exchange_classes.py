# -*- coding: utf-8 -*-
"""Диаграмма классов обмена (exchange-watch) -> PNG. Только PIL."""
from PIL import Image, ImageDraw, ImageFont
import os, math

W, H = 2300, 1080
img = Image.new("RGB", (W, H), "#ffffff")
d = ImageDraw.Draw(img)

def f(sz, bold=False):
    try:
        return ImageFont.truetype("C:/Windows/Fonts/arialbd.ttf" if bold else "C:/Windows/Fonts/arial.ttf", sz)
    except Exception:
        return ImageFont.load_default()

HDR = "#d6e4f5"; LINE = "#2b6cb0"; FILL = "#eaf2fb"; FILL2 = "#f7f9fc"
TXT = "#1a202c"; EDGE = "#4a5568"; TITLE = "#0f3057"

def box(x, y, w, h, title, stereo, items, fill=FILL):
    d.rounded_rectangle([x, y, x + w, y + h], radius=9, fill=fill, outline=LINE, width=2)
    d.rectangle([x + 1, y + 1, x + w - 1, y + 28], fill=HDR)
    d.text((x + 8, y + 6), title, font=f(14, True), fill=TITLE)
    yy = y + 33
    if stereo:
        d.text((x + 8, yy), stereo, font=f(10), fill="#5a6b85")
        yy += 15
    for it in items:
        d.text((x + 8, yy), it, font=f(10), fill=TXT)
        yy += 15

def poly(points, label=None, lx=0, ly=0):
    for i in range(len(points) - 1):
        d.line([points[i], points[i + 1]], fill=EDGE, width=2)
    (x1, y1), (x2, y2) = points[-2], points[-1]
    ang = math.atan2(y2 - y1, x2 - x1)
    L = 9
    d.polygon([(x2, y2),
               (x2 - L * math.cos(ang - 0.45), y2 - L * math.sin(ang - 0.45)),
               (x2 - L * math.cos(ang + 0.45), y2 - L * math.sin(ang + 0.45))], fill=EDGE)
    if label:
        d.text((lx, ly), label, font=f(10), fill=EDGE)

# PluginApply
box(940, 15, 420, 62, "PluginApply", "<<entry>> lib/index.js", ["apply(ctx, config); exchangeWatch, backlogMs"])
poly([(1150, 77), (1150, 118)], "создаёт", 1160, 88)

# ExchangeWatcher
box(120, 120, 1960, 140, "ExchangeWatcher", "<<factory>> createExchangeWatcher(options)", [
    "roots[], boxDirs[], tickMs, seen Map(file->mtime), retried Map(key->at), startErrors Map",
    "start() / startHeartbeat() -> disposer      tick(): scan -> decide -> deliver      stop()",
    "журнал: exchange-decisions.jsonl     память: exchange-seen.json     живость: exchange-watch.json",
])

mods = [
    ("DirectoryScanner", "messageFiles(dirs)"),
    ("Message", "parseMessage(text, file)"),
    ("ParticipantRegistry", "participantLabel()"),
    ("ExchangeFolders", "declaredExchangeBoxes()"),
    ("AcceptanceGate", "acceptanceByBox()"),
    ("WakeDecision", "shouldWake(), isWakeAnswer()"),
    ("WakeThrottle", "allow(box, thread, skipBranch)"),
    ("DigestBuilder", "buildWakeDigest()"),
]
xs = []
for i, (t, s) in enumerate(mods):
    x = 130 + i * 260
    box(x, 330, 240, 96, t, "<<module>>", [s])
    xs.append(x + 120)
    poly([(xs[-1], 260), (xs[-1], 328)])

# resolver / plan / journal
box(300, 560, 380, 110, "AddresseeResolver", "<<internal>>", ["liveAgents(); activityFor(target)", "resolve(message) -> DeliveryPlan"])
box(820, 560, 380, 110, "DeliveryPlan", "<<value>>", ["items, text; sent, handed", "target, reason, failure"])
box(1340, 560, 380, 110, "DecisionsJournal", "<<module>>", ["noteDecision(row)", "scanned | delivered | pending | error"])

poly([(120, 190), (60, 190), (60, 615), (298, 615)], "resolve()", 68, 545)
poly([(680, 615), (818, 615)], "план", 735, 596)
poly([(2080, 190), (2210, 190), (2210, 615), (1722, 615)], "журнал решений", 2215, 430)

# channels
box(330, 730, 300, 96, "HandleChannel", "<<module>> sendViaHandle", ["text | parts | content", "-> Attempt(ok, shape, errors)"])
box(830, 730, 300, 96, "ControllerChannel", "<<runtime>> sessionController", ["prompt(request, signal)", "mode: queue"])
box(1330, 730, 300, 96, "SpawnChannel", "<<module>> resolveWakeSpawn", ["spawn(root, node)"])
for (cx, label) in [(480, "handle"), (980, "controller"), (1480, "spawn")]:
    poly([(1000, 670), (cx, 728)], label, cx - 90, 690)

# infra
infra = [("SeenLedger", "mark(file, mtime)"), ("Heartbeat", "lastTickAt, scanned, pid"),
         ("Telemetry", "writeTelemetry(event)"), ("AckMarker", "markAck(roots, message)"),
         ("DigestDelivery", "deliverExchangeDigest()")]
for i, (t, s) in enumerate(infra):
    x = 180 + i * 370
    box(x, 890, 340, 90, t, "<<module>>", [s])
poly([(2200, 190), (2250, 190), (2250, 935), (2000, 935)], "seen / heartbeat / telemetry", 2050, 700)

d.text((60, 1010), "Источник: dsh-project-graph/lib/exchange-watch.js, digest.js, exchange.js, boxes.js, index.js", font=f(12), fill="#4a5568")
d.text((60, 1030), "Дефект 12.11: resolve() возвращает пустой план -> skip:cooldown без причины; ни delivered, ни error, ни no-handover", font=f(12), fill="#b83232")

out = os.path.join(os.path.dirname(os.path.abspath(__file__)), "exchange-classes.png")
img.save(out)
print("OK", out, img.size)
