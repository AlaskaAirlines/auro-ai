#!/usr/bin/env node
// Regression tests for release-notes' next-release helper. Invoked as:
//   node scripts/release-notes-next.test.mjs   (npm run test:release-notes)
//
// Dependency-free, like capture-sections.test.mjs: no runner, no install. Each
// case builds a scratch git repo with a stub node_modules — semantic-release's
// package.json, a cosmiconfig that reads .releaserc or package.json "release",
// and a commit analyzer that applies the config's releaseRules and records what
// it was given — then runs the helper in it and checks its JSON.
//
// WHY THIS EXISTS. release-notes decides the version with the repo's own
// analyzer and release config so the notes and the release cannot disagree
// (release-prep TRD #75, D7). The ways that silently breaks are all in the
// helper's wiring, not the analyzer: the wrong range (a prerelease tag taken as
// the last release), the subject passed instead of the whole message (a
// BREAKING CHANGE footer lost), or the repo's releaseRules never reaching the
// analyzer (formkit's refactor → patch). The stub records its inputs so each
// case can pin one of those. And a checkout with no node_modules must stop
// with `npm ci`, not quietly fall back.
//
// When adding a case, break the behaviour it is named for and confirm this
// file reports that case failing.
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const HELPER = join(ROOT, 'plugins/auro/skills/release-notes/scripts/next-release.mjs');

const failures = [];
const pass = (name) => console.log(`  ok    ${name}`);
const failCase = (name, detail) => {
  failures.push(`${name}: ${detail}`);
  console.error(`  FAIL  ${name}\n          ${detail}`);
};

// --- stubs -------------------------------------------------------------------

const COSMICONFIG = `
const { existsSync, readFileSync } = require('node:fs');
const { join } = require('node:path');
exports.cosmiconfig = (name) => ({
  async search(cwd) {
    const rc = join(cwd, '.releaserc');
    if (existsSync(rc)) return { config: JSON.parse(readFileSync(rc, 'utf8')), filepath: rc };
    const pkg = join(cwd, 'package.json');
    const fromPkg = existsSync(pkg) && JSON.parse(readFileSync(pkg, 'utf8'))[name];
    return fromPkg ? { config: fromPkg, filepath: pkg } : null;
  },
});
`;

// Applies releaseRules ({ type, release }) first, then the default rules, the
// way the real analyzer does, and appends its first call's inputs to a log.
const ANALYZER = `
import { appendFileSync } from 'node:fs';
import { join } from 'node:path';
const ORDER = ['major', 'minor', 'patch'];
const typeOf = (message) => (message.match(/^(\\w+)(\\([^)]*\\))?(!)?:/) || []);
export async function analyzeCommits(pluginConfig, context) {
  appendFileSync(join(context.cwd, '.analyzer-calls.jsonl'), JSON.stringify({ pluginConfig, commits: context.commits, cwd: context.cwd }) + '\\n');
  let best = null;
  for (const { message } of context.commits) {
    const [, type, , bang] = typeOf(message);
    let release = (pluginConfig.releaseRules || []).find((r) => r.type === type)?.release;
    if (release === undefined) {
      if (bang || /BREAKING CHANGE:/.test(message)) release = 'major';
      else if (type === 'feat') release = 'minor';
      else if (type === 'fix' || type === 'perf') release = 'patch';
    }
    if (release && (best === null || ORDER.indexOf(release) < ORDER.indexOf(best))) best = release;
  }
  return best;
}
`;

function write(path, content) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
}

/** Install the stub modules; `omit` leaves one out. */
function installStubs(repo, { omit = [] } = {}) {
  const nm = join(repo, 'node_modules');
  if (!omit.includes('semantic-release')) {
    write(join(nm, 'semantic-release/package.json'), JSON.stringify({ name: 'semantic-release', version: '25.0.0-stub' }));
  }
  if (!omit.includes('cosmiconfig')) {
    write(join(nm, 'cosmiconfig/package.json'), JSON.stringify({ name: 'cosmiconfig', version: '9.0.0-stub', main: 'index.cjs' }));
    write(join(nm, 'cosmiconfig/index.cjs'), COSMICONFIG);
  }
  if (!omit.includes('analyzer')) {
    const dir = join(nm, '@semantic-release/commit-analyzer');
    write(join(dir, 'package.json'), JSON.stringify({ name: '@semantic-release/commit-analyzer', version: '13.0.0-stub', type: 'module', exports: './index.js' }));
    write(join(dir, 'index.js'), ANALYZER);
  }
}

// --- scratch repo ------------------------------------------------------------

const scratchDirs = [];

function makeRepo() {
  const repo = mkdtempSync(join(tmpdir(), 'next-release-'));
  scratchDirs.push(repo);
  git(repo, 'init', '-q', '-b', 'main');
  write(join(repo, '.gitignore'), 'node_modules/\n.analyzer-calls.jsonl\n');
  git(repo, 'add', '.gitignore');
  commit(repo, 'chore: init');
  return repo;
}

function git(repo, ...args) {
  return execFileSync('git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.com', '-c', 'commit.gpgsign=false', '-c', 'tag.gpgsign=false', ...args], {
    cwd: repo,
    encoding: 'utf8',
  });
}

const commit = (repo, message) => git(repo, 'commit', '-q', '--allow-empty', '-m', message);
const tag = (repo, name) => git(repo, 'tag', name);

const FORMKIT_RC = {
  branches: ['main'],
  plugins: [
    [
      '@semantic-release/commit-analyzer',
      {
        preset: 'conventionalcommits',
        releaseRules: [
          { type: 'refactor', release: 'patch' },
          { type: 'style', release: 'patch' },
        ],
      },
    ],
    '@semantic-release/release-notes-generator',
  ],
};

function releaserc(repo, config = FORMKIT_RC) {
  write(join(repo, '.releaserc'), JSON.stringify(config));
}

/** A repo released at v1.2.0, with a later prerelease tag and an older v1.1.0. */
function releasedRepo() {
  const repo = makeRepo();
  installStubs(repo);
  releaserc(repo);
  commit(repo, 'feat: first');
  tag(repo, 'v1.1.0');
  commit(repo, 'fix: before the release');
  tag(repo, 'v1.2.0');
  commit(repo, 'docs: after the release');
  tag(repo, 'v1.2.1-rc-1658589.1');
  return repo;
}

function run(repo, args = [], cwd = repo) {
  const r = spawnSync('node', [HELPER, ...args], { cwd, encoding: 'utf8' });
  let json = null;
  try {
    json = JSON.parse(r.stdout);
  } catch {
    // left null; the case reports the raw output
  }
  return { status: r.status, json, raw: r.stdout + r.stderr };
}

function calls(repo) {
  try {
    return readFileSync(join(repo, '.analyzer-calls.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  } catch {
    return [];
  }
}

/** Assert a successful run's fields; `check` may return a failure detail. */
function expectResult(name, r, expected, check) {
  if (r.status !== 0 || !r.json || r.json.error) return failCase(name, `expected success, got status ${r.status}: ${r.raw.trim()}`);
  for (const [key, value] of Object.entries(expected)) {
    if (JSON.stringify(r.json[key]) !== JSON.stringify(value)) {
      return failCase(name, `${key}: expected ${JSON.stringify(value)}, got ${JSON.stringify(r.json[key])}`);
    }
  }
  const detail = check?.(r.json);
  if (detail) return failCase(name, detail);
  pass(name);
}

function expectError(name, r, code, mentions) {
  if (r.status !== 1 || r.json?.error !== code) return failCase(name, `expected error ${code} and exit 1, got status ${r.status}: ${r.raw.trim()}`);
  if (mentions && !r.json.message.includes(mentions)) return failCase(name, `message lacks "${mentions}": ${r.json.message}`);
  pass(name);
}

// --- cases -------------------------------------------------------------------

const tests = {
  'no node_modules: stops and says to run npm ci'() {
    const repo = makeRepo();
    releaserc(repo);
    tag(repo, 'v1.0.0');
    commit(repo, 'feat: something');
    expectError('no node_modules: stops and says to run npm ci', run(repo), 'NOT_INSTALLED', 'npm ci');
  },

  'semantic-release without its analyzer: stops and names it'() {
    const repo = makeRepo();
    installStubs(repo, { omit: ['analyzer'] });
    releaserc(repo);
    tag(repo, 'v1.0.0');
    expectError('semantic-release without its analyzer: stops and names it', run(repo), 'NOT_INSTALLED', '@semantic-release/commit-analyzer');
  },

  'range starts at the highest stable tag, not a prerelease or older tag'() {
    const repo = releasedRepo();
    commit(repo, 'feat: new thing');
    expectResult(
      'range starts at the highest stable tag, not a prerelease or older tag',
      run(repo),
      { releaseType: 'minor', lastTag: 'v1.2.0', lastVersion: '1.2.0', nextVersion: '1.3.0', range: 'v1.2.0..HEAD', commitCount: 2 },
    );
  },

  'a newer tag HEAD does not contain is not the last release'() {
    // semantic-release counts only tags merged into the branch. A hotfix tagged
    // on another branch, or a later release when replaying an old one, must not
    // become the range start.
    const repo = releasedRepo();
    git(repo, 'checkout', '-q', '-b', 'hotfix');
    commit(repo, 'fix: hotfix elsewhere');
    tag(repo, 'v1.3.0');
    git(repo, 'checkout', '-q', 'main');
    commit(repo, 'fix: on this branch');
    expectResult(
      'a newer tag HEAD does not contain is not the last release',
      run(repo),
      { releaseType: 'patch', lastTag: 'v1.2.0', nextVersion: '1.2.1', range: 'v1.2.0..HEAD', commitCount: 2 },
    );
  },

  "the repo's releaseRules reach the analyzer (refactor is a patch)"() {
    const repo = releasedRepo();
    commit(repo, 'refactor(select): tidy');
    expectResult("the repo's releaseRules reach the analyzer (refactor is a patch)", run(repo), { releaseType: 'patch', nextVersion: '1.2.1' }, () => {
      const first = calls(repo)[0];
      if (first?.pluginConfig?.preset !== 'conventionalcommits') return `analyzer got preset ${first?.pluginConfig?.preset}`;
      return null;
    });
  },

  'nothing release-worthy: none, with no next version'() {
    const repo = releasedRepo();
    commit(repo, 'chore: deps');
    expectResult('nothing release-worthy: none, with no next version', run(repo), { releaseType: 'none', nextVersion: null, commitCount: 2, triggers: [] });
  },

  'no commits since the release: none'() {
    const repo = makeRepo();
    installStubs(repo);
    releaserc(repo);
    tag(repo, 'v2.0.0');
    expectResult('no commits since the release: none', run(repo), { releaseType: 'none', commitCount: 0 });
  },

  'the whole message reaches the analyzer (BREAKING CHANGE footer is major)'() {
    const repo = releasedRepo();
    commit(repo, 'fix(combobox): rename an event\n\nBREAKING CHANGE: the change event is now auroChange');
    expectResult(
      'the whole message reaches the analyzer (BREAKING CHANGE footer is major)',
      run(repo),
      { releaseType: 'major', nextVersion: '2.0.0' },
      (json) => (json.triggers.some((t) => t.type === 'major' && t.subject === 'fix(combobox): rename an event') ? null : `triggers: ${JSON.stringify(json.triggers)}`),
    );
  },

  'triggers name each release-worthy commit by subject'() {
    const repo = releasedRepo();
    commit(repo, 'feat(menu): add a thing');
    commit(repo, 'fix(menu): fix a thing');
    expectResult('triggers name each release-worthy commit by subject', run(repo), { releaseType: 'minor' }, (json) => {
      const got = json.triggers.map((t) => `${t.type} ${t.subject}`).sort();
      const want = ['minor feat(menu): add a thing', 'patch fix(menu): fix a thing'];
      return JSON.stringify(got) === JSON.stringify(want) ? null : `triggers: ${JSON.stringify(got)}`;
    });
  },

  'config from package.json "release" with default plugins'() {
    const repo = makeRepo();
    installStubs(repo);
    write(join(repo, 'package.json'), JSON.stringify({ name: 'x', release: { branches: ['main'], releaseRules: [{ type: 'style', release: 'patch' }] } }));
    tag(repo, 'v3.0.0');
    commit(repo, 'style: spacing');
    expectResult('config from package.json "release" with default plugins', run(repo), { releaseType: 'patch', config: 'package.json' });
  },

  'plugins without the analyzer: stops'() {
    const repo = makeRepo();
    installStubs(repo);
    releaserc(repo, { branches: ['main'], plugins: ['@semantic-release/npm'] });
    tag(repo, 'v1.0.0');
    expectError('plugins without the analyzer: stops', run(repo), 'NO_ANALYZER');
  },

  'tagFormat from the config picks the tag'() {
    const repo = makeRepo();
    installStubs(repo);
    releaserc(repo, { ...FORMKIT_RC, tagFormat: 'auro-tabs@${version}' });
    tag(repo, 'v9.9.9');
    tag(repo, 'auro-tabs@1.4.0');
    commit(repo, 'fix: tab focus');
    expectResult('tagFormat from the config picks the tag', run(repo), { lastTag: 'auro-tabs@1.4.0', nextVersion: '1.4.1' });
  },

  '--from overrides the range start'() {
    const repo = releasedRepo();
    commit(repo, 'fix: one');
    expectResult('--from overrides the range start', run(repo, ['--from', 'v1.1.0']), { range: 'v1.1.0..HEAD', commitCount: 3, lastVersion: '1.1.0', nextVersion: '1.1.1' });
  },

  '--from a commit that is not a release tag keeps the last tag for the version'() {
    const repo = releasedRepo();
    commit(repo, 'fix: one');
    const base = git(repo, 'rev-parse', 'v1.1.0').trim();
    expectResult('--from a commit that is not a release tag keeps the last tag for the version', run(repo, ['--from', base]), { lastTag: 'v1.2.0', nextVersion: '1.2.1' });
  },

  '--from a release tag makes it the last release (re-running an old release)'() {
    const repo = releasedRepo();
    expectResult(
      '--from a release tag makes it the last release (re-running an old release)',
      run(repo, ['--from', 'v1.1.0', '--to', 'v1.2.0']),
      { releaseType: 'patch', lastTag: 'v1.1.0', nextVersion: '1.1.1', range: 'v1.1.0..v1.2.0', commitCount: 1 },
    );
  },

  'an unknown --from ref: stops'() {
    const repo = releasedRepo();
    expectError('an unknown --from ref: stops', run(repo, ['--from', 'no-such-ref']), 'BAD_REF');
  },

  'no release tag: says to fetch tags or pass a base ref'() {
    const repo = makeRepo();
    installStubs(repo);
    releaserc(repo);
    commit(repo, 'feat: unreleased');
    expectError('no release tag: says to fetch tags or pass a base ref', run(repo), 'NO_RELEASE_TAG', 'git fetch --tags');
  },

  'run from a subdirectory: finds the repo root'() {
    const repo = releasedRepo();
    commit(repo, 'feat: deep');
    mkdirSync(join(repo, 'components/select'), { recursive: true });
    expectResult('run from a subdirectory: finds the repo root', run(repo, [], join(repo, 'components/select')), { releaseType: 'minor', config: '.releaserc' });
  },
};

console.log('release-notes-next.test: running');
try {
  for (const test of Object.values(tests)) test();
} finally {
  for (const dir of scratchDirs) rmSync(dir, { recursive: true, force: true });
}

if (failures.length) {
  console.error(`release-notes-next.test: ${failures.length} failure(s)`);
  process.exit(1);
}
console.log(`release-notes-next.test: ${Object.keys(tests).length} passed`);
