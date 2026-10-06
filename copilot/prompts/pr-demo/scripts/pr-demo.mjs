#!/usr/bin/env node
// Mechanical half of the pr-demo skill. Builds real "before" and "after" bundles of
// auro-formkit components from git refs (never checking anything out), assembles the
// demo page with each side in its own iframe, and verifies the result in headless
// Chromium.
//
//   node pr-demo.mjs build    --repo <root> --pr <n> --base-branch <name> --components <a,b> [--before <ref>]
//   node pr-demo.mjs assemble --repo <root> --pr <n> --draft <draft.html> --out <page.html>
//   node pr-demo.mjs verify   --repo <root> --page <page.html> --screenshot <file.png>
//   node pr-demo.mjs clean    --repo <root> --pr <n>
//
// Each side runs in its own iframe so it gets its own custom-element registry. Components
// register sub-dependencies under version-stamped tag names, so two builds with the same
// version on one page would silently share classes.
//
// esbuild, sass, and playwright are loaded from the target repo's node_modules, so this
// script has no dependencies of its own.
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

// --- args ---------------------------------------------------------------------

const [command, ...rest] = process.argv.slice(2);
const args = {};
for (let i = 0; i < rest.length; i += 2) {
  args[rest[i].replace(/^--/, '')] = rest[i + 1];
}

const fail = (message) => {
  console.error(`PR_DEMO_ERROR: ${message}`);
  process.exit(1);
};

const need = (...names) => names.forEach((n) => { if (!args[n]) fail(`missing --${n}`); });

// Inside the target repo so every step finds it regardless of sandbox/TMPDIR differences;
// node_modules/.cache is git-ignored in every Auro repo.
const workDir = (repo, pr) => join(resolve(repo), 'node_modules/.cache/pr-demo', String(pr));

const git = (repo, ...gitArgs) => execFileSync('git', ['-C', repo, ...gitArgs], {
  encoding: 'utf8',
  maxBuffer: 256 * 1024 * 1024,
}).trim();

const repoRequire = (repo) => createRequire(join(repo, 'package.json'));

const importFromRepo = async (repo, name) => {
  try {
    return await import(pathToFileURL(repoRequire(repo).resolve(name)).href);
  } catch {
    return null;
  }
};

// --- build ----------------------------------------------------------------------

/** Extract components/ and packages/ from a ref into dest, without touching the working tree. */
function extractTree(repo, ref, dest) {
  mkdirSync(dest, { recursive: true });
  const tar = execFileSync('git', ['-C', repo, 'archive', '--format=tar', ref, '--', 'components', 'packages'], {
    maxBuffer: 1024 * 1024 * 1024,
  });
  execFileSync('tar', ['-x', '-C', dest], { input: tar });
}

/** Map workspace package names (e.g. @aurodesignsystem/auro-menu) to their directory in a tree. */
function workspaceMap(tree) {
  const map = new Map();
  for (const group of ['components', 'packages']) {
    const groupDir = join(tree, group);
    if (!existsSync(groupDir)) continue;
    for (const entry of readdirSync(groupDir)) {
      const pkgFile = join(groupDir, entry, 'package.json');
      if (!existsSync(pkgFile)) continue;
      const pkg = JSON.parse(readFileSync(pkgFile, 'utf8'));
      if (pkg.name) map.set(pkg.name, { dir: join(groupDir, entry), pkg });
    }
  }
  return map;
}

/** Resolve a workspace package's bare entry point to source rather than its built dist/. */
function workspaceEntry({ dir, pkg }) {
  const exported = typeof pkg.exports === 'object' ? pkg.exports['.'] : pkg.exports;
  const declared = (typeof exported === 'string' && exported) || pkg.module || pkg.main;
  if (declared && !declared.includes('dist/')) return join(dir, declared);
  if (existsSync(join(dir, 'src/index.js'))) return join(dir, 'src/index.js');
  return declared ? join(dir, declared) : join(dir, 'index.js');
}

/**
 * esbuild plugin that keeps every import of one side inside that side's tree:
 * - workspace packages resolve to the side's source (not the working tree's dist/)
 * - `*-css.js` style modules are compiled from the side's .scss (they're generated and untracked)
 * - generated files missing from the archive (e.g. version.js) fall back to the working tree
 */
function sidePlugin({ repo, tree, sass }) {
  const workspaces = workspaceMap(tree);
  const toWorkingTree = (path) => join(repo, relative(tree, path));

  return {
    name: 'pr-demo-side',
    setup(build) {
      build.onResolve({ filter: /^@aurodesignsystem\// }, ({ path }) => {
        const parts = path.split('/');
        const name = parts.slice(0, 2).join('/');
        const subpath = parts.slice(2).join('/');
        const ws = workspaces.get(name);
        if (!ws) return undefined;
        let target;
        if (!subpath) {
          target = workspaceEntry(ws);
        } else {
          const subExport = typeof ws.pkg.exports === 'object' ? ws.pkg.exports[`./${subpath}`] : undefined;
          target = join(ws.dir, typeof subExport === 'string' ? subExport : subpath);
        }
        if (!existsSync(target) && existsSync(toWorkingTree(target))) target = toWorkingTree(target);
        return { path: target };
      });

      build.onResolve({ filter: /-css\.js$/ }, ({ path, resolveDir }) => ({
        path: resolve(resolveDir, path),
        namespace: 'pr-demo-scss',
      }));

      build.onLoad({ filter: /.*/, namespace: 'pr-demo-scss' }, ({ path }) => {
        const scss = path.replace(/-css\.js$/, '.scss');
        if (!existsSync(scss)) return { errors: [{ text: `no ${relative(tree, scss)} to compile` }] };
        const { css } = sass.compile(scss, {
          loadPaths: [join(repo, 'node_modules'), dirname(scss)],
          quietDeps: true,
          silenceDeprecations: ['import'],
        });
        const escaped = css.replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$\{/g, '\\${');
        return {
          contents: `import { css } from 'lit';\nexport default css\`${escaped}\`;\n`,
          resolveDir: repo,
          loader: 'js',
        };
      });

      // Relative imports of generated, untracked files (e.g. version.js) that the archive lacks.
      build.onResolve({ filter: /^\.\.?\// }, ({ path, resolveDir }) => {
        const target = resolve(resolveDir, path);
        if (!target.startsWith(tree) || existsSync(target)) return undefined;
        const fallback = toWorkingTree(target);
        return existsSync(fallback) ? { path: fallback } : undefined;
      });
    },
  };
}

async function bundleSide({ repo, tree, components, outfile, esbuild, sass }) {
  const entry = components
    .map((c) => {
      const registered = join(tree, 'components', c, 'src/registered.js');
      if (!existsSync(registered)) fail(`components/${c}/src/registered.js not found at this ref`);
      return `import ${JSON.stringify(registered)};`;
    })
    .join('\n');

  await esbuild.build({
    stdin: { contents: entry, resolveDir: tree, loader: 'js' },
    bundle: true,
    format: 'esm',
    minify: true,
    outfile,
    logLevel: 'error',
    nodePaths: [join(repo, 'node_modules')],
    // auro-library ships directory modules with only an index.mjs and no exports map.
    resolveExtensions: ['.mjs', '.js', '.ts', '.json', '.css'],
    plugins: [sidePlugin({ repo, tree, sass })],
  });
}

async function build() {
  need('repo', 'pr', 'base-branch', 'components');
  const repo = resolve(args.repo);
  const components = args.components.split(',').map((c) => c.trim()).filter(Boolean);

  const esbuildMod = await importFromRepo(repo, 'esbuild');
  const sassMod = await importFromRepo(repo, 'sass');
  if (!esbuildMod || !sassMod) fail('esbuild and sass must be installed in the target repo (run npm ci there)');
  const esbuild = esbuildMod.default ?? esbuildMod;
  const sass = sassMod.default ?? sassMod;

  git(repo, 'fetch', '--quiet', '--no-tags', 'origin', args['base-branch']);
  const baseTip = git(repo, 'rev-parse', `origin/${args['base-branch']}`);
  git(repo, 'fetch', '--quiet', '--no-tags', 'origin', `pull/${args.pr}/head`);
  const after = git(repo, 'rev-parse', 'FETCH_HEAD');
  // A merged PR's head is already in the base branch, so the merge base would equal the
  // head. The skill passes --before <merge commit>^1 for merged PRs instead.
  const before = args.before
    ? git(repo, 'rev-parse', `${args.before}^{commit}`)
    : git(repo, 'merge-base', baseTip, after);
  if (before === after) fail('before and after resolve to the same commit; for a merged PR pass --before <merge commit>^1');

  const dir = workDir(repo, args.pr);
  rmSync(dir, { recursive: true, force: true });
  const sides = { before, after };

  for (const [side, ref] of Object.entries(sides)) {
    const tree = join(dir, side);
    extractTree(repo, ref, tree);
    await bundleSide({ repo, tree, components, outfile: join(dir, `${side}.js`), esbuild, sass });
  }

  const summary = {
    pr: Number(args.pr),
    components,
    before: before.slice(0, 9),
    after: after.slice(0, 9),
    workDir: dir,
    bundles: Object.fromEntries(Object.keys(sides).map((s) => [s, `${(statSync(join(dir, `${s}.js`)).size / 1024).toFixed(0)} KB`])),
  };
  writeFileSync(join(dir, 'summary.json'), JSON.stringify(summary, null, 2));
  console.log(JSON.stringify(summary, null, 2));
}

// --- assemble ---------------------------------------------------------------------

async function assemble() {
  need('repo', 'pr', 'draft', 'out');
  const dir = workDir(args.repo, args.pr);
  const summaryFile = join(dir, 'summary.json');
  if (!existsSync(summaryFile)) fail('run `build` first');
  const summary = JSON.parse(readFileSync(summaryFile, 'utf8'));

  // `</script` can't appear inside an inline script; `<\/script` is equivalent in JS source.
  const inline = (file) => readFileSync(file, 'utf8').replace(/<\/script/gi, '<\\/script');

  let page = readFileSync(resolve(args.draft), 'utf8');
  const required = ['__BUNDLE_BEFORE__', '__BUNDLE_AFTER__'];
  required.forEach((token) => { if (!page.includes(token)) fail(`draft is missing ${token}`); });

  page = page
    .split('__BUNDLE_BEFORE__').join(inline(join(dir, 'before.js')))
    .split('__BUNDLE_AFTER__').join(inline(join(dir, 'after.js')))
    .split('__BEFORE_SHA__').join(summary.before)
    .split('__AFTER_SHA__').join(summary.after);

  const out = resolve(args.out);
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, page);
  console.log(JSON.stringify({ out, size: `${(statSync(out).size / 1024).toFixed(0)} KB` }));
}

// --- verify -----------------------------------------------------------------------

async function verify() {
  need('repo', 'page');
  const repo = resolve(args.repo);
  const pw = (await importFromRepo(repo, 'playwright')) ?? (await importFromRepo(repo, '@playwright/test'));
  const chromium = pw?.chromium ?? pw?.default?.chromium;
  if (!chromium) fail('playwright is not installed in the target repo; skip verification and say so');

  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });

  await page.goto(pathToFileURL(resolve(args.page)).href);
  await page.waitForFunction(() => window.prDemo?.ready === true, null, { timeout: 20000 })
    .catch(() => errors.push('page never set window.prDemo.ready — a frame failed to load'));
  const frameErrors = () => page.evaluate(() => window.prDemo?.errors ?? []).catch(() => []);

  const readProbes = () => page.evaluate(() => window.prDemo.snapshot());
  const steps = [{ step: '(initial)', probes: await readProbes().catch((e) => String(e)) }];

  const buttons = await page.$$('[data-action]');
  for (const button of buttons) {
    const scenario = await button.getAttribute('data-scenario');
    const label = `${scenario}: ${(await button.innerText()).trim()}`;
    await button.click();
    await page.waitForFunction(() => window.prDemo.busy === false, null, { timeout: 10000 }).catch(() => {});
    steps.push({ step: label, scenario, probes: await readProbes().catch((e) => String(e)) });
  }

  errors.push(...(await frameErrors()).map((e) => `frame: ${e}`));
  if (args.screenshot) await page.screenshot({ path: resolve(args.screenshot), fullPage: true });
  await browser.close();

  // Report only what differs between Before and After at each step; that's the evidence.
  const lines = [`errors: ${errors.length ? `\n  ${errors.join('\n  ')}` : 'none'}`];
  // After a click, show only the scenario that was acted on; the initial state shows all.
  steps.forEach(({ step, scenario: only, probes }) => {
    if (typeof probes === 'string') {
      lines.push(`${step}\n  probe failed: ${probes}`);
      return;
    }
    // Initial state: differing rows of every scenario. After a click: the clicked scenario's
    // full table, so a "must not change" row is visible as one without ≠.
    const rows = Object.entries(probes)
      .filter(([scenario]) => !only || scenario === only)
      .flatMap(([scenario, list]) => list
        .filter((r) => only || r.changed)
        .map((r) => `  ${r.changed ? '≠' : ' '} [${scenario}] ${r.label}: before ${r.before} → after ${r.after}`));
    lines.push(`${step}\n${rows.length ? rows.join('\n') : '  (no differences)'}`);
  });
  console.log(lines.join('\n'));
  if (errors.length) process.exitCode = 2;
}

// --- clean ------------------------------------------------------------------------

function clean() {
  need('repo', 'pr');
  rmSync(workDir(args.repo, args.pr), { recursive: true, force: true });
  console.log(`removed ${workDir(args.repo, args.pr)}`);
}

const commands = { build, assemble, verify, clean };
if (!commands[command]) fail(`unknown command "${command ?? ''}" — use build | assemble | verify | clean`);
await commands[command]();
