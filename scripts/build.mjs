#!/usr/bin/env node
// Builds SKILL.md for each agent from the shared workflow in src/.
//   node scripts/build.mjs          -> regenerates skills/heredia-front-audit/SKILL.md (Claude Code / plugin)
//   node scripts/build.mjs --check  -> exits 1 if the committed SKILL.md is out of date (used by tests/CI)
// The Codex SKILL.md is generated at install time by bin/heredia-front-audit.mjs, because it needs the real install path.
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const REPO = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(REPO, p), "utf8");

const BROWSER = {
  "claude-code": `Use the first one that is available in this session:

1. **Claude in Chrome** — tools named \`mcp__claude-in-chrome__*\` (session started with
   \`claude --chrome\`, or Chrome enabled by default via \`/chrome\`). Best for apps behind a login,
   since it uses the user's real Chrome sessions. Always work in a new tab.
2. **Playwright MCP** — tools named \`mcp__playwright__browser_*\`. Best for repeatable,
   headless, isolated runs.
3. Any other browser automation tool you have.

Setup line for the info finding if none is available: \`claude --chrome\`, or
\`claude mcp add --scope user playwright -- npx @playwright/mcp@latest\`.`,

  codex: `Use the browser automation tools available in this session, in this order:

1. **Playwright MCP** — the \`playwright\` MCP server's tools (\`browser_navigate\`,
   \`browser_snapshot\`, \`browser_click\`, \`browser_type\`, \`browser_console_messages\`,
   \`browser_network_requests\`, \`browser_take_screenshot\`, \`browser_resize\`, …).
2. The Codex app's own browser (\`@Browser\`, best for localhost) or its Chrome extension,
   if this session runs in the Codex desktop app and the Playwright tools are missing.
3. Any other browser automation tool you have.

The dev server is on localhost; if the sandbox blocks a command that starts it or reaches
it, ask the user to approve it rather than giving up.

Setup line for the info finding if none is available:
\`codex mcp add playwright -- npx @playwright/mcp@latest\`.`,
};

const AGENT = {
  "claude-code": { name: "Claude Code", rerun: "/heredia-front-audit", args: "see User arguments above", header: "src/claude-code.md", skillDir: "${CLAUDE_SKILL_DIR}" },
  codex: { name: "Codex", rerun: "$heredia-front-audit", args: "in the message that invoked `$heredia-front-audit`", header: "src/codex.md" },
};

export function buildSkillMd(agent, skillDir) {
  const a = AGENT[agent];
  if (!a) throw new Error(`unknown agent ${agent}`);
  const dir = skillDir ?? a.skillDir;
  if (!dir) throw new Error(`${agent} needs an install path`);
  const workflow = read("src/workflow.md")
    .replaceAll("{{BROWSER}}", () => BROWSER[agent])
    .replaceAll("{{ARGS}}", () => a.args)
    .replaceAll("{{AGENT_ID}}", () => agent)
    .replaceAll("{{AGENT_NAME}}", () => a.name)
    .replaceAll("{{RERUN}}", () => a.rerun);
  return read(a.header).replace("{{WORKFLOW}}", () => workflow.trimEnd()).replaceAll("{{SKILL_DIR}}", () => dir).trimEnd() + "\n";
}

export const CODEX_OPENAI_YAML = `interface:
  display_name: "Heredia Front Audit"
  short_description: "Audita en un navegador real los cambios de frontend sin commit"
  default_prompt: "Ejecuta $heredia-front-audit sobre mis cambios de frontend sin commit"
policy:
  allow_implicit_invocation: false
`;

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const target = join(REPO, "skills/heredia-front-audit/SKILL.md");
  const built = buildSkillMd("claude-code");
  if (process.argv.includes("--check")) {
    let current = "";
    try { current = readFileSync(target, "utf8"); } catch {}
    if (current !== built) {
      console.error("skills/heredia-front-audit/SKILL.md is out of date — run `npm run build` and commit the result.");
      process.exit(1);
    }
    console.log("SKILL.md is up to date.");
  } else {
    writeFileSync(target, built);
    console.log(`wrote ${target}`);
  }
}
