## Step 1 — Build a test plan from the diff

1. Read every changed and untracked file in full, plus the components/routes/hooks/stores/API
   clients they touch. Follow imports one level out so you understand the blast radius.
2. Map the changes to **user-facing flows**: which routes/pages render them, which interactions
   reach them (forms, modals, navigation, auth, data loading, empty/error states). Use the stack's
   own routing to find the page: e.g. the router config / file-based `app/` or `pages/` folders
   (React, Next, Vue, Nuxt, SvelteKit), `*.routes.ts` / `RouterModule` (Angular),
   `routes/web.php` → controller → Blade/Inertia view (Laravel), `#[Route]` attributes or
   `config/routes` → Twig (Symfony), templates/hooks/shortcodes (WordPress), or the PHP file's own
   URL in plain PHP. Backend changes (controllers, validation, API endpoints) count when a page
   uses them.
3. Write a short plan: for each flow, the happy path plus the edge cases most likely to break
   given *this* diff (invalid/empty/very long input, double submit, slow or failing API,
   back/refresh, unauthenticated state, mobile width, keyboard-only use). Prioritise what the
   diff actually changed — do not test the whole app.

## Step 2 — Get the app running

This works the same for any stack — JS frameworks, Angular, PHP, Rails, Django, static sites.

- If the user gave a URL ({{ARGS}}), use it.
- Otherwise use the **Project stack** section of the context: try each *likely app URL* with
  `curl -s -o /dev/null -w "%{http_code}" <url>` and use the first that answers (any status
  below 500 means something is serving). Also try the usual local ports: 3000, 5173, 4200, 8000,
  8080, 4321, 5000, 8888, 80.
- If nothing answers, start the app with the first fitting *way to start it* (e.g. `npm run dev`,
  `npx ng serve`, `php artisan serve`, `symfony serve -d`, `php -S localhost:8000 -t public`,
  `docker compose up -d`, `ddev start`, `bin/rails server`) **in the background**, wait until it
  answers, and remember that you started it so you can stop it at the end. Server-rendered PHP
  apps with a Vite/Mix front end (Laravel, Symfony Encore) may also need the asset dev server
  (`npm run dev`) running alongside — start both if pages load without CSS/JS.
- Apps served by MAMP/XAMPP, Valet/Herd (`<folder>.test`), Local, or a shared dev server can't
  be detected from files: if nothing above works, ask the user for the URL once.
- If the app needs credentials, seed data, a database or a `.env`, ask the user once, then
  continue with whatever you can test. Never run migrations or seeders that change data
  without asking.

## Step 3 — Pick the browser

{{BROWSER}}

If no browser automation is available, do not stop: do the code review (Step 5) only, set
`"browser": "none"` in the findings, and add an `info` finding that explains how to enable one
(see the setup line above).

## Step 4 — Execute the flows in the browser

For every flow in your plan:

- Drive it like a real user (navigate, click, type, submit). Prefer accessibility-tree
  snapshots to decide what to click; take a **screenshot at every failure** and at the end
  state of each flow.
- After each flow, read **console messages** (errors and warnings) and **network requests**
  (any 4xx/5xx, failed or duplicated calls).
- Re-run the most important flow at **375px wide** (mobile) and check layout, overflow,
  tap targets and hidden content.
- Check basic **accessibility** on the changed UI: labels on inputs, button names, focus
  visible and reachable by Tab, alt text, colour contrast that is obviously too low.
- Compare what you see with what the diff *intended* (copy, states, validation messages).

Save screenshots into `<run dir>/screenshots/` (if the browser tool saves them elsewhere, copy
the file in) and reference them by that relative path (`screenshots/xyz.png`).

Be honest about evidence: a finding from the browser must be something you actually observed.

## Step 5 — Review the changed code

Read the diff again as a senior reviewer and look for issues the browser run can't easily
show. Mark these `"source": "code"`. Apply the general list, then the list for each stack you
detected:

- **All stacks:** missing loading/empty/error states, unhandled failures of API/form calls,
  race conditions and double submits, hard-coded URLs or secrets, debug leftovers
  (`console.log`, `debugger`, `dd()`, `dump()`, `var_dump`, `print_r`), broken or missing
  validation messages, inaccessible markup (labels, alt, roles, focus), dead code, missing tests
  for new logic, untranslated strings if the project uses i18n.
- **React / Next / Vue / Nuxt / Svelte / Solid:** effect dependencies and stale closures, missing
  cleanup, keys in lists, controlled↔uncontrolled inputs, state updated during render,
  hydration mismatches (SSR), XSS via `dangerouslySetInnerHTML` / `v-html` / `{@html}`.
- **Angular:** subscriptions without `takeUntilDestroyed`/`async` pipe, missing `trackBy`/`track`
  in loops, `OnPush` components mutating inputs, reactive-form validators that don't match the
  template, `bypassSecurityTrust*` / `[innerHTML]` with user data, unguarded routes, signals
  read outside reactive context.
- **PHP — Laravel / Symfony / WordPress / plain PHP:** unescaped output (`{!! !!}` in Blade,
  `|raw` in Twig, `echo $var` without `htmlspecialchars`/`esc_html`/`esc_attr`), forms missing
  CSRF (`@csrf`, `csrf_token`, `wp_nonce_field`), request data used without validation, SQL built
  by string concatenation, mass assignment (`$fillable`/`$guarded`), N+1 queries triggered from
  views, missing authorization (`@can`, policies, `current_user_can`), flash/old-input not
  restored after validation errors, assets not rebuilt (`@vite`, `asset()`, `wp_enqueue_*`).
- **jQuery / vanilla JS / htmx / Alpine:** listeners bound twice or never removed, selectors that
  break when markup changed, `innerHTML` with user data, missing `hx-` error handling.
- **Other server-rendered stacks (Rails, Django, .NET…):** the same escaping, CSRF, validation
  and authorization checks in that framework's idiom.

## Step 6 — Write findings.json

Write `<run dir>/findings.json` with exactly this shape (omit optional fields you don't have):

```json
{
  "agent": "{{AGENT_ID}}",
  "project": "repo name",
  "branch": "branch",
  "commit": "short sha",
  "stack": "e.g. Laravel 11 + Blade + Vite, or Angular 18, or React 19 + Vite",
  "baseUrl": "http://localhost:5173",
  "browser": "claude-in-chrome | playwright-mcp | other | none",
  "summary": "2-4 sentences: what changed, what you tested, overall verdict.",
  "changedFiles": [{ "path": "src/x.tsx", "status": "M | A | D | ??" }],
  "flowsTested": [
    { "name": "Sign up with invalid email", "result": "pass | fail | partial | skipped",
      "steps": ["Open /signup", "Type 'abc'", "Submit"], "notes": "optional" }
  ],
  "findings": [
    {
      "id": "F1",
      "title": "Short, specific problem statement",
      "severity": "critical | high | medium | low | info",
      "category": "functional | visual | responsive | accessibility | console | network | performance | code-quality | ux",
      "source": "browser | code",
      "location": { "file": "src/components/Form.tsx", "line": 42, "url": "/signup" },
      "description": "What is wrong and why it matters to the user.",
      "reproSteps": ["Open /signup", "Submit empty form"],
      "expected": "Inline error under the email field",
      "actual": "Nothing happens; TypeError in console",
      "evidence": { "screenshot": "screenshots/signup-empty.png", "console": "TypeError: ..." },
      "fix": {
        "explanation": "Concrete fix in 1-3 sentences, naming the function/prop to change.",
        "snippet": "optional code showing the change"
      }
    }
  ]
}
```

Severity guide: **critical** = flow broken / data loss / security; **high** = feature works
wrong for common input; **medium** = edge case or noticeable UX/a11y problem; **low** = polish;
**info** = notes and things you could not test. Every non-info finding must have a `fix`.
One finding per root cause — don't list the same bug three times.

## Step 7 — Render and open the report

```bash
node "{{SKILL_DIR}}/scripts/render-report.mjs" "<run dir>/findings.json"
```

This writes `report.html` next to the findings (screenshots embedded), copies it to
`.heredia-front-audit/latest.html`, writes the fix prompt to `fix-prompt.md`, and opens the report in
the default browser. If it prints `SCHEMA ERROR`, fix the JSON and run it again. If it can't
open a browser (e.g. sandboxed), just give the user the report path.

## Step 8 — Wrap up

- Stop the dev server if you started it.
- Reply with: the verdict in one line, counts by severity, the top 3 findings (one line each),
  and the report path. Tell the user they can press **Copy fix prompt** in the report, paste it
  into {{AGENT_NAME}}, then run `{{RERUN}}` again to verify.
