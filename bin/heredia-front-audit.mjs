#!/usr/bin/env node
// heredia-front-audit installer — installs the skill for Claude Code and/or Codex and gives them a
// browser (Playwright MCP). No dependencies.
//
//   npx github:Ai-team-testing-grounds/heredia-front-audit                 install for every agent found on this machine
//   npx github:Ai-team-testing-grounds/heredia-front-audit --claude        Claude Code only   (~/.claude/skills/heredia-front-audit)
//   npx github:Ai-team-testing-grounds/heredia-front-audit --codex         Codex only         (~/.agents/skills/heredia-front-audit)
//   npx github:Ai-team-testing-grounds/heredia-front-audit --project       into the current git repo (commit it for your team)
//   npx github:Ai-team-testing-grounds/heredia-front-audit --no-playwright skip registering the Playwright MCP server
//   npx github:Ai-team-testing-grounds/heredia-front-audit uninstall [--claude|--codex] [--project]
//
// From a clone, use `node bin/heredia-front-audit.mjs <same args>`.
import { cpSync, existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, relative, sep } from "node:path";
import { execSync, spawnSync } from "node:child_process";
import { REPO, buildSkillMd, CODEX_OPENAI_YAML } from "../scripts/build.mjs";

const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);
const command = argv.find((a) => !a.startsWith("-")) || "install";
const HOME = process.env.HEREDIA_FRONT_AUDIT_HOME || homedir();
const SRC_SKILL = join(REPO, "skills", "heredia-front-audit");

if (has("-h") || has("--help") || command === "help") {
  console.log(`heredia-front-audit — auditoría E2E de cambios de frontend sin commit, para Claude Code y Codex

Uso: heredia-front-audit [install|uninstall] [--claude] [--codex] [--project] [--no-playwright]

  (sin flags)         instala para cada agente que encuentre en esta máquina y registra Playwright MCP
  --claude            solo Claude Code → ~/.claude/skills/heredia-front-audit   (o <repo>/.claude/skills/heredia-front-audit)
  --codex             solo Codex       → ~/.agents/skills/heredia-front-audit   (o <repo>/.agents/skills/heredia-front-audit)
  --project           instala dentro del repo git actual en vez de tu carpeta personal
  --no-playwright     no registrar el navegador Playwright MCP`);
  process.exit(0);
}

const onPath = (bin) => spawnSync(process.platform === "win32" ? "where" : "which", [bin], { stdio: "ignore" }).status === 0;
const claudeHome = process.env.HEREDIA_FRONT_AUDIT_HOME ? join(HOME, ".claude") : process.env.CLAUDE_CONFIG_DIR || join(HOME, ".claude");
const NAME = { claude: "Claude Code", codex: "Codex" };

let agents = ["claude", "codex"].filter((a) => has(`--${a}`));
if (!agents.length) {
  if (existsSync(claudeHome) || onPath("claude")) agents.push("claude");
  if (existsSync(join(HOME, ".codex")) || existsSync(join(HOME, ".agents")) || onPath("codex")) agents.push("codex");
  if (!agents.length) agents = ["claude", "codex"];
}

let root = null;
if (has("--project")) {
  try {
    root = execSync("git rev-parse --show-toplevel", { stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
  } catch {
    console.error("--project se debe ejecutar dentro de un repositorio git.");
    process.exit(1);
  }
}

const dest = {
  claude: root ? join(root, ".claude", "skills", "heredia-front-audit") : join(claudeHome, "skills", "heredia-front-audit"),
  codex: root ? join(root, ".agents", "skills", "heredia-front-audit") : join(HOME, ".agents", "skills", "heredia-front-audit"),
};

const copyRuntime = (to) => {
  for (const d of ["scripts", "templates"]) cpSync(join(SRC_SKILL, d), join(to, d), { recursive: true });
};

// Registers Playwright MCP for the agent; an existing registration is left as it is.
function addPlaywright(agent) {
  const mcpArgs = agent === "claude"
    ? ["mcp", "add", "--scope", "user", "playwright", "--", "npx", "@playwright/mcp@latest"]
    : ["mcp", "add", "playwright", "--", "npx", "@playwright/mcp@latest"];
  const manual = `${agent} ${mcpArgs.join(" ")}`;
  if (!onPath(agent)) return console.log(`! No encontré '${agent}' en el PATH. Cuando lo instales, ejecuta: ${manual}`);
  const r = spawnSync(agent, mcpArgs, { encoding: "utf8", shell: process.platform === "win32" });
  const out = `${r.stdout || ""}${r.stderr || ""}`;
  if (r.status === 0) console.log(`✓ ${NAME[agent]}: navegador Playwright MCP registrado`);
  else if (/already|exist/i.test(out)) console.log(`✓ ${NAME[agent]}: Playwright MCP ya estaba registrado`);
  else console.log(`! ${NAME[agent]}: no pude registrar Playwright MCP. Ejecútalo a mano: ${manual}\n${out.trim()}`);
}

for (const agent of agents) {
  const to = dest[agent];
  if (command === "uninstall") {
    rmSync(to, { recursive: true, force: true });
    console.log(`✓ ${NAME[agent]}: skill eliminado de ${to}`);
    continue;
  }
  if (command !== "install") {
    console.error(`Comando desconocido "${command}". Prueba con --help.`);
    process.exit(2);
  }

  rmSync(to, { recursive: true, force: true });
  mkdirSync(to, { recursive: true });
  copyRuntime(to);

  if (agent === "claude") {
    cpSync(join(SRC_SKILL, "SKILL.md"), join(to, "SKILL.md"));
    console.log(`✓ Claude Code: instalado /heredia-front-audit → ${to}`);
  } else {
    // Codex has no skill-dir variable, so the path to the bundled scripts is baked in at install time.
    // Project installs use a repo-relative path so the folder works for every teammate who clones it.
    const skillDir = root ? relative(root, to).split(sep).join("/") : to.split(sep).join("/");
    writeFileSync(join(to, "SKILL.md"), buildSkillMd("codex", skillDir));
    mkdirSync(join(to, "agents"), { recursive: true });
    writeFileSync(join(to, "agents", "openai.yaml"), CODEX_OPENAI_YAML);
    console.log(`✓ Codex: instalado $heredia-front-audit → ${to}`);
  }

  if (!has("--no-playwright")) addPlaywright(agent);
}

if (command === "install") {
  console.log(`
Listo. Para usarlo:
  1. Cierra y vuelve a abrir ${agents.map((a) => NAME[a]).join(" / ")}.
  2. Abre la terminal en tu proyecto (con cambios sin commit) y escribe:
${agents.includes("claude") ? "       claude   →  /heredia-front-audit\n" : ""}${agents.includes("codex") ? "       codex    →  $heredia-front-audit\n" : ""}  Si tu app corre en Laragon, XAMPP, MAMP o similar, la primera vez pásale la URL:
       /heredia-front-audit http://mi-proyecto.test
${root ? "\n  Instalación en el proyecto: haz commit de la(s) carpeta(s) nueva(s) para que tu equipo también lo tenga.\n" : ""}`);
}
