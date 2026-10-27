#!/usr/bin/env node
// Regression tests for release prep's preflight script. Invoked as:
//   node scripts/release-prep-preflight.test.mjs   (npm run test:release-prep)
//
// Dependency-free, like capture-sections.test.mjs. Each case builds a scratch
// git checkout (origin set, never fetched) and puts a stub `gh` first on PATH
// that answers `gh pr list` and `gh api …/branches/<b>` from canned JSON and
// logs every call. Nothing reaches GitHub.
//
// WHY THIS EXISTS. Preflight decides whether release prep writes release
// notes at all (TRD #75 D3), and each of its checks has a quiet wrong answer:
// notes written on a branch that lacks the rc tip miss commits; notes written
// in a checkout of another repo, or on the rc branch itself, never reach the
// release. A case below pins each check, plus the argument forms and the
// "ask, don't guess" outcomes when the rc branch is not clear.
//
// When adding a case, break the behaviour it is named for and confirm this
// file reports that case failing.
import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PREFLIGHT = join(ROOT, 'plugins/auro/skills/release-prep/scripts/preflight.mjs');

const failures = [];
const pass = (name) => console.log(`  ok    ${name}`);
const failCase = (name, detail) => {
  failures.push(`${name}: ${detail}`);
  console.error(`  FAIL  ${name}\n          ${detail}`);
};

// --- stub gh -----------------------------------------------------------------

const GH = `#!/usr/bin/env node
const { appendFileSync } = require('node:fs');
const args = process.argv.slice(2);
appendFileSync(process.env.STUB_GH_LOG, JSON.stringify(args) + '\\n');
if (process.env.STUB_GH_FAIL) {
  console.error('To get started with GitHub CLI, please run:  gh auth login');
  process.exit(4);
}
if (args[0] === 'pr' && args[1] === 'list') {
  console.log(process.env.STUB_GH_PRS || '[]');
} else if (args[0] === 'api') {
  const branch = decodeURIComponent(args[1].split('/branches/')[1] || '');
  const sha = JSON.parse(process.env.STUB_GH_BRANCHES || '{}')[branch];
  if (!sha) { console.error('gh: Branch not found (HTTP 404)'); process.exit(1); }
  console.log(sha);
} else {
  console.error('stub gh: unexpected call'); process.exit(1);
}
`;

const scratchDirs = [];
const scratch = (prefix) => {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  scratchDirs.push(dir);
  return dir;
};

const BIN = scratch('preflight-bin-');
writeFileSync(join(BIN, 'gh'), GH);
chmodSync(join(BIN, 'gh'), 0o755);

// --- scratch checkout ----------------------------------------------------------

function git(repo, ...args) {
  return execFileSync('git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.com', '-c', 'commit.gpgsign=false', '-c', 'tag.gpgsign=false', ...args], {
    cwd: repo,
    encoding: 'utf8',
  }).trim();
}

function write(path, content) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
}

/**
 * A checkout of `origin` (default auro-formkit) with the release-notes paths
 * (unless `notesPaths` is false): `base` → `rcTip` on main, a `feature` branch
 * one commit past the tip (checked out), and a `behind` branch at `base`.
 */
function checkout({ origin = 'AlaskaAirlines/auro-formkit', notesPaths = true } = {}) {
  const repo = scratch('preflight-repo-');
  git(repo, 'init', '-q', '-b', 'main');
  git(repo, 'remote', 'add', 'origin', `git@github.com:${origin}.git`);
  if (notesPaths) {
    write(join(repo, 'docs/releases/Release_Guide_TEMPLATE.md'), '# template\n');
    write(join(repo, 'docs/templates/RELEASE_NOTES.md'), '# notes\n');
  } else {
    write(join(repo, 'README.md'), '# repo\n');
  }
  git(repo, 'add', '.');
  git(repo, 'commit', '-q', '-m', 'chore: base');
  git(repo, 'tag', 'v1.0.0');
  const base = git(repo, 'rev-parse', 'HEAD');
  git(repo, 'commit', '-q', '--allow-empty', '-m', 'feat: on the rc');
  git(repo, 'tag', 'v1.1.0');
  const rcTip = git(repo, 'rev-parse', 'HEAD');
  git(repo, 'branch', 'behind', base);
  git(repo, 'switch', '-q', '-c', 'feature');
  git(repo, 'commit', '-q', '--allow-empty', '-m', 'docs: notes branch');
  return { repo, base, rcTip };
}

const rcPr = (number, branch, sha) => ({ number, url: `https://github.com/AlaskaAirlines/auro-formkit/pull/${number}`, headRefName: branch, headRefOid: sha });

function run(repo, args, { prs = [], branches = {}, ghFails = false, env = {} } = {}) {
  const log = join(scratch('preflight-log-'), 'gh.log');
  writeFileSync(log, '');
  const r = spawnSync('node', [PREFLIGHT, ...args], {
    cwd: repo,
    encoding: 'utf8',
    env: {
      ...process.env,
      ADO_PAT: '',
      ...env,
      PATH: `${BIN}:${process.env.PATH}`,
      STUB_GH_LOG: log,
      STUB_GH_PRS: JSON.stringify(prs),
      STUB_GH_BRANCHES: JSON.stringify(branches),
      STUB_GH_FAIL: ghFails ? '1' : '',
    },
  });
  const lines = {};
  for (const line of r.stdout.split('\n')) {
    const m = line.match(/^([A-Z_]+): (.*)$/);
    if (m) lines[m[1]] = m[2];
  }
  const ghCalls = readFileSync(log, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
  return { status: r.status, lines, ghCalls, raw: r.stdout + r.stderr };
}

/** Assert exact values (string) or a pattern (RegExp) per key; `absent` keys must not be printed. */
function expectLines(name, r, expected, { absent = [], check } = {}) {
  for (const [key, want] of Object.entries(expected)) {
    const got = r.lines[key];
    const ok = want instanceof RegExp ? want.test(got ?? '') : got === want;
    if (!ok) return failCase(name, `${key}: expected ${want}, got ${JSON.stringify(got)}\n          output: ${r.raw.trim().replace(/\n/g, ' | ')}`);
  }
  for (const key of absent) {
    if (key in r.lines) return failCase(name, `${key} should not be printed, got ${JSON.stringify(r.lines[key])}`);
  }
  const detail = check?.(r);
  if (detail) return failCase(name, detail);
  pass(name);
}

// --- cases -------------------------------------------------------------------

const tests = {
  'no arguments: the one open rc PR, from the checkout origin; notes run'() {
    const { repo, rcTip } = checkout();
    const r = run(repo, [], { prs: [rcPr(1626, 'rc/1658589', rcTip), { number: 9, url: 'u', headRefName: 'dev', headRefOid: rcTip }] });
    expectLines('no arguments: the one open rc PR, from the checkout origin; notes run', r, {
      REPO: 'AlaskaAirlines/auro-formkit',
      RELEASED: 'rc/1658589',
      RC_PR: '#1626 https://github.com/AlaskaAirlines/auro-formkit/pull/1626',
      RELEASE_TICKET: 'AB#1658589',
      CORPUS_REF: 'main',
      CAPTURE_ARGS: 'AlaskaAirlines/auro-formkit rc/1658589',
      NOTES: 'run',
      NOTES_ARGS: '(none)',
    });
  },

  'no open rc PR: asks instead of guessing'() {
    const { repo, rcTip } = checkout();
    const r = run(repo, [], { prs: [{ number: 9, url: 'u', headRefName: 'dev', headRefOid: rcTip }] });
    expectLines('no open rc PR: asks instead of guessing', r, { ASK: /no open rc\/\* PR/ }, { absent: ['RELEASED', 'NOTES', 'CAPTURE_ARGS'] });
  },

  'several open rc PRs: asks and lists them'() {
    const { repo, rcTip, base } = checkout();
    const r = run(repo, [], { prs: [rcPr(1, 'rc/111', rcTip), rcPr(2, 'rc/222', base)] });
    expectLines('several open rc PRs: asks and lists them', r, { ASK: /several/, RC_CANDIDATES: 'rc/111 (#1), rc/222 (#2)' }, { absent: ['RELEASED'] });
  },

  'gh fails with no branch given: asks, with the reason'() {
    const { repo } = checkout();
    const r = run(repo, [], { ghFails: true });
    expectLines('gh fails with no branch given: asks, with the reason', r, { ASK: /gh auth login/ }, { absent: ['RELEASED'] });
  },

  'HEAD behind the rc tip: notes skipped, with what to run later'() {
    const { repo, rcTip } = checkout();
    git(repo, 'switch', '-q', 'behind');
    const r = run(repo, [], { prs: [rcPr(1626, 'rc/1658589', rcTip)] });
    expectLines('HEAD behind the rc tip: notes skipped, with what to run later', r, {
      NOTES: /^skip — HEAD \(behind\) does not contain the tip of rc\/1658589/,
      NOTES_LATER: /branch off dev whose HEAD contains rc\/1658589, run \/auro:release-notes$/,
    });
  },

  'rc tip not in this checkout (stale clone): notes skipped'() {
    const { repo } = checkout();
    const r = run(repo, [], { prs: [rcPr(1626, 'rc/1658589', 'f'.repeat(40))] });
    expectLines('rc tip not in this checkout (stale clone): notes skipped', r, { NOTES: /^skip — this checkout does not have the tip of rc\/1658589 \(fffffff\)/ });
  },

  'checkout of another repo: capture still planned, notes skipped'() {
    const { repo, rcTip } = checkout({ origin: 'AlaskaAirlines/auro-tabs' });
    const r = run(repo, ['auro-formkit', 'rc/1658589'], { prs: [rcPr(1626, 'rc/1658589', rcTip)] });
    expectLines('checkout of another repo: capture still planned, notes skipped', r, {
      REPO: 'AlaskaAirlines/auro-formkit',
      CAPTURE_ARGS: 'AlaskaAirlines/auro-formkit rc/1658589',
      NOTES: 'skip — this checkout is AlaskaAirlines/auro-tabs, not AlaskaAirlines/auro-formkit',
    });
  },

  'repo without the release-notes paths: notes skipped as not set up'() {
    const { repo, rcTip } = checkout({ origin: 'AlaskaAirlines/auro-tabs', notesPaths: false });
    const r = run(repo, [], { prs: [{ ...rcPr(7, 'rc/777', rcTip), url: 'https://github.com/AlaskaAirlines/auro-tabs/pull/7' }] });
    expectLines('repo without the release-notes paths: notes skipped as not set up', r, {
      REPO: 'AlaskaAirlines/auro-tabs',
      NOTES: /^skip — repo not set up for release-notes \(missing docs\/releases\/, docs\/releases\/Release_Guide_TEMPLATE\.md, docs\/templates\/RELEASE_NOTES\.md\)$/,
    });
  },

  'HEAD on the rc branch itself: notes skipped (they would be lost)'() {
    const { repo, rcTip } = checkout();
    git(repo, 'switch', '-q', '-c', 'rc/1658589', rcTip);
    const r = run(repo, [], { prs: [rcPr(1626, 'rc/1658589', rcTip)] });
    expectLines('HEAD on the rc branch itself: notes skipped (they would be lost)', r, { NOTES: /^skip — HEAD is the rc branch rc\/1658589; .*lost the next time dev is pushed$/ });
  },

  'a named branch with no PR: tip from gh api, no PR, no ticket'() {
    const { repo, rcTip } = checkout();
    const r = run(repo, ['jjones/hotfix'], { branches: { 'jjones/hotfix': rcTip } });
    expectLines('a named branch with no PR: tip from gh api, no PR, no ticket', r, { RELEASED: 'jjones/hotfix', RC_PR: 'none', RELEASE_TICKET: 'none', NOTES: 'run' }, {
      check: (res) => (res.ghCalls.some((c) => c[0] === 'api' && c[1] === 'repos/AlaskaAirlines/auro-formkit/branches/jjones%2Fhotfix') ? null : `gh calls: ${JSON.stringify(res.ghCalls)}`),
    });
  },

  'a named branch GitHub does not have: notes skipped with the reason'() {
    const { repo } = checkout();
    const r = run(repo, ['rc/404']);
    expectLines('a named branch GitHub does not have: notes skipped with the reason', r, { RELEASED: 'rc/404', RELEASE_TICKET: 'AB#404', NOTES: /^skip — could not find rc\/404 on AlaskaAirlines\/auro-formkit/ });
  },

  'range mode: local range end, no PR lookup, no ticket'() {
    const { repo } = checkout();
    git(repo, 'switch', '-q', '-c', 'replay', 'v1.1.0');
    const r = run(repo, ['auro-formkit', 'v1.0.0..v1.1.0', '--notes-base', 'v1.0.0']);
    expectLines('range mode: local range end, no PR lookup, no ticket', r, {
      RELEASED: 'v1.0.0..v1.1.0 (range)',
      RC_PR: 'none',
      RELEASE_TICKET: 'none',
      CAPTURE_ARGS: 'AlaskaAirlines/auro-formkit v1.0.0..v1.1.0',
      NOTES: 'run',
      NOTES_ARGS: 'v1.0.0',
    }, { check: (res) => (res.ghCalls.length ? `range mode called gh: ${JSON.stringify(res.ghCalls)}` : null) });
  },

  'range end not in this checkout: notes skipped'() {
    const { repo } = checkout();
    const r = run(repo, ['v1.0.0..v9.9.9']);
    expectLines('range end not in this checkout: notes skipped', r, { NOTES: 'skip — the range end v9.9.9 is not in this checkout' });
  },

  '--corpus-ref reaches the capture arguments; --notes-base the notes ones'() {
    const { repo, rcTip } = checkout();
    const r = run(repo, ['rc/1658589', '--corpus-ref', 'jjones/phase-4/AB#1668633', '--notes-base', 'v6.2.1'], { prs: [rcPr(1626, 'rc/1658589', rcTip)] });
    expectLines('--corpus-ref reaches the capture arguments; --notes-base the notes ones', r, {
      CAPTURE_ARGS: 'AlaskaAirlines/auro-formkit rc/1658589 --corpus-ref jjones/phase-4/AB#1668633',
      CORPUS_REF: 'jjones/phase-4/AB#1668633',
      NOTES_ARGS: 'v6.2.1',
      NOTES_LATER: '/auro:release-notes v6.2.1 (re-run here if needed)',
    });
  },

  'a fork PR into main is never taken as the rc branch'() {
    const { repo, rcTip } = checkout();
    const fork = { ...rcPr(66, 'rc/1658589', rcTip), isCrossRepository: true, headRepositoryOwner: { login: 'someone' } };
    const alone = run(repo, [], { prs: [fork] });
    const name = 'a fork PR into main is never taken as the rc branch';
    if (alone.lines.ASK === undefined || 'RELEASED' in alone.lines) return failCase(name, `fork only: ${alone.raw}`);
    const both = run(repo, [], { prs: [fork, { ...rcPr(1626, 'rc/1658589', rcTip), isCrossRepository: false }] });
    if (both.lines.RC_PR !== '#1626 https://github.com/AlaskaAirlines/auro-formkit/pull/1626') return failCase(name, `fork + own: ${both.raw}`);
    pass(name);
  },

  'an rc PR with an unsafe branch name is dropped, and its name never printed'() {
    const { repo, rcTip } = checkout();
    const evil = rcPr(13, 'rc/x;curl$(id)`id`', rcTip);
    const r = run(repo, [], { prs: [evil] });
    expectLines('an rc PR with an unsafe branch name is dropped, and its name never printed', r, { DROPPED: /^1 open rc PR/, ASK: /no open rc/ }, {
      absent: ['RELEASED', 'CAPTURE_ARGS', 'RC_CANDIDATES'],
      check: (res) => (/curl|\$\(|`/.test(res.raw) ? `the unsafe name was printed: ${res.raw}` : null),
    });
  },

  'unsafe arguments: INVALID, nothing planned, the value never printed'() {
    const { repo, rcTip } = checkout();
    const prs = [rcPr(1626, 'rc/1658589', rcTip)];
    const name = 'unsafe arguments: INVALID, nothing planned, the value never printed';
    const cases = [
      [['rc/1;touch pwned'], /the branch or range/],
      [['v1.0.0..v1$(id)'], /the branch or range/],
      [['--corpus-ref', 'main`id`'], /--corpus-ref/],
      [['--notes-base', '--upload-pack=x'], /--notes-base/],
      [['Evil Owner/auro-formkit', 'rc/1'], /the repo/],
    ];
    for (const [args, which] of cases) {
      const r = run(repo, args, { prs });
      if (!which.test(r.lines.INVALID ?? '')) return failCase(name, `${JSON.stringify(args)}: expected INVALID ${which}, got ${r.raw}`);
      if ('CAPTURE_ARGS' in r.lines || 'NOTES' in r.lines) return failCase(name, `${JSON.stringify(args)}: still planned`);
      if (/touch|\$\(|`|upload-pack|Evil/.test(r.raw)) return failCase(name, `${JSON.stringify(args)}: value printed: ${r.raw}`);
    }
    pass(name);
  },

  'ADO_PAT: says whether it is set, never prints it'() {
    const { repo, rcTip } = checkout();
    const r = run(repo, [], { prs: [rcPr(1626, 'rc/1658589', rcTip)], env: { ADO_PAT: 'secret-token-value' } });
    expectLines('ADO_PAT: says whether it is set, never prints it', r, { ADO_PAT: 'set' }, { check: (res) => (res.raw.includes('secret-token-value') ? 'the token was printed' : null) });
  },

  'argument forms: a lone auro-* or Owner/name is the repo; anything else is the branch'() {
    const { repo, rcTip } = checkout();
    const prs = [rcPr(1626, 'rc/1658589', rcTip)];
    const asRepo = run(repo, ['auro-formkit'], { prs });
    const asFullRepo = run(repo, ['AlaskaAirlines/auro-formkit'], { prs });
    const asBranch = run(repo, ['rc/1658589'], { prs });
    const name = 'argument forms: a lone auro-* or Owner/name is the repo; anything else is the branch';
    if (asRepo.lines.REPO !== 'AlaskaAirlines/auro-formkit' || asRepo.lines.RELEASED !== 'rc/1658589') return failCase(name, `auro-formkit: ${asRepo.raw}`);
    if (asFullRepo.lines.REPO !== 'AlaskaAirlines/auro-formkit') return failCase(name, `AlaskaAirlines/auro-formkit: ${asFullRepo.raw}`);
    if (asBranch.lines.RELEASED !== 'rc/1658589' || asBranch.lines.REPO !== 'AlaskaAirlines/auro-formkit') return failCase(name, `rc/1658589: ${asBranch.raw}`);
    pass(name);
  },

  'read-only: only gh pr list and gh api reads, and the checkout is untouched'() {
    const { repo, rcTip } = checkout();
    write(join(repo, 'untracked.txt'), 'x');
    const before = [git(repo, 'rev-parse', 'HEAD'), git(repo, 'status', '--porcelain'), git(repo, 'for-each-ref')].join('\n');
    const r = run(repo, [], { prs: [rcPr(1626, 'rc/1658589', rcTip)] });
    const after = [git(repo, 'rev-parse', 'HEAD'), git(repo, 'status', '--porcelain'), git(repo, 'for-each-ref')].join('\n');
    const name = 'read-only: only gh pr list and gh api reads, and the checkout is untouched';
    if (before !== after) return failCase(name, 'the checkout changed');
    const writes = r.ghCalls.filter((c) => !(c[0] === 'pr' && c[1] === 'list') && !(c[0] === 'api' && !c.includes('-X') && !c.includes('--method')));
    if (writes.length) return failCase(name, `unexpected gh calls: ${JSON.stringify(writes)}`);
    pass(name);
  },
};

console.log('release-prep-preflight.test: running');
try {
  for (const test of Object.values(tests)) test();
} finally {
  for (const dir of scratchDirs) rmSync(dir, { recursive: true, force: true });
}

if (failures.length) {
  console.error(`release-prep-preflight.test: ${failures.length} failure(s)`);
  process.exit(1);
}
console.log(`release-prep-preflight.test: ${Object.keys(tests).length} passed`);
