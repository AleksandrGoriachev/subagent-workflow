#!/usr/bin/env node
/*
 * 2.6.26 (0065): инструкция для внешних оркестраторов и ADR «процесс vs харнесс».
 *
 * Повод: сторонний оркестратор (0023) собрал наш конвейер по SPEC и собирался
 * «закоммитить кандидата» — то есть сделать шаг, который делает task-accept. Документа
 * для того, кто вызывает движок извне, не было: правила жили в SPEC для исполнителя.
 *
 * c1: docs/EXTERNAL-ORCHESTRATION.md — шаги в порядке, три запрета названы, порядок
 *     доказательств перечислен; docs/adr/0001-process-vs-harness.md — граница с DSH.
 *
 * Вне пакета — SKIP (конвенция deployed-copy).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PKG = path.resolve(HERE, "..", "..");

if (!fs.existsSync(path.join(PKG, "spec"))) {
  console.log("SKIP: проверка пакета вне пакета");
  process.exit(0);
}

function truthy(value, label) {
  if (!value) throw new Error(label);
}

function readDoc(rel) {
  const file = path.join(PKG, rel);
  if (!fs.existsSync(file)) throw new Error("нет файла " + rel);
  return fs.readFileSync(file, "utf8");
}

function c1() {
  const ext = readDoc("docs/EXTERNAL-ORCHESTRATION.md");

  /* Шаги конвейера называются по порядку: контракт -> замок -> красный -> работа -> приёмка -> metadata. */
  const steps = ["task-hash", "task-lint", "task-red", "task-verify", "task-accept"];
  let last = -1;
  for (const step of steps) {
    const at = ext.indexOf(step);
    truthy(at >= 0, "в инструкции нет шага " + step);
    truthy(at > last, "шаг " + step + " упомянут не по порядку");
    last = at;
  }

  /* Три запрета: код, артефакты, ручной acceptance.json. */
  truthy(/не коммит\S*\s+код|код не коммит/iu.test(ext), "не назван запрет коммитить код");
  truthy(/criteria\.lock/iu.test(ext), "не назван артефакт criteria.lock");
  truthy(/acceptance\.json/iu.test(ext), "не назван acceptance.json");
  truthy(/вручную|руками|самостоят/iu.test(ext), "не сказано, что acceptance.json не пишут сами");
  truthy(/кандидат\S*\s+создаёт|создаёт\s+`?task-accept/iu.test(ext), "не сказано, что кандидата создаёт task-accept");

  /* Доказательства: чем приёмщик подтверждает, что работа принята именно эта. */
  for (const token of ["contractCommit", "criteria.lock", "nonce", "attestedBy"]) {
    truthy(ext.includes(token), "не назван признак доказательства " + token);
  }

  const adr = readDoc("docs/adr/0001-process-vs-harness.md");
  truthy(/DSH/u.test(adr), "ADR не упоминает DSH");
  truthy(/\|/u.test(adr), "ADR без таблицы границы");
  truthy(/гарант|attest|подпис/iu.test(adr), "ADR не говорит, что слой гарантирует");
  console.log("ORCHDOC OK c1");
}

const table = { c1 };
const which = process.argv[2];
if (!table[which]) {
  console.log("usage: node spec/checks/orchestration-doc.mjs c1");
  process.exit(2);
}
try {
  table[which]();
} catch (error) {
  console.log("ORCHDOC FAIL " + which + ": " + (error && error.message ? error.message : error));
  process.exit(1);
}
