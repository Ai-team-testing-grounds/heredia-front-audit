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
for (const f of data.findings) {
  const shot = f.evidence?.screenshot;
  if (!shot) continue;
  const p = isAbsolute(shot) ? shot : join(runDir, shot);
  if (existsSync(p) && MIME[extname(p).toLowerCase()]) {
    f.evidence.screenshotData = `data:${MIME[extname(p).toLowerCase()]};base64,${readFileSync(p).toString("base64")}`;
  } else {
    warnings.push(`${f.id}: screenshot not found at ${p}`);
  }
}

// ---------- fix prompt ----------
const AGENTS = {
  "claude-code": { name: "Claude Code", rerun: "/heredia-front-audit" },
  codex: { name: "Codex", rerun: "$heredia-front-audit" },
};
const agent = AGENTS[data.agent] || { name: "your coding agent", rerun: "/heredia-front-audit (Claude Code) or $heredia-front-audit (Codex)" };
data.agentInfo = agent;
const rel = (p) => relative(repoRoot, p) || p;
const clip = (s, n = 700) => (s && s.length > n ? s.slice(0, n) + " …[truncated]" : s);

function findingChunk(f) {
  const loc = f.location || {};
  const where = [loc.file && `${loc.file}${loc.line ? `:${loc.line}` : ""}`, loc.url && `page ${loc.url}`]
    .filter(Boolean).join(" — ");
  const lines = [`### ${f.id} [${f.severity.toUpperCase()} · ${f.category || "general"}] ${f.title}`];
  if (where) lines.push(`- Where: ${where}`);
  if (f.description) lines.push(`- Problem: ${f.description}`);
  if (f.reproSteps?.length) lines.push(`- Repro: ${f.reproSteps.map((s, i) => `${i + 1}) ${s}`).join(" ")}`);
  if (f.expected) lines.push(`- Expected: ${f.expected}`);
  if (f.actual) lines.push(`- Actual: ${f.actual}`);
  if (f.evidence?.console) lines.push(`- Console: ${clip(f.evidence.console).replace(/\s+/g, " ")}`);
  if (f.fix?.explanation) lines.push(`- Suggested fix: ${f.fix.explanation}`);
  if (f.fix?.snippet) lines.push("```", f.fix.snippet.trimEnd(), "```");
  return lines.join("\n");
}

const header = [
  "You are fixing issues found by an automated end-to-end review (heredia-front-audit) of the uncommitted frontend changes in this repo.",
  "",
  `Repo: ${data.project || "(unknown)"} · Branch: ${data.branch || "?"} @ ${data.commit || "?"}${data.baseUrl ? ` · App: ${data.baseUrl}` : ""}`,
  `Full report data: ${rel(findingsPath)}`,
  "",
  "Work through the findings below in order (most severe first). For each one:",
  "1. Read the referenced code and confirm the root cause before changing anything. If you can't reproduce or confirm it, say so and skip it.",
  "2. Make the smallest correct fix. The suggested fix is a starting point — if you find a better one, use it and explain why.",
  "3. Don't touch unrelated code and don't commit.",
  "",
].join("\n");

const footer = [
  "",
  "When you're done:",
  "- Run the project's type check, lint and unit tests if they exist (see package.json scripts) and fix anything you broke.",
  "- Give me a short table: finding ID → what you changed (file:line) or why you didn't.",
  `- Remind me to run ${agent.rerun} again so the fixes get verified in the browser.`,
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
