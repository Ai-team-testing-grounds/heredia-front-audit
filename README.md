# heredia-front-audit

**End-to-end review of your uncommitted frontend changes — for Claude Code and Codex.**

Type `/heredia-front-audit` (Claude Code) or `$heredia-front-audit` (Codex) in any repo. Your agent reads what you
changed but haven't committed, drives the app in a real browser like a picky QA engineer, reviews
the diff, and opens an HTML report with every problem it found, how to fix it, and a
**Copy fix prompt** button you paste straight back into the agent.

![heredia-front-audit report](docs/report-screenshot.png)

- **Scoped to your diff** — tests the flows your uncommitted changes touch, not the whole app.
- **Real browser** — happy paths, edge cases, 375px mobile, console errors, failed or duplicated
  network calls, basic accessibility, with screenshots of every failure.
- **Code review too** — race conditions, missing error/loading states, effect deps, XSS, debug code…
- **One-click fix loop** — tick the findings you want, copy the prompt, paste, re-run to verify.
- **Read-only** — never edits your source or commits; writes only to `.heredia-front-audit/` (git-ignored automatically).
- **Any web stack** — React, Next, Vue, Nuxt, Svelte, Angular, Laravel, Symfony, WordPress, plain
  PHP, Rails, Django, static sites… It detects how to start and reach your app and reviews the
  code with checks for that stack ([details](#works-with-any-stack)).
- **Nothing added to your project** — no npm/composer packages. Your machine needs Node.js ≥ 18.17
  and git (Node runs the skill's small helper scripts, even for PHP projects).

---

## Contents

- [Works with any stack](#works-with-any-stack)
- [Install for Claude Code](#install-for-claude-code)
- [Install for Codex](#install-for-codex)
- [Give the agent a browser](#give-the-agent-a-browser)
- [Usage](#usage)
- [The report and the fix loop](#the-report-and-the-fix-loop)
- [Installer reference](#installer-reference)
- [Customising](#customising)
- [How it works](#how-it-works)
- [Troubleshooting](#troubleshooting)
- [Development](#development)

> **Before publishing:** run `node scripts/set-owner.mjs <your-github-user> "Your Name"` once.
> It fills in the `YOUR_GITHUB_USER` / `YOUR_NAME` placeholders across the repo and removes this note.

---

## Works with any stack

Nothing in the flow is tied to one framework. On every run a helper script inspects the project
and tells the agent what it's dealing with:

| It looks at | To learn |
|---|---|
| `package.json`, lockfiles, `angular.json` | JS framework (React, Next, Vue, Nuxt, Svelte/Kit, Angular, Astro, Remix, Gatsby, Solid, jQuery, Alpine, htmx…), package manager, `dev`/`start` scripts and ports |
| `composer.json`, `artisan`, `bin/console`, `wp-config.php`, `index.php` | PHP stack (Laravel, Livewire, Inertia, Symfony, Twig, WordPress, Drupal, CakePHP, CodeIgniter, Yii, Slim, Magento, plain PHP) and how to serve it |
| `Gemfile`, `manage.py`, `pyproject.toml`, `*.csproj`, `pom.xml` | Rails, Django, Flask/FastAPI, .NET, Java |
| `docker-compose.yml`, `.ddev/`, `.lando.yml`, `Makefile` | Containerised/local environments and their ports |
| `.env` (`APP_URL`, `WP_HOME`, `PORT`, …) | The URL your app actually runs on |
| The changed files | What kind of UI changed (Blade/Twig templates, Angular templates, JSX, Vue SFCs, styles…) |

The agent then:

- **Finds the right pages** using that stack's routing (`routes/web.php` → controller → view,
  Angular routes, file-based routes, WordPress templates…).
- **Gets the app running** — uses your URL, or a detected one that answers, or starts it
  (`npm run dev`, `ng serve`, `php artisan serve`, `symfony serve`, `php -S`, `docker compose up`,
  `ddev start`…), including the Vite/Mix asset server for PHP apps when needed. If your app lives
  on MAMP/XAMPP/Valet/Herd, just pass the URL: `/heredia-front-audit http://my-site.test`.
- **Reviews the code with stack-specific checks** — e.g. effect deps and hydration for React/Vue,
  subscriptions and `trackBy` for Angular, unescaped output (`{!! !!}`, `|raw`, `echo` without
  escaping), CSRF, validation, mass assignment and N+1 queries for PHP.

The browser part is the same everywhere: it tests the rendered pages like a user would.

## Install for Claude Code

**Option A — Installer (recommended: gives you exactly `/heredia-front-audit` in every project)**

```bash
npx github:YOUR_GITHUB_USER/heredia-front-audit --claude
```

This copies the skill to `~/.claude/skills/heredia-front-audit/` (respects `CLAUDE_CONFIG_DIR`),
so `/heredia-front-audit` is available in **every** project on your machine — nothing is added
to the projects themselves. Re-run the command to update.

**Option B — Plugin marketplace (updates through Claude Code)**

Inside Claude Code:

```text
/plugin marketplace add YOUR_GITHUB_USER/heredia-front-audit
/plugin install heredia-front-audit@heredia-front-audit
```

Plugin skills are namespaced, so the full command is `/heredia-front-audit:heredia-front-audit`;
plain `/heredia-front-audit` also works as long as no other command uses that name. Update with
`/plugin marketplace update heredia-front-audit`. Don't use A and B together — pick one.

**Option C — Commit it into one project for your whole team**

```bash
cd your-app
npx github:YOUR_GITHUB_USER/heredia-front-audit --claude --project
git add .claude/skills/heredia-front-audit && git commit -m "Add /heredia-front-audit skill"
```

## Install for Codex

Codex reads [Agent Skills](https://agentskills.io) from `~/.agents/skills/` (personal) and
`.agents/skills/` (per repo).

```bash
npx github:YOUR_GITHUB_USER/heredia-front-audit --codex              # personal: every repo on this machine
npx github:YOUR_GITHUB_USER/heredia-front-audit --codex --project    # or: into the current repo, then commit .agents/skills/heredia-front-audit
```

Restart Codex, then type `$heredia-front-audit` (or pick **Heredia Front Audit** from `/skills`). The skill is set to
explicit-only (`allow_implicit_invocation: false`), so Codex never starts a browser run on its own.

**Both agents at once:** `npx github:YOUR_GITHUB_USER/heredia-front-audit` installs for every agent it
finds on your machine (Claude Code and/or Codex).

**Without npx:** `git clone https://github.com/YOUR_GITHUB_USER/heredia-front-audit && node heredia-front-audit/bin/heredia-front-audit.mjs [--claude] [--codex]`.

---

## Give the agent a browser

The skill works with whichever browser tool your agent has. Without one, it still does the code
review and tells you in the report how to enable a browser.

| | Claude in Chrome | Playwright MCP |
|---|---|---|
| **Agents** | Claude Code | Claude Code **and** Codex |
| **Setup** | Install the [Claude extension](https://chromewebstore.google.com/detail/claude/fcoeoabgfenejglbffodgkkbkcdhcgfn), then start `claude --chrome` (or run `/chrome` → *Enabled by default*) | Claude Code: `claude mcp add --scope user playwright -- npx @playwright/mcp@latest`<br>Codex: `codex mcp add playwright -- npx @playwright/mcp@latest` |
| **Best for** | Apps behind your login (uses your real Chrome sessions); watching it work | Clean, isolated, repeatable runs; headless; CI |
| **Notes** | Needs a Claude Pro/Max/Team/Enterprise sign-in via `/login` | Add `--headless` or `--isolated` after `@latest` if you like |

Or let the installer register Playwright for you: `npx github:YOUR_GITHUB_USER/heredia-front-audit --with-playwright`.

If Claude Code has both, the skill prefers Chrome.

---

## Usage

Make some frontend changes (don't commit), start your agent in the repo, and run:

| | Claude Code | Codex |
|---|---|---|
| Basic | `/heredia-front-audit` | `$heredia-front-audit` |
| Point at the app | `/heredia-front-audit http://localhost:5173` | `$heredia-front-audit http://localhost:5173` |
| Add focus | `/heredia-front-audit http://localhost:3000 "new checkout form, test on mobile"` | `$heredia-front-audit http://localhost:3000 — focus on the new checkout form on mobile` |

What happens:

1. **Context** — a bundled script collects the branch, `git status`, `git diff HEAD`, untracked
   files and `package.json` scripts, and creates a run folder.
2. **Plan** — the agent maps the changed files to the user flows they affect.
3. **App** — it uses your URL, finds a running dev server on a common port, or starts your
   `dev` script in the background (and stops it at the end).
4. **Browser run** — happy paths, edge cases, mobile width, console, network and accessibility
   checks, with screenshots.
5. **Code review** — of the diff, for issues a browser can't easily show.
6. **Report** — writes `findings.json`, renders `report.html` and opens it in your default browser.

Each run writes to your repo:

```
.heredia-front-audit/              ← ignores itself; never shows up in git status
  latest.html                      ← always the most recent report
  runs/2026-10-09_17-30-02/
    findings.json                  ← structured results (source of truth)
    report.html                    ← self-contained report (screenshots embedded)
    fix-prompt.md                  ← the same prompt the Copy button gives you
    screenshots/
```

Headless / CI (with Playwright MCP):

```bash
claude -p "/heredia-front-audit http://localhost:3000"
codex exec 'Use the $heredia-front-audit skill on http://localhost:3000'
```

## The report and the fix loop

- Findings are sorted by severity (**critical → info**); click a severity chip to filter.
- Each finding has where it is (file:line and page), what's wrong, steps to reproduce,
  expected vs. actual, console output, a screenshot, and **how to fix it**.
- Tick the findings you want fixed (all non-info ones are ticked by default), press
  **Copy fix prompt**, and paste it into Claude Code or Codex. Each finding also has its own
  **Copy prompt for F2 only** button, and **Preview prompt** shows exactly what you'll paste.
- The prompt tells the agent to confirm each root cause before changing anything, make minimal
  fixes, run your lint, type checks and tests, report what it changed per finding, and remind you
  to re-run heredia-front-audit to verify.

---

## Installer reference

```text
npx github:YOUR_GITHUB_USER/heredia-front-audit [install|uninstall] [--claude] [--codex] [--project] [--with-playwright]
```

| Flag | Effect |
|---|---|
| *(no agent flag)* | Install for every agent detected on this machine (both if none detected) |
| `--claude` | Claude Code → `~/.claude/skills/heredia-front-audit` |
| `--codex` | Codex → `~/.agents/skills/heredia-front-audit` |
| `--project` | Install into the current git repo (`.claude/skills/…`, `.agents/skills/…`) instead of your home folder |
| `--with-playwright` | Also run `claude mcp add …` / `codex mcp add …` for Playwright MCP |
| `uninstall` | Remove the skill from the same locations |

---

## Customising

The instructions live in **`src/`** and are shared by both agents:

| File | What it is |
|---|---|
| `src/workflow.md` | The QA procedure (steps 1–8) and the `findings.json` schema — edit this to add your team's checks (design tokens, i18n, analytics events, auth roles…) |
| `src/claude-code.md` | Claude Code frontmatter + how context is injected (`` !`node …/collect-context.mjs` ``) |
| `src/codex.md` | Codex frontmatter + "run collect-context first" step |

After editing, run `npm run build` (regenerates `skills/heredia-front-audit/SKILL.md` for Claude Code)
and reinstall. Codex's `SKILL.md` is generated at install time because it needs the real
install path.

Other knobs:

- Teach it a new stack: add a rule to `skills/heredia-front-audit/scripts/detect-stack.mjs` (how to
  recognise it, its URL and start command) and a checklist line to Step 5 of `src/workflow.md`.
- `HEREDIA_FRONT_AUDIT_MAX_DIFF_LINES` (default `2500`) — how much of the diff is inlined before truncating.
- `HEREDIA_FRONT_AUDIT_NO_OPEN=1` or `--no-open` — don't open the report automatically.
- Re-render a report by hand:
  `node ~/.claude/skills/heredia-front-audit/scripts/render-report.mjs .heredia-front-audit/runs/<run>/findings.json`
- Report UI: `skills/heredia-front-audit/templates/report.html` (data is injected as JSON).

## How it works

```
heredia-front-audit/
├── .claude-plugin/
│   ├── marketplace.json            ← makes this repo a Claude Code plugin marketplace
│   └── plugin.json                 ← …containing one plugin: this repo
├── skills/heredia-front-audit/     ← the skill (Claude Code build; the plugin loads it from here)
│   ├── SKILL.md                    ← GENERATED from src/ by `npm run build`
│   ├── scripts/
│   │   ├── collect-context.mjs     ← git diff/status/untracked + stack info → Markdown; creates the run dir
│   │   ├── detect-stack.mjs        ← framework-agnostic stack / URL / start-command detection
│   │   └── render-report.mjs       ← findings.json → report.html + fix-prompt.md, opens it
│   └── templates/report.html
├── src/                            ← single source of truth for the instructions (both agents)
├── bin/heredia-front-audit.mjs     ← installer (Claude Code + Codex, user or project scope)
├── scripts/build.mjs               ← builds SKILL.md per agent
├── scripts/set-owner.mjs           ← one-time: fills in your GitHub user / name
├── examples/demo-run/              ← sample findings + screenshot (`npm run demo`)
└── test/run.mjs                    ← smoke tests (`npm test`, runs in CI on Linux/macOS/Windows)
```

Differences between the two agents are handled for you:

| | Claude Code | Codex |
|---|---|---|
| Invoke | `/heredia-front-audit` (or `/heredia-front-audit:heredia-front-audit` as a plugin) | `$heredia-front-audit` or `/skills` |
| Skill location | `~/.claude/skills/` or `.claude/skills/` (or plugin) | `~/.agents/skills/` or `.agents/skills/` |
| Context | Injected before the agent reads the skill | Agent runs `collect-context.mjs` as step 0 |
| Only runs when you ask | `disable-model-invocation: true` | `agents/openai.yaml` → `allow_implicit_invocation: false` |
| Pre-approved commands | `allowed-tools` (git, the bundled scripts, `curl -s`, `mkdir`, `cp`, `ls`) | Your Codex approval/sandbox settings |

## Troubleshooting

**"No uncommitted changes"** — heredia-front-audit only looks at the working tree vs `HEAD` (staged,
unstaged and untracked files). If you already committed the work, `git reset --soft HEAD~1`
puts the last commit back into your working tree without losing anything, then run it again.

**Claude Code: browser tools missing** — start with `claude --chrome` and check `/chrome` shows
*Status: Enabled*, or add Playwright MCP and check `/mcp`.

**Codex: `$heredia-front-audit` not listed** — restart Codex after installing; check
`~/.agents/skills/heredia-front-audit/SKILL.md` exists. Confirm Playwright with `codex mcp list`.

**Codex can't start or reach the dev server** — the Codex sandbox may block background
processes or network access. Approve the command when asked, start the dev server yourself and
pass its URL (`$heredia-front-audit http://localhost:5173`), or loosen the sandbox for this session.

**Report didn't open** — headless or sandboxed sessions can't open a browser. The path is
printed; open `.heredia-front-audit/latest.html` yourself.

**Huge diffs** — the diff is truncated at 2,500 lines (configurable); the agent is told to read
the rest per file. For big refactors, pass a focus: `/heredia-front-audit "only the settings page"`.

**Apps behind a login** — with Claude in Chrome it uses your existing sessions. With Playwright
MCP, the agent will ask you for test credentials once.

## Development

```bash
git clone https://github.com/YOUR_GITHUB_USER/heredia-front-audit && cd heredia-front-audit
npm test                # build check + context, renderer and installer smoke tests (no deps)
npm run build           # regenerate skills/heredia-front-audit/SKILL.md after editing src/
npm run demo            # render examples/demo-run into report.html and open it
node bin/heredia-front-audit.mjs --claude --codex   # install your working copy
claude --plugin-dir .   # try the plugin build in Claude Code without installing
```

CI runs `npm test` on Linux, macOS and Windows (Node 18 and 22). Commit the regenerated
`SKILL.md` along with any `src/` change — CI fails if they're out of sync.

## License

[MIT](LICENSE)
