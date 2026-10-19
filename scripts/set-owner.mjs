#!/usr/bin/env node
// One-time setup before publishing: replaces YOUR_GITHUB_USER / YOUR_NAME placeholders.
//   node scripts/set-owner.mjs <github-user-or-org> "<Your Name>"
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { REPO } from "./build.mjs";

const [user, name] = process.argv.slice(2);
if (!user || !name) {
  console.error('Usage: node scripts/set-owner.mjs <github-user-or-org> "<Your Name>"');
  process.exit(2);
}
const files = ["README.md", "package.json", "LICENSE", "bin/heredia-front-audit.mjs", ".claude-plugin/plugin.json", ".claude-plugin/marketplace.json"];
for (const f of files) {
  const p = join(REPO, f);
  const before = readFileSync(p, "utf8");
  const after = before.replaceAll("YOUR_GITHUB_USER", user).replaceAll("YOUR_NAME", name);
  if (after !== before) { writeFileSync(p, after); console.log(`updated ${f}`); }
}
// Drop the "before publishing" note from the README.
const readme = join(REPO, "README.md");
writeFileSync(readme, readFileSync(readme, "utf8").replace(/> \*\*Antes de publicar:\*\*[\s\S]*?\n\n/, ""));
console.log("Done. Review with `git diff`, then commit and push.");
