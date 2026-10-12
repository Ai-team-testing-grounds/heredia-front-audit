// Detects the project's web stack from the files on disk, so the agent knows how to start and
// reach the app regardless of framework: JS frameworks, Angular, PHP (Laravel, Symfony,
// WordPress, plain PHP…), Rails, Django/Flask, Docker, DDEV/Lando, static sites.
// Pure detection: reads files, never runs anything.
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, basename } from "node:path";

const read = (p) => { try { return readFileSync(p, "utf8"); } catch { return null; } };
const json = (p) => { try { return JSON.parse(readFileSync(p, "utf8")); } catch { return null; } };

export function detectStack(dirs) {
  const stacks = new Set();
  const urls = new Set();
  const start = new Set();
  const manifests = [];
  const notes = [];
  const add = (set, ...v) => v.filter(Boolean).forEach((x) => set.add(x));

  for (const dir of dirs) {
    const has = (f) => existsSync(join(dir, f));
    const rel = (f) => (dirs.length > 1 && dir !== dirs[dirs.length - 1] ? join(dir, f) : f);

    // ---------- JavaScript / TypeScript ----------
    const pkg = json(join(dir, "package.json"));
    if (pkg) {
      manifests.push(rel("package.json"));
      const deps = { ...pkg.dependencies, ...pkg.devDependencies };
      const pm = has("pnpm-lock.yaml") ? "pnpm" : has("yarn.lock") ? "yarn" : has("bun.lockb") || has("bun.lock") ? "bun" : "npm";
      const FW = [
        ["next", "Next.js", 3000], ["nuxt", "Nuxt", 3000], ["@remix-run/react", "Remix", 3000], ["react-scripts", "Create React App", 3000],
        ["@angular/core", "Angular", 4200], ["@sveltejs/kit", "SvelteKit", 5173], ["astro", "Astro", 4321], ["gatsby", "Gatsby", 8000],
        ["@vue/cli-service", "Vue CLI", 8080], ["vite", "Vite", 5173], ["react", "React"], ["vue", "Vue"], ["svelte", "Svelte"],
        ["solid-js", "Solid"], ["preact", "Preact"], ["lit", "Lit"], ["jquery", "jQuery"], ["alpinejs", "Alpine.js"],
        ["htmx.org", "htmx"], ["@inertiajs/react", "Inertia (React)"], ["@inertiajs/vue3", "Inertia (Vue)"],
        ["tailwindcss", "Tailwind CSS"], ["webpack", "webpack"], ["laravel-mix", "Laravel Mix"],
      ];
      for (const [dep, name, port] of FW) {
        if (dep in deps) { stacks.add(`${name} ${String(deps[dep]).replace(/^[\^~]/, "")}`); if (port) urls.add(`http://localhost:${port}`); }
      }
      const scripts = pkg.scripts || {};
      for (const s of ["dev", "start", "serve", "develop", "watch"]) {
        if (scripts[s]) {
          start.add(`${pm} run ${s}   # ${scripts[s]}`);
          const port = scripts[s].match(/(?:--port[ =]|-p\s+|PORT=)(\d{2,5})/)?.[1];
          if (port) urls.add(`http://localhost:${port}`);
        }
      }
      if (pkg.workspaces) notes.push(`npm/yarn workspaces: ${JSON.stringify(pkg.workspaces)} — the app may live in a sub-package`);
    }
    const ng = json(join(dir, "angular.json"));
    if (ng) {
      manifests.push(rel("angular.json"));
      stacks.add("Angular workspace");
      for (const p of Object.values(ng.projects || {})) {
        const port = p?.architect?.serve?.options?.port;
        urls.add(`http://localhost:${port || 4200}`);
      }
      start.add("npx ng serve");
    }

    // ---------- PHP ----------
    const composer = json(join(dir, "composer.json"));
    if (composer) {
      manifests.push(rel("composer.json"));
      const req = { ...composer.require, ...composer["require-dev"] };
      const PHP = [
        ["laravel/framework", "Laravel"], ["livewire/livewire", "Livewire"], ["inertiajs/inertia-laravel", "Inertia"],
        ["filament/filament", "Filament"], ["symfony/framework-bundle", "Symfony"], ["symfony/ux-turbo", "Symfony UX Turbo"],
        ["twig/twig", "Twig"], ["cakephp/cakephp", "CakePHP"], ["codeigniter4/framework", "CodeIgniter 4"],
        ["yiisoft/yii2", "Yii 2"], ["slim/slim", "Slim"], ["laminas/laminas-mvc", "Laminas"],
        ["roots/bedrock", "WordPress (Bedrock)"], ["johnpbloch/wordpress", "WordPress"], ["drupal/core", "Drupal"],
        ["magento/product-community-edition", "Magento"], ["shopware/core", "Shopware"],
      ];
      for (const [dep, name] of PHP) if (dep in req) stacks.add(`${name} ${String(req[dep]).replace(/^[\^~]/, "")}`);
      if (req.php) stacks.add(`PHP ${req.php}`);
    }
    if (has("artisan")) { if (![...stacks].some((x) => x.startsWith("Laravel"))) stacks.add("Laravel"); start.add("php artisan serve   # http://localhost:8000"); urls.add("http://localhost:8000"); }
    if (has("bin/console") && composer?.require?.["symfony/framework-bundle"]) {
      start.add("symfony serve -d   # or: php -S localhost:8000 -t public"); urls.add("http://localhost:8000");
    }
    if (has("wp-config.php") || has("wp-content") || has("web/wp-config.php")) {
      stacks.add("WordPress");
      notes.push("WordPress is usually served by Local, MAMP/XAMPP, Valet/Herd, DDEV or Docker — use the site URL the user already has (check wp-config.php WP_HOME/WP_SITEURL), or ask.");
    }
    if (!composer && !has("artisan") && (has("index.php") || has("public/index.php"))) {
      stacks.add("PHP (plain)");
      start.add(`php -S localhost:8000 -t ${has("public/index.php") ? "public" : "."}`); urls.add("http://localhost:8000");
    }
    if (composer && !has("artisan") && !start.size && (has("public/index.php") || has("web/index.php") || has("index.php"))) {
      start.add(`php -S localhost:8000 -t ${has("public/index.php") ? "public" : has("web/index.php") ? "web" : "."}`);
      urls.add("http://localhost:8000");
    }

    // ---------- Other server-rendered stacks ----------
    const gemfile = read(join(dir, "Gemfile"));
    if (gemfile) {
      manifests.push(rel("Gemfile"));
      if (/['"]rails['"]/.test(gemfile)) { stacks.add("Ruby on Rails"); start.add("bin/rails server   # or bin/dev"); urls.add("http://localhost:3000"); }
    }
    if (has("manage.py")) { stacks.add("Django"); start.add("python manage.py runserver"); urls.add("http://localhost:8000"); }
    const py = (read(join(dir, "pyproject.toml")) || "") + (read(join(dir, "requirements.txt")) || "");
    if (/\bflask\b/i.test(py)) { stacks.add("Flask"); start.add("flask run"); urls.add("http://localhost:5000"); }
    if (/\bfastapi\b/i.test(py)) { stacks.add("FastAPI"); urls.add("http://localhost:8000"); }
    if (has("go.mod")) { stacks.add("Go"); manifests.push(rel("go.mod")); }
    if (has("pom.xml") || has("build.gradle") || has("build.gradle.kts")) { stacks.add("Java/Kotlin (Spring or similar)"); urls.add("http://localhost:8080"); }
    if (readdirSafe(dir).some((f) => f.endsWith(".csproj") || f.endsWith(".sln"))) { stacks.add(".NET"); start.add("dotnet watch run"); }

    // ---------- Local environments ----------
    for (const f of ["docker-compose.yml", "docker-compose.yaml", "compose.yml", "compose.yaml"]) {
      const dc = read(join(dir, f));
      if (!dc) continue;
      manifests.push(rel(f));
      stacks.add("Docker Compose");
      start.add("docker compose up -d");
      for (const m of dc.matchAll(/["'\s-](?:\d+\.\d+\.\d+\.\d+:)?(\d{2,5}):(\d{2,5})["'\s]/g)) urls.add(`http://localhost:${m[1]}   # container port ${m[2]}`);
    }
    const ddev = read(join(dir, ".ddev", "config.yaml"));
    if (ddev) {
      stacks.add("DDEV");
      const name = ddev.match(/^name:\s*(\S+)/m)?.[1] || basename(dir);
      start.add("ddev start"); urls.add(`https://${name}.ddev.site`);
    }
    if (has(".lando.yml")) { stacks.add("Lando"); start.add("lando start   # then `lando info` for the URL"); }

    // ---------- URLs declared in env files ----------
    for (const f of [".env.local", ".env", ".env.development"]) {
      const env = read(join(dir, f));
      if (!env) continue;
      for (const m of env.matchAll(/^(APP_URL|SITE_URL|WP_HOME|BASE_URL|PUBLIC_URL|NEXT_PUBLIC_SITE_URL|VITE_APP_URL|DEFAULT_URI)\s*=\s*["']?([^"'\s#]+)/gm)) {
        if (/^https?:\/\//.test(m[2])) urls.add(`${m[2]}   # ${m[1]} in ${f}`);
      }
      const port = env.match(/^PORT\s*=\s*(\d{2,5})/m)?.[1];
      if (port) urls.add(`http://localhost:${port}   # PORT in ${f}`);
    }

    // ---------- Makefile targets ----------
    const mk = read(join(dir, "Makefile"));
    if (mk) for (const t of ["dev", "serve", "start", "up", "run"]) if (new RegExp(`^${t}:`, "m").test(mk)) start.add(`make ${t}`);

    // ---------- Static site ----------
    if (!stacks.size && (has("index.html") || has("public/index.html"))) {
      stacks.add("Static HTML/CSS/JS");
      start.add(`npx serve ${has("public/index.html") ? "public" : "."}   # or: python3 -m http.server 8000`);
      urls.add("http://localhost:3000");
    }
  }

  // Order: URLs declared in env files first, then app servers; with a PHP/Ruby/Python backend,
  // Vite/Mix ports serve assets only, so label them and move them last.
  const backend = [...stacks].some((x) => /^(Laravel|Symfony|WordPress|Drupal|PHP|CakePHP|CodeIgniter|Yii|Slim|Ruby on Rails|Django|Flask)/.test(x));
  const ordered = [...urls].sort((a, b) => Number(!a.includes("# ")) - Number(!b.includes("# ")) || 0)
    .map((u) => (backend && /localhost:5173$/.test(u) ? `${u}   # Vite asset server — the pages are served by the backend` : u))
    .sort((a, b) => Number(a.includes("asset server")) - Number(b.includes("asset server")));
  urls.clear(); ordered.forEach((u) => urls.add(u));

  if (!urls.size) notes.push("No dev URL could be inferred — check the README, then ask the user for the URL.");
  notes.push("Local hosts like Valet/Herd (<folder>.test), MAMP (:8888) or XAMPP (http://localhost/<folder>) won't show up in files — if nothing above answers, ask the user.");
  return { stacks: [...stacks], urls: [...urls], start: [...start], manifests: [...new Set(manifests)], notes };
}

function readdirSafe(dir) { try { return readdirSync(dir); } catch { return []; } }

// Groups changed files by kind so the agent can see at a glance what kind of UI changed.
export function summarizeChangedFiles(paths) {
  const KINDS = [
    [/\.blade\.php$/, "Blade templates"], [/\.twig$/, "Twig templates"], [/\.(phtml|tpl|latte)$/, "PHP templates"],
    [/\.php$/, "PHP"], [/\.component\.html$/, "Angular templates"], [/\.(tsx|jsx)$/, "React/JSX components"],
    [/\.vue$/, "Vue SFCs"], [/\.svelte$/, "Svelte components"], [/\.astro$/, "Astro components"],
    [/\.(ts|mts|cts)$/, "TypeScript"], [/\.(js|mjs|cjs)$/, "JavaScript"], [/\.html?$/, "HTML"],
    [/\.(erb|haml|slim)$/, "Rails views"], [/\.(cshtml|razor)$/, "Razor views"], [/\.(jinja2?|j2)$/, "Jinja templates"],
    [/\.(css|scss|sass|less|styl|pcss)$/, "Styles"], [/\.(json|ya?ml|toml|env.*)$/, "Config"],
    [/\.(png|jpe?g|svg|gif|webp|avif|ico)$/, "Images/icons"], [/\.(spec|test)\.[jt]sx?$|Test\.php$/, "Tests"],
  ];
  const counts = {};
  for (const p of paths) {
    const kind = KINDS.find(([re]) => re.test(p))?.[1] || "Other";
    counts[kind] = (counts[kind] || 0) + 1;
  }
  return Object.entries(counts).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k} (${n})`).join(", ");
}
