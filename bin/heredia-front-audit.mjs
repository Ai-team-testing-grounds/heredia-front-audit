#!/usr/bin/env node
// heredia-front-audit installer — installs the skill for Claude Code and/or Codex. No dependencies.
//
//   npx github:YOUR_GITHUB_USER/heredia-front-audit                 install for every agent found on this machine
//   npx github:YOUR_GITHUB_USER/heredia-front-audit --claude        Claude Code only   (~/.claude/skills/heredia-front-audit)
//   npx github:YOUR_GITHUB_USER/heredia-front-audit --codex         Codex only         (~/.agents/skills/heredia-front-audit)
//   npx github:YOUR_GITHUB_USER/heredia-front-audit --project       into the current git repo (commit it for your team)
//   npx github:YOUR_GITHUB_USER/heredia-front-audit --with-playwright   also register the Playwright MCP server
//   npx github:YOUR_GITHUB_USER/heredia-front-audit uninstall [--claude|--codex] [--project]
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
  console.log(`heredia-front-audit — E2E review of uncommitted frontend changes for Claude Code and Codex

Usage: heredia-front-audit [install|uninstall] [--claude] [--codex] [--project] [--with-playwright]

  (no agent flag)     every agent detected on this machine (both if none detected)
  --claude            Claude Code  → ~/.claude/skills/heredia-front-audit   (or <repo>/.claude/skills/heredia-front-audit)
  --codex             Codex        → ~/.agents/skills/heredia-front-audit   (or <repo>/.agents/skills/heredia-front-audit)
  --project           install into the current git repo instead of your home folder
  --with-playwright   also run "<agent> mcp add playwright -- npx @playwright/mcp@latest"`);
  process.exit(0);
}

const onPath = (bin) => spawnSync(process.platform === "win32" ? "where" : "which", [bin], { stdio: "ignore" }).status === 0;
const claudeHome = process.env.HEREDIA_FRONT_AUDIT_HOME ? join(HOME, ".claude") : process.env.CLAUDE_CONFIG_DIR || join(HOME, ".claude");

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
    console.error("--project must be run inside a git repository.");
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

for (const agent of agents) {
  const to = dest[agent];
  if (command === "uninstall") {
    rmSync(to, { recursive: true, force: true });
    console.log(`✓ Removed ${agent === "claude" ? "Claude Code" : "Codex"} skill from ${to}`);
    continue;
  }
  if (command !== "install") {
    console.error(`Unknown command "${command}". Try --help.`);
    process.exit(2);
  }

  rmSync(to, { recursive: true, force: true });
  mkdirSync(to, { recursive: true });
  copyRuntime(to);

  if (agent === "claude") {
    cpSync(join(SRC_SKILL, "SKILL.md"), join(to, "SKILL.md"));
    console.log(`✓ Claude Code: installed /heredia-front-audit → ${to}`);
  } else {
    // Codex has no skill-dir variable, so the path to the bundled scripts is baked in at install time.
    // Project installs use a repo-relative path so the folder works for every teammate who clones it.
    const skillDir = root ? relative(root, to).split(sep).join("/") : to.split(sep).join("/");
    writeFileSync(join(to, "SKILL.md"), buildSkillMd("codex", skillDir));
    mkdirSync(join(to, "agents"), { recursive: true });
    writeFileSync(join(to, "agents", "openai.yaml"), CODEX_OPENAI_YAML);
    console.log(`✓ Codex: installed $heredia-front-audit → ${to}`);
  }

  if (has("--with-playwright")) {
    const cli = agent === "claude" ? "claude" : "codex";
    const mcpArgs = agent === "claude"
      ? ["mcp", "add", "--scope", "user", "playwright", "--", "npx", "@playwright/mcp@latest"]
      : ["mcp", "add", "playwright", "--", "npx", "@playwright/mcp@latest"];
    if (onPath(cli)) {
      const r = spawnSync(cli, mcpArgs, { stdio: "inherit", shell: process.platform === "win32" });
      console.log(r.status === 0 ? `✓ ${cli}: Playwright MCP registered` : `! ${cli}: could not register Playwright MCP (maybe it already exists)`);
    } else {
      console.log(`! '${cli}' not found on PATH — run later: ${cli} ${mcpArgs.join(" ")}`);
    }
  }
}

if (command === "install") {
  console.log(`
Next steps
${agents.includes("claude") ? `  Claude Code:  give it a browser → start with  claude --chrome   (or add Playwright MCP)
                then, in a repo with uncommitted changes, type  /heredia-front-audit
` : ""}${agents.includes("codex") ? `  Codex:        give it a browser → codex mcp add playwright -- npx @playwright/mcp@latest
                restart Codex, then type  $heredia-front-audit   (or pick it from /skills)
` : ""}${root ? "\n  Project install: commit the new folder(s) so your teammates get the skill too.\n" : ""}`);
}
