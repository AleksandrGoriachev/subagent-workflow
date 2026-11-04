#!/usr/bin/env node
/*
 * 2.6.28 (0067): движок обновляется из релиза GitHub штатной кнопкой панели.
 *
 * Повод: у внешнего харнесса панель писала «установлена 2.6.21, будет установлена
 * 2.6.21» — available берётся из vendor/spec установленного плагина, и обновление
 * движка ничего не делало. Пользователь не должен искать обходные пути: кнопка
 * обязана уметь сходить в релиз и поставить свежий движок.
 *
 * c1: разбор архива и релиза (без сети): extractTarGz, sha256, parseLatestRelease,
 *     pickEngineAssets.
 * c2: маршрут /api/update с source: "release" на локальном HTTP-сервере:
 *     скачивает tarball, сверяет sha256, распаковывает, ставит движок 9.9.9.
 *
 * Вне пакета — SKIP.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import zlib from "node:zlib";
import crypto from "node:crypto";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PKG = path.resolve(HERE, "..", "..");
const PLUGIN = path.join(PKG, "plugin");

if (!fs.existsSync(path.join(PKG, "spec"))) {
  console.log("SKIP: проверка пакета вне пакета");
  process.exit(0);
}

function truthy(value, label) {
  if (!value) throw new Error(label);
}

/* ---------- tar writer для фикстуры ---------- */
function tarHeader(name, size) {
  const buf = Buffer.alloc(512);
  buf.write(name, 0, 100, "utf8");
  buf.write("0000644\0", 100, 8, "utf8");
  buf.write("0000000\0", 108, 8, "utf8");
  buf.write("0000000\0", 116, 8, "utf8");
  buf.write(size.toString(8).padStart(11, "0") + "\0", 124, 12, "utf8");
  buf.write("00000000000\0", 136, 12, "utf8");
  buf.write("        ", 148, 8, "utf8");
  buf.write("0", 156, 1, "utf8");
  buf.write("ustar\0", 257, 6, "utf8");
  buf.write("00", 263, 2, "utf8");
  let sum = 0;
  for (const byte of buf) sum += byte;
  buf.write(sum.toString(8).padStart(6, "0") + "\0 ", 148, 8, "utf8");
  return buf;
}
function makeTarGz(files) {
  const chunks = [];
  for (const [name, content] of files) {
    const data = Buffer.isBuffer(content) ? content : Buffer.from(String(content), "utf8");
    chunks.push(tarHeader(name, data.length));
    chunks.push(data);
    const pad = (512 - (data.length % 512)) % 512;
    if (pad) chunks.push(Buffer.alloc(pad));
  }
  chunks.push(Buffer.alloc(1024));
  return zlib.gzipSync(Buffer.concat(chunks));
}
function sha256(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

/* Спека пакета + VERSION с подменённой версией — движок для фикстуры релиза. */
function engineTarball(version) {
  const files = [];
  const walk = (dir, rel) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const abs = path.join(dir, entry.name);
      const next = rel ? rel + "/" + entry.name : entry.name;
      if (entry.isDirectory()) walk(abs, next);
      else if (entry.isFile()) files.push([next, fs.readFileSync(abs)]);
    }
  };
  walk(path.join(PKG, "spec"), "spec");
  files.push(["VERSION", version + "\n"]);
  const prefix = "subagent-workflow-" + version + "/";
  return makeTarGz(files.map(([name, content]) => [prefix + name, content]));
}

/* ---------- c1: чистая часть ---------- */
async function c1() {
  const archive = await import(pathToFileURL(path.join(PLUGIN, "lib", "archive.mjs")).href);
  const source = await import(pathToFileURL(path.join(PLUGIN, "lib", "release-source.mjs")).href);
  const tgz = makeTarGz([["a/one.txt", "one"], ["a/two.txt", "two\n"]]);
  const files = archive.extractTarGz(tgz);
  truthy(files instanceof Map, "extractTarGz должен вернуть Map");
  truthy(files.get("a/one.txt") && files.get("a/one.txt").toString("utf8") === "one", "extractTarGz не восстановил a/one.txt");
  truthy(files.get("a/two.txt") && files.get("a/two.txt").toString("utf8") === "two\n", "extractTarGz не восстановил a/two.txt");
  truthy(archive.sha256Hex(Buffer.from("x")) === sha256(Buffer.from("x")), "sha256Hex расходится с эталоном");

  const release = {
    tag_name: "v9.9.9",
    assets: [
      { name: "subagent-workflow-9.9.9.tar.gz", browser_download_url: "http://h/dl/engine.tgz" },
      { name: "subagent-workflow-9.9.9.tar.gz.sha256", browser_download_url: "http://h/dl/engine.tgz.sha256" },
      { name: "dsh-workflow-console.tgz", browser_download_url: "http://h/dl/plugin.tgz" },
    ],
  };
  const parsed = source.parseLatestRelease(release);
  truthy(parsed.version === "9.9.9", "версия релиза разобрана неверно: " + parsed.version);
  truthy(parsed.tarballUrl === "http://h/dl/engine.tgz", "не выбран tarball движка");
  truthy(parsed.sha256Url === "http://h/dl/engine.tgz.sha256", "не выбран файл sha256");
  console.log("RELEASEUPDATE OK c1");
}

/* ---------- c2: маршрут обновления из релиза ---------- */
function makeRequest(url, options = {}) {
  const headers = options.headers !== undefined
    ? options.headers
    : (options.body === undefined ? {} : { "content-type": "application/json" });
  const request = {
    method: options.method || "GET",
    url,
    headers,
    socket: { remoteAddress: "127.0.0.1" },
  };
  if (options.body !== undefined) {
    const text = typeof options.body === "string" ? options.body : JSON.stringify(options.body);
    const listeners = { data: [], end: [], error: [] };
    request.on = (event, fn) => { (listeners[event] || listeners.data).push(fn); return request; };
    queueMicrotask(() => {
      for (const fn of listeners.data) fn(Buffer.from(text, "utf8"));
      for (const fn of listeners.end) fn();
    });
  }
  return request;
}
function makeResponse() {
  return {
    statusCode: 200, headers: {}, writableEnded: false, body: "",
    setHeader(key, value) { this.headers[String(key).toLowerCase()] = value; },
    end(body) { this.body = body === undefined ? "" : String(body); this.writableEnded = true; },
  };
}
async function call(handler, url, options = {}) {
  const res = makeResponse();
  await handler(makeRequest(url, options), res);
  let json = null;
  try { json = JSON.parse(res.body); } catch { json = null; }
  return { status: res.statusCode, json, text: res.body };
}

async function c2() {
  const api = await import(pathToFileURL(path.join(PLUGIN, "lib", "api.js")).href);
  const fixtureModule = await import(pathToFileURL(path.join(PLUGIN, "test", "fixture.mjs")).href);
  const engine = engineTarball("9.9.9");
  const engineSha = sha256(engine);
  const server = http.createServer((req, res) => {
    const url = String(req.url || "");
    if (url === "/repos/test/engine/releases/latest") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({
        tag_name: "v9.9.9",
        assets: [
          { name: "subagent-workflow-9.9.9.tar.gz", browser_download_url: baseUrl() + "/dl/engine.tgz" },
          { name: "subagent-workflow-9.9.9.tar.gz.sha256", browser_download_url: baseUrl() + "/dl/engine.tgz.sha256" },
        ],
      }));
      return;
    }
    if (url === "/dl/engine.tgz") { res.writeHead(200, { "content-type": "application/gzip" }); res.end(engine); return; }
    if (url === "/dl/engine.tgz.sha256") { res.writeHead(200, { "content-type": "text/plain" }); res.end(engineSha + "  engine.tgz\n"); return; }
    res.writeHead(404); res.end("not found");
  });
  let base = "";
  const baseUrl = () => base;
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = "http://127.0.0.1:" + server.address().port;
  const fixture = fixtureModule.makeRepo({ stage: "remarks" });
  try {
    const runtime = api.createWorkflowRuntime({
      roots: [fixture.repo],
      updateSource: { apiBase: base, repo: "test/engine" },
    });
    const handler = api.createWebHandler(runtime);
    const response = await call(handler, "/workflow/api/update", {
      method: "POST",
      body: { root: fixture.repo, confirm: true, source: "release", allowInProgress: true },
    });
    truthy(response.status === 200, "обновление из релиза: HTTP " + response.status + " " + response.text.slice(0, 300));
    truthy(response.json && response.json.ok === true, "ответ без ok: " + response.text.slice(0, 300));
    truthy(response.json.targetVersion === "9.9.9", "targetVersion=" + (response.json && response.json.targetVersion));
    const versionFile = path.join(fixture.repo, "docs", "subagent-workflow", "VERSION");
    truthy(fs.existsSync(versionFile), "VERSION не создан после обновления");
    truthy(fs.readFileSync(versionFile, "utf8").trim() === "9.9.9", "VERSION=" + fs.readFileSync(versionFile, "utf8").trim());
    truthy(fs.existsSync(path.join(fixture.repo, "docs", "subagent-workflow", "scripts", "task-red.mjs")), "движок не развёрнут");
  } finally {
    fixture.cleanup();
    await new Promise((resolve) => server.close(resolve));
  }
  console.log("RELEASEUPDATE OK c2");
}

const table = { c1, c2 };
const which = process.argv[2];
if (!table[which]) {
  console.log("usage: node spec/checks/release-update.mjs c1|c2");
  process.exit(2);
}
try {
  await table[which]();
} catch (error) {
  console.log("RELEASEUPDATE FAIL " + which + ": " + (error && error.message ? error.message : error));
  process.exit(1);
}
