#!/usr/bin/env node
/*
 * 2.6.26 (0065): схема живёт на GitHub — CI обязан проверять то же, что проверяем мы.
 *
 * c1: .github/workflows/ci.yml — ubuntu-latest, триггеры push/pull_request, шаги
 *     (check-version, selftest, gate-rules, pipe-free, gate-diagnostics, doctor-legacy-key,
 *     orchestration-doc, e2e) без continue-on-error.
 *
 * Вне пакета — SKIP.
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

function c1() {
  const file = path.join(PKG, ".github", "workflows", "ci.yml");
  if (!fs.existsSync(file)) throw new Error("нет .github/workflows/ci.yml");
  const ci = fs.readFileSync(file, "utf8");
  truthy(/ubuntu-latest/u.test(ci), "CI не на ubuntu-latest");
  truthy(/push:/u.test(ci) && /pull_request:/u.test(ci), "нет триггеров push/pull_request");
  for (const step of ["tools/check-version.mjs", "spec/selftest.mjs", "spec/checks/gate-rules.mjs", "spec/checks/pipe-free.mjs", "spec/checks/gate-diagnostics.mjs", "spec/checks/doctor-legacy-key.mjs", "spec/checks/orchestration-doc.mjs", "spec/e2e.mjs"]) {
    truthy(ci.includes(step), "CI не запускает " + step);
  }
  truthy(!/continue-on-error:\s*true/u.test(ci), "в CI есть continue-on-error: true");
  truthy(/actions\/checkout/u.test(ci) && /actions\/setup-node/u.test(ci), "CI без checkout/setup-node");
  console.log("CICONF OK c1");
}

const table = { c1 };
const which = process.argv[2];
if (!table[which]) {
  console.log("usage: node spec/checks/ci-config.mjs c1");
  process.exit(2);
}
try {
  table[which]();
} catch (error) {
  console.log("CICONF FAIL " + which + ": " + (error && error.message ? error.message : error));
  process.exit(1);
}