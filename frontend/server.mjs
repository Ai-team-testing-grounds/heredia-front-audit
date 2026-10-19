#!/usr/bin/env node
// Static server + in-memory mock API for the demo app. Data resets on restart.
//   node server.mjs [--port 4173]
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { join, extname, normalize, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";

const PUBLIC = join(dirname(fileURLToPath(import.meta.url)), "public");
const portArg = process.argv.indexOf("--port");
const PORT = Number(portArg > -1 ? process.argv[portArg + 1] : process.env.PORT || 4173);
const USER = { email: "demo@example.com", password: "demo1234", name: "Demo User" };
const sessions = new Set();
let nextId = 4;
let tasks = [
  { id: 1, title: "Review the new dashboard", done: true },
  { id: 2, title: "Write release notes", done: false },
  { id: 3, title: "Plan Q4 roadmap", done: false },
];

const MIME = { ".html": "text/html; charset=utf-8", ".css": "text/css", ".js": "text/javascript", ".svg": "image/svg+xml", ".png": "image/png" };
const ROUTES = { "/": "index.html", "/dashboard": "dashboard.html" };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const send = (res, status, body, headers = {}) => {
  res.writeHead(status, { "content-type": "application/json", ...headers });
  res.end(body === undefined ? "" : JSON.stringify(body));
};
const readJson = async (req) => {
  let raw = "";
  for await (const chunk of req) raw += chunk;
  try { return JSON.parse(raw || "{}"); } catch { return null; }
};
const sid = (req) => req.headers.cookie?.match(/(?:^|;\s*)sid=([^;]+)/)?.[1];

async function api(req, res, path) {
  if (path === "/api/login" && req.method === "POST") {
    const body = await readJson(req);
    if (!body?.email || !body?.password) return send(res, 400, { error: "Email and password are required" });
    await sleep(400);
    if (body.email.trim().toLowerCase() !== USER.email || body.password !== USER.password) {
      return send(res, 401, { error: "Invalid email or password" });
    }
    const id = randomUUID();
    sessions.add(id);
    return send(res, 200, { name: USER.name }, { "set-cookie": `sid=${id}; HttpOnly; SameSite=Lax; Path=/` });
  }
  if (!sessions.has(sid(req))) return send(res, 401, { error: "Not signed in" });

  if (path === "/api/logout" && req.method === "POST") {
    sessions.delete(sid(req));
    return send(res, 204, undefined, { "set-cookie": "sid=; Max-Age=0; Path=/" });
  }
  if (path === "/api/me" && req.method === "GET") return send(res, 200, { name: USER.name, email: USER.email });
  if (path === "/api/profile" && req.method === "PUT") {
    const body = await readJson(req);
    const name = String(body?.name ?? "").trim();
    if (!name) return send(res, 400, { error: "Name can't be empty" });
    if (name.length > 60) return send(res, 400, { error: "Name must be 60 characters or fewer" });
    USER.name = name;
    return send(res, 200, { name });
  }
  if (path === "/api/tasks" && req.method === "GET") return send(res, 200, tasks);
  if (path === "/api/tasks" && req.method === "POST") {
    const body = await readJson(req);
    const title = String(body?.title ?? "").trim();
    if (!title) return send(res, 400, { error: "Title is required" });
    await sleep(700); // simulate a slow backend
    const task = { id: nextId++, title, done: false };
    tasks.push(task);
    return send(res, 201, task);
  }
  const m = path.match(/^\/api\/tasks\/(\d+)$/);
  const task = m && tasks.find((t) => t.id === Number(m[1]));
  if (m && !task) return send(res, 404, { error: "Task not found" });
  if (task && req.method === "PATCH") {
    const body = await readJson(req);
    task.done = Boolean(body?.done);
    return send(res, 200, task);
  }
  if (task && req.method === "DELETE") {
    tasks = tasks.filter((t) => t !== task);
    return send(res, 204);
  }
  send(res, 404, { error: "Not found" });
}

createServer(async (req, res) => {
  const path = new URL(req.url, "http://x").pathname;
  try {
    if (path.startsWith("/api/")) return await api(req, res, path);
    const file = normalize(join(PUBLIC, ROUTES[path] ?? path));
    if (!file.startsWith(PUBLIC)) return send(res, 403, { error: "Forbidden" });
    const body = await readFile(file);
    res.writeHead(200, { "content-type": MIME[extname(file)] || "application/octet-stream" });
    res.end(body);
  } catch (e) {
    if (e.code === "ENOENT" || e.code === "EISDIR") return send(res, 404, { error: "Not found" });
    console.error(e);
    send(res, 500, { error: "Server error" });
  }
}).listen(PORT, "127.0.0.1", () => console.log(`Demo app on http://localhost:${PORT}  (login: ${USER.email} / ${USER.password})`));
