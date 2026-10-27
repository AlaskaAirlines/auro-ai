#!/usr/bin/env node
// Decide the next release type the way the real release will: with
// semantic-release's commit analyzer, loaded from the repo's own node_modules,
// using the repo's own release config, over the commits since the last release
// tag (release-prep TRD #75, D7). Invoked from the repo being released:
//
//   next-release.mjs [--from <ref>] [--to <ref>]
//
// --from overrides the start of the range (default: the last release tag); a
// release tag given here is also taken as the last release, for the version.
// --to   overrides the end of the range (default: HEAD).
//
// Prints one JSON object on stdout and exits 0:
//   { "releaseType": "major" | "minor" | "patch" | "none", "lastTag", "lastVersion",
//     "nextVersion", "range", "commitCount", "triggers": [{ "hash", "subject", "type" }],
//     "config", "semanticRelease", "analyzer" }
// On any failure it prints { "error": "<CODE>", "message": "<what to do>" } and exits 1.
//
// Why load the repo's copies rather than reimplement the rules: the release
// config can change what releases (auro-formkit's .releaserc makes refactor,
// style and docs(README) patch releases), and only the analyzer the release
// runs, with the config it reads, is sure to agree with it. Nothing here is
// installed or imported from auro-ai: no node_modules in the repo is an error.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, relative } from 'node:path';
import { pathToFileURL } from 'node:url';

const ANALYZER = '@semantic-release/commit-analyzer';

class Stop extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

function git(root, args) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

function parseArgs(argv) {
  const args = { from: null, to: 'HEAD' };
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    if (flag === '--from' || flag === '--to') {
      if (!argv[i + 1]) throw new Stop('USAGE', `${flag} needs a ref — usage: next-release.mjs [--from <ref>] [--to <ref>]`);
      args[flag.slice(2)] = argv[++i];
    } else {
      throw new Stop('USAGE', `unknown argument "${flag}" — usage: next-release.mjs [--from <ref>] [--to <ref>]`);
    }
  }
  return args;
}

/** Resolve `name` from the first base that has it, or null. */
function resolveFrom(bases, name) {
  for (const base of bases) {
    try {
      return createRequire(base).resolve(name);
    } catch {
      // try the next base
    }
  }
  return null;
}

/**
 * A package's package.json, or null. Tries `<name>/package.json` first; a
 * package whose `exports` hides it (the commit analyzer does) is found by
 * walking up from its resolved entry point.
 */
function resolvePackageJson(bases, name) {
  const direct = resolveFrom(bases, `${name}/package.json`);
  if (direct) return direct;
  const main = resolveFrom(bases, name);
  for (let dir = main && dirname(main); dir && dir !== dirname(dir); dir = dirname(dir)) {
    const candidate = join(dir, 'package.json');
    try {
      if (JSON.parse(readFileSync(candidate, 'utf8')).name === name) return candidate;
    } catch {
      // keep walking
    }
  }
  return null;
}

async function importPath(path) {
  return import(pathToFileURL(path).href);
}

const versionOf = (pkgJsonPath) => JSON.parse(readFileSync(pkgJsonPath, 'utf8')).version;

/** semantic-release, and the analyzer and config loader it depends on, from the repo's node_modules. */
async function loadTools(root) {
  const repoBase = join(root, 'package.json');
  const srPkg = resolvePackageJson([repoBase], 'semantic-release');
  if (!srPkg) {
    throw new Stop(
      'NOT_INSTALLED',
      'semantic-release is not installed in this checkout (no node_modules/semantic-release). Run `npm ci` in the repo root, then re-run.',
    );
  }
  // The analyzer and cosmiconfig are semantic-release's own dependencies, so
  // resolve them from its location first, as the release does.
  const bases = [srPkg, repoBase];
  const analyzerPkg = resolvePackageJson(bases, ANALYZER);
  const analyzerMain = resolveFrom(bases, ANALYZER);
  const cosmiconfigMain = resolveFrom(bases, 'cosmiconfig');
  if (!analyzerPkg || !analyzerMain || !cosmiconfigMain) {
    const missing = [!analyzerMain && ANALYZER, !cosmiconfigMain && 'cosmiconfig'].filter(Boolean).join(' and ');
    throw new Stop('NOT_INSTALLED', `${missing} is missing from node_modules. Run \`npm ci\` in the repo root, then re-run.`);
  }
  const analyzer = await importPath(analyzerMain);
  const analyzeCommits = analyzer.analyzeCommits ?? analyzer.default?.analyzeCommits;
  const cosmi = await importPath(cosmiconfigMain);
  const cosmiconfig = cosmi.cosmiconfig ?? cosmi.default?.cosmiconfig;
  if (typeof analyzeCommits !== 'function' || typeof cosmiconfig !== 'function') {
    throw new Stop('NOT_INSTALLED', `the installed ${ANALYZER} or cosmiconfig has an unexpected shape. Run \`npm ci\`, then re-run.`);
  }
  return {
    analyzeCommits,
    cosmiconfig,
    semanticRelease: versionOf(srPkg),
    analyzer: `${ANALYZER}@${versionOf(analyzerPkg)}`,
    srPkg,
  };
}

/** The release config exactly as semantic-release finds it, with `extends` merged in. */
async function loadConfig(root, tools) {
  const found = (await tools.cosmiconfig('release').search(root)) || {};
  let { extends: extendPaths, ...options } = found.config || {};
  if (extendPaths) {
    let merged = {};
    for (const path of [].concat(extendPaths)) {
      const resolved = resolveFrom([tools.srPkg, join(root, 'package.json')], path);
      if (!resolved) throw new Stop('CONFIG_FAILED', `the release config extends "${path}", which is not installed. Run \`npm ci\`.`);
      const mod = await importPath(resolved);
      merged = { ...merged, ...(mod.default ?? mod) };
    }
    options = { ...merged, ...options };
  }
  return { options, file: found.filepath ? relative(root, found.filepath) : null };
}

/** The analyzer's plugin config: global options overlaid with its own entry, as semantic-release passes them. */
function analyzerConfig(options) {
  if (!options.plugins) return { ...options }; // semantic-release's default plugins include the analyzer with no options
  for (const entry of options.plugins) {
    const [name, config] = Array.isArray(entry) ? entry : [entry, {}];
    if (name === ANALYZER) return { ...options, ...config };
  }
  throw new Stop('NO_ANALYZER', `the release config's plugins do not include ${ANALYZER}, so this helper cannot tell what the release will decide.`);
}

/**
 * The last release: the highest stable (non-prerelease) tag matching the
 * config's tagFormat among the tags HEAD contains — semantic-release only counts
 * tags merged into the branch, so a newer tag elsewhere (a hotfix on main not yet
 * in dev, or a later release when replaying an old one) must not move the range.
 * When the range start is itself such a tag (`--from
 * v6.2.1`, re-running an old release), that tag is the last release instead.
 */
function lastReleaseTag(root, tagFormat = 'v${version}', from = null) {
  const escaped = tagFormat.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace('\\$\\{version\\}', '(\\d+)\\.(\\d+)\\.(\\d+)');
  const pattern = new RegExp(`^${escaped}$`);
  const version = (tag) => tag.match(pattern)?.slice(1, 4).map(Number) ?? null; // null for prerelease tags such as v6.2.2-rc-1658589.1
  if (from && version(from)) return { tag: from, version: version(from).join('.') };
  const newer = (a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
  let best = null;
  for (const tag of git(root, ['tag', '--merged', 'HEAD']).split('\n').map((t) => t.trim())) {
    const v = version(tag);
    if (v && (!best || newer(v, best.v) > 0)) best = { tag, v };
  }
  return best && { tag: best.tag, version: best.v.join('.') };
}

function nextVersion(version, type) {
  if (!version || type === 'none') return null;
  const [major, minor, patch] = version.split('.').map(Number);
  if (type === 'major') return `${major + 1}.0.0`;
  if (type === 'minor') return `${major}.${minor + 1}.0`;
  return `${major}.${minor}.${patch + 1}`;
}

/** Commits in the range, as semantic-release reads them: hash and full raw message. */
function commitsIn(root, range) {
  const out = git(root, ['log', '--format=%H%x1f%B%x1e', range]);
  return out
    .split('\x1e')
    .map((record) => record.replace(/^\n+/, ''))
    .filter(Boolean)
    .map((record) => {
      const [hash, message = ''] = record.split('\x1f');
      return { hash, message: message.replace(/\n+$/, '') };
    });
}

function verifyRef(root, ref) {
  try {
    git(root, ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`]);
  } catch {
    throw new Stop('BAD_REF', `"${ref}" does not resolve to a commit in this checkout.`);
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  let root;
  try {
    root = git(process.cwd(), ['rev-parse', '--show-toplevel']).trim();
  } catch {
    throw new Stop('NOT_A_GIT_REPO', 'run this from inside the repo being released.');
  }

  const tools = await loadTools(root);
  const { options, file } = await loadConfig(root, tools);
  const pluginConfig = analyzerConfig(options);

  const last = lastReleaseTag(root, options.tagFormat, args.from);
  const from = args.from ?? last?.tag;
  if (!from) {
    throw new Stop(
      'NO_RELEASE_TAG',
      `no release tag matching "${options.tagFormat ?? 'v${version}'}" in this checkout. Run \`git fetch --tags\`, or pass a base ref.`,
    );
  }
  verifyRef(root, from);
  verifyRef(root, args.to);
  const range = `${from}..${args.to}`;
  const commits = commitsIn(root, range);

  const quiet = { log() {}, error() {}, warn() {}, success() {} };
  const context = (list) => ({ commits: list, logger: quiet, cwd: root, env: process.env, options });
  let type;
  const triggers = [];
  try {
    type = commits.length ? (await tools.analyzeCommits(pluginConfig, context(commits))) || 'none' : 'none';
    // Per commit, so the report can name what triggered the bump.
    for (const commit of commits) {
      const one = await tools.analyzeCommits(pluginConfig, context([commit]));
      if (one) triggers.push({ hash: commit.hash.slice(0, 7), subject: commit.message.split('\n')[0], type: one });
    }
  } catch (err) {
    throw new Stop('ANALYZER_FAILED', `the commit analyzer failed: ${err.message}`);
  }

  return {
    releaseType: type,
    lastTag: last?.tag ?? null,
    lastVersion: last?.version ?? null,
    nextVersion: nextVersion(last?.version, type),
    range,
    commitCount: commits.length,
    triggers,
    config: file,
    semanticRelease: tools.semanticRelease,
    analyzer: tools.analyzer,
  };
}

main().then(
  (result) => console.log(JSON.stringify(result, null, 2)),
  (err) => {
    const code = err instanceof Stop ? err.code : 'FAILED';
    console.log(JSON.stringify({ error: code, message: err.message }, null, 2));
    process.exit(1);
  },
);
