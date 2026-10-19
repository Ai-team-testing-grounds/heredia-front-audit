#!/usr/bin/env node
// Usage: node render-report.mjs <path/to/findings.json> [--no-open]
// Writes report.html + fix-prompt.md next to findings.json, copies report to .heredia-front-audit/latest.html,
// and opens it in the default browser (skip with --no-open or HEREDIA_FRONT_AUDIT_NO_OPEN=1).
import { readFileSync, writeFileSync, existsSync, copyFileSync } from "node:fs";
import { dirname, join, resolve, relative, extname, isAbsolute, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn, execSync } from "node:child_process";
import { platform } from "node:os";

const here = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const noOpen = args.includes("--no-open") || process.env.HEREDIA_FRONT_AUDIT_NO_OPEN === "1";
const input = args.find((a) => !a.startsWith("--"));
if (!input) {
  console.error("Usage: render-report.mjs <findings.json> [--no-open]");
  process.exit(2);
}

const findingsPath = resolve(input);
const runDir = dirname(findingsPath);
const maybeFrontTestDir = resolve(runDir, "..", "..");
// Normal runs live in <repo>/.heredia-front-audit/runs/<stamp>/; anything else (e.g. examples/) skips latest.html.
const frontTestDir = basename(maybeFrontTestDir) === ".heredia-front-audit" ? maybeFrontTestDir : null;
const repoRoot = frontTestDir ? dirname(frontTestDir) : process.cwd();

// ---------- load + validate ----------
let data;
try {
  data = JSON.parse(readFileSync(findingsPath, "utf8"));
} catch (e) {
  console.error(`SCHEMA ERROR: could not parse ${findingsPath}: ${e.message}`);
  process.exit(1);
}
if (!Array.isArray(data.findings)) {
  console.error('SCHEMA ERROR: "findings" must be an array (use [] when nothing was found).');
  process.exit(1);
}

const SEV = ["critical", "high", "medium", "low", "info"];
const warnings = [];
data.findings.forEach((f, i) => {
  if (!f.id) f.id = `F${i + 1}`;
  if (!f.title) warnings.push(`${f.id}: missing title`);
  f.severity = String(f.severity || "").toLowerCase();
  if (!SEV.includes(f.severity)) {
    warnings.push(`${f.id}: unknown severity "${f.severity}", using "info"`);
    f.severity = "info";
  }
  if (f.severity !== "info" && !f.fix?.explanation) warnings.push(`${f.id}: no fix.explanation`);
});
data.findings.sort((a, b) => SEV.indexOf(a.severity) - SEV.indexOf(b.severity));
data.flowsTested ??= [];
data.changedFiles ??= [];
data.generatedAt ??= new Date().toISOString();

// ---------- embed screenshots ----------
const MIME = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".gif": "image/gif" };
// Sets obj.screenshotData from obj.screenshot (a path relative to the run dir).
function embed(obj, label) {
  if (!obj?.screenshot) return;
  const p = isAbsolute(obj.screenshot) ? obj.screenshot : join(runDir, obj.screenshot);
  if (existsSync(p) && MIME[extname(p).toLowerCase()]) {
    obj.screenshotData = `data:${MIME[extname(p).toLowerCase()]};base64,${readFileSync(p).toString("base64")}`;
  } else {
    warnings.push(`${label}: screenshot not found at ${p}`);
  }
}
data.findings.forEach((f) => embed(f.evidence, f.id));
data.flowsTested.forEach((fl, i) => {
  fl.steps = (Array.isArray(fl.steps) ? fl.steps : []).map((s) => (typeof s === "string" ? { action: s } : s));
  fl.steps.forEach((s, j) => embed(s, `flow "${fl.name || i + 1}" step ${j + 1}`));
});

// ---------- fix prompt ----------
const AGENTS = {
  "claude-code": { name: "Claude Code", rerun: "/heredia-front-audit" },
  codex: { name: "Codex", rerun: "$heredia-front-audit" },
};
const agent = AGENTS[data.agent] || { name: "tu agente de código", rerun: "/heredia-front-audit (Claude Code) o $heredia-front-audit (Codex)" };
data.agentInfo = agent;
const rel = (p) => relative(repoRoot, p) || p;
const clip = (s, n = 700) => (s && s.length > n ? s.slice(0, n) + " …[truncated]" : s);

function findingChunk(f) {
  const loc = f.location || {};
  const where = [loc.file && `${loc.file}${loc.line ? `:${loc.line}` : ""}`, loc.url && `página ${loc.url}`]
    .filter(Boolean).join(" — ");
  const lines = [`### ${f.id} [${f.severity.toUpperCase()} · ${f.category || "general"}] ${f.title}`];
  if (where) lines.push(`- Dónde: ${where}`);
  if (f.description) lines.push(`- Problema: ${f.description}`);
  if (f.reproSteps?.length) lines.push(`- Pasos: ${f.reproSteps.map((s, i) => `${i + 1}) ${s}`).join(" ")}`);
  if (f.expected) lines.push(`- Esperado: ${f.expected}`);
  if (f.actual) lines.push(`- Obtenido: ${f.actual}`);
  if (f.evidence?.console) lines.push(`- Consola: ${clip(f.evidence.console).replace(/\s+/g, " ")}`);
  if (f.fix?.explanation) lines.push(`- Corrección sugerida: ${f.fix.explanation}`);
  if (f.fix?.snippet) lines.push("```", f.fix.snippet.trimEnd(), "```");
  return lines.join("\n");
}

const header = [
  "Vas a corregir problemas encontrados por una auditoría E2E automática (heredia-front-audit) de los cambios de frontend sin commit de este repo.",
  "",
  `Repo: ${data.project || "(desconocido)"} · Rama: ${data.branch || "?"} @ ${data.commit || "?"}${data.baseUrl ? ` · App: ${data.baseUrl}` : ""}`,
  `Datos completos del reporte: ${rel(findingsPath)}`,
  "",
  "Revisa los hallazgos de abajo en orden (los más graves primero). Para cada uno:",
  "1. Lee el código indicado y confirma la causa raíz antes de cambiar nada. Si no puedes reproducirlo o confirmarlo, dilo y pasa al siguiente.",
  "2. Haz la corrección correcta más pequeña. La corrección sugerida es un punto de partida: si encuentras una mejor, úsala y explica por qué.",
  "3. No toques código no relacionado y no hagas commit.",
  "",
].join("\n");

const footer = [
  "",
  "Cuando termines:",
  "- Ejecuta el type check, el lint y los tests del proyecto si existen (revisa los scripts de package.json / composer.json) y corrige lo que hayas roto.",
  "- Dame una tabla corta: ID del hallazgo → qué cambiaste (archivo:línea) o por qué no lo cambiaste.",
  "- Respóndeme en español.",
  `- Recuérdame ejecutar ${agent.rerun} otra vez para verificar las correcciones en el navegador.`,
].join("\n");

data.findings.forEach((f) => (f.promptChunk = findingChunk(f)));
data.prompt = { header, footer };
const fullPrompt = [header, data.findings.filter((f) => f.severity !== "info").map((f) => f.promptChunk).join("\n\n"), footer].join("\n");

// ---------- write ----------
const template = readFileSync(join(here, "..", "templates", "report.html"), "utf8");
const json = JSON.stringify(data).replace(/[<\u2028\u2029]/g, (c) => "\\u" + c.charCodeAt(0).toString(16).padStart(4, "0"));
const html = template.replace("/*__HEREDIA_FRONT_AUDIT_DATA__*/null", json);

const reportPath = join(runDir, "report.html");
writeFileSync(reportPath, html);
writeFileSync(join(runDir, "fix-prompt.md"), fullPrompt + "\n");
const latest = frontTestDir ? join(frontTestDir, "latest.html") : null;
if (latest) try { copyFileSync(reportPath, latest); } catch {}

const counts = SEV.map((s) => `${s}: ${data.findings.filter((f) => f.severity === s).length}`).join(", ");
console.log(`Report:     ${reportPath}`);
if (latest) console.log(`Latest:     ${latest}`);
console.log(`Fix prompt: ${join(runDir, "fix-prompt.md")}`);
console.log(`Findings:   ${counts}`);
warnings.forEach((w) => console.log(`warning: ${w}`));

// ---------- open ----------
if (!noOpen) {
  try {
    const os = platform();
    const isWSL = os === "linux" && /microsoft/i.test(readFileSync("/proc/version", "utf8"));
    let cmd, cmdArgs;
    if (os === "darwin") [cmd, cmdArgs] = ["open", [reportPath]];
    else if (os === "win32") [cmd, cmdArgs] = ["cmd", ["/c", "start", '""', `"${reportPath}"`]];
    else if (isWSL) [cmd, cmdArgs] = ["explorer.exe", [execSync(`wslpath -w "${reportPath}"`).toString().trim()]];
    else [cmd, cmdArgs] = ["xdg-open", [reportPath]];
    const child = spawn(cmd, cmdArgs, { detached: true, stdio: "ignore", windowsVerbatimArguments: os === "win32" });
    child.on("error", () => console.log("(could not open a browser automatically — open the report path above)"));
    child.unref();
  } catch {
    console.log("(could not open a browser automatically — open the report path above)");
  }
}
