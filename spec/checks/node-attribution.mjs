#!/usr/bin/env node
/*
 * 2.6.29 (0068, WC-43): привязка роли к узлу структуры — машинно видимая.
 *
 * Повод: приёмки 0063-0067 сделал нативный subagent вместо узла judge. Машинные
 * гарантии были на месте (подпись, отдельная сессия), но привязки к узлу не было:
 * в записи нет actor.node, в журнале структуры нет прогона, письма без Node:.
 * Правило должно жить в движке, а не в дисциплине.
 *
 * c1: запись приёмки — attributionGap(record) и схема (actor.node, deviation).
 * c2: контракт — metaAttributionGap(meta): acceptor-субагент без acceptorNode.
 *
 * Вне пакета — SKIP.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PKG = path.resolve(HERE, "..", "..");

if (!fs.existsSync(path.join(PKG, "spec"))) {
  console.log("SKIP: проверка пакета вне пакета");
  process.exit(0);
}

function truthy(value, label) {
  if (!value) throw new Error(label);
}

async function common() {
  return import(pathToFileURL(path.join(PKG, "spec", "scripts", "lib", "common.mjs")).href);
}

function record(patch) {
  return {
    risk: "low",
    actor: { kind: "agent", session: "session-x", attestedBy: "env" },
    ...patch,
  };
}

async function c1() {
  const lib = await common();
  truthy(typeof lib.attributionGap === "function", "в common.mjs нет attributionGap(record)");

  /* узел указан — расхождения нет */
  const ok = lib.attributionGap(record({ actor: { kind: "agent", session: "s", attestedBy: "env", node: "judge" } }));
  truthy(ok === null, "узел указан, а расхождение найдено: " + JSON.stringify(ok));

  /* low без узла и без deviation — предупреждение, не отказ */
  const low = lib.attributionGap(record({}));
  truthy(low && low.level === "warn", "low без узла должен давать warn: " + JSON.stringify(low));
  truthy(/node/iu.test(low.message || ""), "warn не упоминает node: " + JSON.stringify(low));

  /* medium без узла — отказ */
  const medium = lib.attributionGap(record({ risk: "medium" }));
  truthy(medium && medium.level === "error", "medium без узла должен давать error: " + JSON.stringify(medium));

  /* deviation объясняет отсутствие узла — предупреждение с причиной */
  const deviated = lib.attributionGap(record({ risk: "high", deviation: "узел judge недоступен: три отказа подряд" }));
  truthy(deviated && deviated.level === "warn", "deviation должен снимать отказ: " + JSON.stringify(deviated));
  truthy(/judge недоступен/u.test(deviated.message || ""), "в warn нет причины отклонения: " + JSON.stringify(deviated));

  /* схема: новые поля разрешены, лишнее по-прежнему отклоняется */
  const schema = JSON.parse(fs.readFileSync(path.join(PKG, "spec", "templates", "acceptance.schema.json"), "utf8"));
  const actor = schema.properties && schema.properties.actor;
  truthy(actor && actor.properties && actor.properties.node, "в схеме нет actor.node");
  truthy(actor.additionalProperties === false, "actor допускает произвольные поля");
  truthy(schema.properties && schema.properties.deviation, "в схеме нет deviation");
  truthy(schema.properties.deviation.minLength >= 10, "deviation слишком короткий: без причины");
  console.log("NODEATTR OK c1");
}

async function c2() {
  const lib = await common();
  truthy(typeof lib.metaAttributionGap === "function", "в common.mjs нет metaAttributionGap(meta)");
  const base = { id: "0068", risk: "low", executor: "subagent:executor", acceptor: "subagent:judge" };

  const missing = lib.metaAttributionGap(base);
  truthy(missing && missing.level === "warn", "subagent-приёмщик без acceptorNode должен давать warn: " + JSON.stringify(missing));
  truthy(/acceptorNode|deviation/iu.test(missing.message || ""), "warn не подсказывает acceptorNode/deviation: " + JSON.stringify(missing));

  const declared = lib.metaAttributionGap({ ...base, acceptorNode: "judge" });
  truthy(declared === null, "acceptorNode указан, а расхождение найдено: " + JSON.stringify(declared));

  const deviated = lib.metaAttributionGap({ ...base, deviation: "judge недоступен, принимал нативный subagent" });
  truthy(deviated === null, "deviation должен снимать предупреждение: " + JSON.stringify(deviated));

  const human = lib.metaAttributionGap({ ...base, acceptor: "human:owner" });
  truthy(human === null, "не-субагентский приёмщик не требует узла: " + JSON.stringify(human));
  console.log("NODEATTR OK c2");
}

const table = { c1, c2 };
const which = process.argv[2];
if (!table[which]) {
  console.log("usage: node spec/checks/node-attribution.mjs c1|c2");
  process.exit(2);
}
try {
  await table[which]();
} catch (error) {
  console.log("NODEATTR FAIL " + which + ": " + (error && error.message ? error.message : error));
  process.exit(1);
}
