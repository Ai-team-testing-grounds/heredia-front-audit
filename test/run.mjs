#!/usr/bin/env node
// Zero-dependency smoke tests: build, context collection, report rendering and installer.
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..");
const SKILL = join(REPO, "skills", "heredia-front-audit");
let failed = 0;
const ok = (cond, msg) => { console.log(`${cond ? "✓" : "✗"} ${msg}`); if (!cond) failed++; };
const node = (args, opts = {}) => spawnSync(process.execPath, args, { encoding: "utf8", ...opts });
const git = (cwd, ...args) => spawnSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", ...args], { cwd, encoding: "utf8" });
const tmp = (name) => mkdtempSync(join(tmpdir(), `heredia-front-audit-${name}-`));

// 1. generated SKILL.md is current
ok(node([join(REPO, "scripts", "build.mjs"), "--check"]).status === 0, "skills/heredia-front-audit/SKILL.md matches src/ (run `npm run build` if this fails)");

// 2. collect-context on a repo with changes
const repo = tmp("repo");
git(repo, "init", "-q");
writeFileSync(join(repo, "package.json"), JSON.stringify({ name: "demo-app", scripts: { dev: "vite" }, devDependencies: { vite: "^7.0.0" } }));
mkdirSync(join(repo, "src"));
writeFileSync(join(repo, "src", "App.tsx"), "export const a = 1;\n");
git(repo, "add", "-A"); git(repo, "commit", "-qm", "init");
writeFileSync(join(repo, "src", "App.tsx"), "export const a = 2;\n");
writeFileSync(join(repo, "src", "Checkout.tsx"), "export const Checkout = () => null;\n");
mkdirSync(join(repo, ".claude", "skills"), { recursive: true });
writeFileSync(join(repo, ".claude", "skills", "x.md"), "tooling, should be ignored");

let r = node([join(SKILL, "scripts", "collect-context.mjs")], { cwd: repo });
ok(r.status === 0, "collect-context exits 0");
ok(r.stdout.includes("Run directory") && r.stdout.includes("src/Checkout.tsx") && r.stdout.includes("-export const a = 1;"), "collect-context shows run dir, untracked files and diff");
ok(!r.stdout.includes(".claude/skills/x.md"), "collect-context ignores tooling folders");
ok(r.stdout.includes("Vite 7.0.0") && r.stdout.includes("npm run dev"), "collect-context reports the detected stack and how to start it");
ok(existsSync(join(repo, ".heredia-front-audit", ".gitignore")), ".heredia-front-audit/ ignores itself");

const clean = tmp("clean");
git(clean, "init", "-q"); writeFileSync(join(clean, "a.txt"), "a"); git(clean, "add", "-A"); git(clean, "commit", "-qm", "init");
r = node([join(SKILL, "scripts", "collect-context.mjs")], { cwd: clean });
ok(r.status === 0 && r.stdout.includes("NO UNCOMMITTED CHANGES"), "collect-context detects a clean tree");

// 3. render the example report
r = node([join(SKILL, "scripts", "render-report.mjs"), join(REPO, "examples", "demo-run", "findings.json"), "--no-open"], { cwd: REPO });
ok(r.status === 0, "render-report renders the example");
const html = existsSync(join(REPO, "examples", "demo-run", "report.html")) ? readFileSync(join(REPO, "examples", "demo-run", "report.html"), "utf8") : "";
ok(html.includes("data:image/png;base64") && !html.includes("/*__HEREDIA_FRONT_AUDIT_DATA__*/null"), "report embeds data and screenshots");
const prompt = readFileSync(join(REPO, "examples", "demo-run", "fix-prompt.md"), "utf8");
ok(prompt.includes("### F2") && !prompt.includes("### F5"), "fix prompt includes actionable findings and skips info");

const runDir = join(repo, ".heredia-front-audit", "runs", "t");
mkdirSync(runDir, { recursive: true });
writeFileSync(join(runDir, "findings.json"), JSON.stringify({ agent: "codex", findings: [{ title: "x", severity: "high", fix: { explanation: "y" } }] }));
r = node([join(SKILL, "scripts", "render-report.mjs"), join(runDir, "findings.json"), "--no-open"]);
ok(r.status === 0 && existsSync(join(repo, ".heredia-front-audit", "latest.html")), "render-report writes .heredia-front-audit/latest.html");
ok(readFileSync(join(runDir, "fix-prompt.md"), "utf8").includes("$heredia-front-audit"), "fix prompt uses the agent's re-run command");
writeFileSync(join(runDir, "findings.json"), "{ not json");
ok(node([join(SKILL, "scripts", "render-report.mjs"), join(runDir, "findings.json"), "--no-open"]).stderr.includes("SCHEMA ERROR"), "render-report reports bad JSON");

// 3b. stack detection works across frameworks
const { detectStack } = await import(pathToFileURL(join(SKILL, "scripts", "detect-stack.mjs")).href);
const fixture = (files) => {
  const d = tmp("stack");
  for (const [f, c] of Object.entries(files)) { mkdirSync(join(d, dirname(f)), { recursive: true }); writeFileSync(join(d, f), c); }
  const result = detectStack([d]);
  rmSync(d, { recursive: true, force: true });
  return result;
};
let st = fixture({ "composer.json": JSON.stringify({ require: { php: "^8.2", "laravel/framework": "^11.0", "livewire/livewire": "^3.0" } }), artisan: "", ".env": "APP_URL=http://my-app.test\n", "package.json": JSON.stringify({ scripts: { dev: "vite" }, devDependencies: { vite: "^5" } }) });
ok(st.stacks.some((s) => s.startsWith("Laravel")) && st.start.some((c) => c.startsWith("php artisan serve")) && st.urls.some((u) => u.startsWith("http://my-app.test")) && st.start.some((c) => c.startsWith("npm run dev")), "detects Laravel + Vite, artisan serve and APP_URL");
st = fixture({ "angular.json": JSON.stringify({ projects: { web: { architect: { serve: { options: { port: 4300 } } } } } }), "package.json": JSON.stringify({ scripts: { start: "ng serve" }, dependencies: { "@angular/core": "^18.0.0" } }) });
ok(st.stacks.some((s) => s.startsWith("Angular")) && st.urls.includes("http://localhost:4300"), "detects Angular and its serve port");
st = fixture({ "public/index.php": "<?php echo 1;" });
ok(st.stacks.includes("PHP (plain)") && st.start.includes("php -S localhost:8000 -t public"), "detects plain PHP");
st = fixture({ "wp-config.php": "<?php", "wp-content/themes/x/style.css": "" });
ok(st.stacks.includes("WordPress"), "detects WordPress");
st = fixture({ "composer.json": JSON.stringify({ require: { "symfony/framework-bundle": "^7.0", "twig/twig": "^3" } }), "bin/console": "", "public/index.php": "" , "docker-compose.yml": "services:\n  web:\n    ports:\n      - \"8081:80\"\n" });
ok(st.stacks.some((s) => s.startsWith("Symfony")) && st.urls.some((u) => u.startsWith("http://localhost:8081")), "detects Symfony + Docker Compose ports");
st = fixture({ "index.html": "<h1>hi</h1>" });
ok(st.stacks.includes("Static HTML/CSS/JS"), "detects a static site");

// 4. installer (user + project)
const home = tmp("home");
const env = { ...process.env, HEREDIA_FRONT_AUDIT_HOME: home };
r = node([join(REPO, "bin", "heredia-front-audit.mjs"), "--claude", "--codex"], { env });
ok(r.status === 0, "installer runs");
const claudeDir = join(home, ".claude", "skills", "heredia-front-audit");
const codexDir = join(home, ".agents", "skills", "heredia-front-audit");
ok(existsSync(join(claudeDir, "SKILL.md")) && existsSync(join(claudeDir, "scripts", "render-report.mjs")), "Claude Code skill installed");
const codexMd = existsSync(join(codexDir, "SKILL.md")) ? readFileSync(join(codexDir, "SKILL.md"), "utf8") : "";
ok(codexMd.startsWith("---\nname: heredia-front-audit\n") && !codexMd.includes("{{") && !codexMd.includes("CLAUDE_SKILL_DIR"), "Codex SKILL.md generated cleanly");
const baked = codexMd.match(/node "(.+?)\/scripts\/collect-context\.mjs"/)?.[1];
ok(baked && existsSync(join(baked, "scripts", "collect-context.mjs")), "Codex SKILL.md points at the installed scripts");
ok(existsSync(join(codexDir, "agents", "openai.yaml")), "Codex agents/openai.yaml written");

r = node([join(REPO, "bin", "heredia-front-audit.mjs"), "--codex", "--claude", "--project"], { cwd: repo, env });
ok(r.status === 0 && readFileSync(join(repo, ".agents", "skills", "heredia-front-audit", "SKILL.md"), "utf8").includes('node ".agents/skills/heredia-front-audit/scripts/collect-context.mjs"'), "project install uses repo-relative paths for Codex");
ok(existsSync(join(repo, ".claude", "skills", "heredia-front-audit", "SKILL.md")), "project install for Claude Code");

r = node([join(REPO, "bin", "heredia-front-audit.mjs"), "uninstall", "--claude", "--codex"], { env });
ok(r.status === 0 && !existsSync(claudeDir) && !existsSync(codexDir), "uninstall removes both");

for (const d of [repo, clean, home]) rmSync(d, { recursive: true, force: true });
console.log(failed ? `\n${failed} check(s) failed` : "\nAll checks passed");
process.exit(failed ? 1 : 0);
