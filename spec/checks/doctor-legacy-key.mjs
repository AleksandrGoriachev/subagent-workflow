#!/usr/bin/env node
/*
 * 2.6.25 (0064, WC-45): правило имени ключа — только для активных пинов.
 *
 * Вопрос structure (письмо --145 §4): doctor даёт FAIL «ключи: kind совпадает с
 * префиксом — stable». Ключ `stable` (kind agent) закреплён для ИСТОРИИ: им подписаны
 * 8 записей приёмки, переименовать его нельзя — записи перестанут резолвиться.
 * Отзыв ключа (`revokedAt`) в движке поддержан: task-accept отказывает отозванному,
 * task-check-acceptance пропускает записи, принятые до отзыва. Значит правило имени
 * должно применяться к активным пинам: отозванный legacy — документированное исключение,
 * а не дефект.
 *
 * c1: отозванный legacy-пин не валит doctor; активный пин с тем же дефектом — валит.
 *
 * Вне пакета — SKIP (конвенция deployed-copy).
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { spawnSyncPipeFree } from '../scripts/lib/common.mjs';
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
function copyTree(from, to) {
  fs.mkdirSync(to, { recursive: true });
  for (const e of fs.readdirSync(from, { withFileTypes: true })) {
    const s = path.join(from, e.name), t = path.join(to, e.name);
    if (e.isDirectory()) copyTree(s, t); else if (e.isFile()) fs.copyFileSync(s, t);
  }
}
function makeKey() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519");
  return {
    publicKeyPem: publicKey.export({ type: "spki", format: "pem" }).toString(),
    privateKeyPem: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
  };
}
function makeRepo(pins) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "wf-doctor-legacy-"));
  const repoDir = path.join(root, "repo");
  const home = path.join(root, "home");
  const engine = path.join(repoDir, "docs", "subagent-workflow");
  for (const dir of ["scripts", "templates"]) copyTree(path.join(PKG, "spec", dir), path.join(engine, dir));
  fs.copyFileSync(path.join(PKG, "spec", "SPEC.md"), path.join(engine, "SPEC.md"));
  fs.copyFileSync(path.join(PKG, "VERSION"), path.join(engine, "VERSION"));
  fs.mkdirSync(path.join(repoDir, "docs", "tasks"), { recursive: true });
  fs.writeFileSync(path.join(engine, "workflow.config.json"),
    JSON.stringify({ tasksDir: "docs/tasks", keysFile: "docs/subagent-workflow/acceptors.json" }, null, 2), "utf8");
  fs.mkdirSync(path.join(home, ".wf-keys"), { recursive: true });
  const judge = makeKey();
  const acceptors = pins.map((pin) => {
    const key = pin.keyId === "agent-judge" ? judge : makeKey();
    const entry = {
      keyId: pin.keyId, kind: pin.kind, owner: "acceptor", publicKeyPem: key.publicKeyPem,
      createdAt: "2026-10-20T00:00:00.000Z",
    };
    if (pin.revokedAt) entry.revokedAt = pin.revokedAt;
    return entry;
  });
  fs.writeFileSync(path.join(engine, "acceptors.json"), JSON.stringify({ acceptors }, null, 2), "utf8");
  fs.writeFileSync(path.join(home, ".wf-keys", "agent-judge.key.pem"), judge.privateKeyPem, "utf8");
  spawnSyncPipeFree("git", ["init", "-q"], { cwd: repoDir });
  return { root, repoDir, home, engine };
}
function runDoctor(ctx) {
  const r = spawnSyncPipeFree(process.execPath, [path.join(ctx.engine, "scripts", "doctor.mjs"), "--repo", ctx.repoDir], {
    cwd: ctx.repoDir, encoding: "utf8", timeout: 300000,
    env: { ...process.env, HOME: ctx.home, USERPROFILE: ctx.home, DSH_SESSION_ID: "session-doctor-legacy-test" },
  });
  return { code: r.status, out: String(r.stdout || "") + String(r.stderr || "") };
}

function c1() {
  const legacy = makeRepo([
    { keyId: "agent-judge", kind: "agent" },
    { keyId: "stable", kind: "agent", revokedAt: "2026-11-04T00:00:00.000Z" },
  ]);
  try {
    const got = runDoctor(legacy);
    const line = got.out.split(/\r?\n/).find((l) => /kind совпадает с префиксом/u.test(l)) || "";
    truthy(!/FAIL/u.test(line), "doctor валит отозванный legacy-ключ: " + line.trim());
    truthy(got.code === 0, "doctor exit " + got.code + " при отозванном legacy-ключе: " + got.out.trim().slice(-300));
  } finally { fs.rmSync(legacy.root, { recursive: true, force: true }); }

  const active = makeRepo([
    { keyId: "agent-judge", kind: "agent" },
    { keyId: "weird", kind: "agent" },
  ]);
  try {
    const got = runDoctor(active);
    truthy(got.code !== 0, "doctor не заметил активный ключ без префикса");
    const line = got.out.split(/\r?\n/).find((l) => /kind совпадает с префиксом/u.test(l)) || "";
    truthy(/FAIL/u.test(line) && /weird/u.test(line), "нет FAIL с именем weird: " + line.trim());
  } finally { fs.rmSync(active.root, { recursive: true, force: true }); }

  console.log("DOCTORLEGACY OK c1");
}

const table = { c1 };
const which = process.argv[2];
if (!table[which]) {
  console.log("usage: node spec/checks/doctor-legacy-key.mjs c1");
  process.exit(2);
}
try {
  table[which]();
} catch (error) {
  console.log("DOCTORLEGACY FAIL " + which + ": " + (error && error.message ? error.message : error));
  process.exit(1);
}
