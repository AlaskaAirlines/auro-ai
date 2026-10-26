#!/usr/bin/env node
// Release prep's preflight (release-prep TRD #75 §4.2, step 0). Read-only: it
// runs `git` in the person's checkout and `gh pr list` / `gh api` (a branch's
// tip) against GitHub, and never fetches, switches branches or writes anything.
// Invoked as:
//
//   preflight.mjs [<repo>] [<rc branch | from..to>] [--corpus-ref <branch>] [--notes-base <ref>]
//
// A positional argument is the repo when it reads as one (`auro-formkit`,
// `AlaskaAirlines/auro-formkit`); anything else is what is being released.
//
// Prints `KEY: value` lines for the skill to show as the plan and to build
// both calls from. The lines it always prints:
//   REPO, CHECKOUT, RELEASED, RC_PR, RELEASE_TICKET, CORPUS_REF, NOTES_BASE,
//   ADO_PAT (set | not set), CAPTURE_ARGS, NOTES (run | skip — <reason>),
//   NOTES_ARGS, NOTES_LATER
// When what is released cannot be decided it prints `ASK: <why>` (and the
// candidates in `RC_CANDIDATES`) instead of RELEASED and the lines after it;
// the skill asks the person and runs preflight again with their answer.
//
// Why a script and not a few inline calls: the notes step's precondition
// (D3) is three checks that each have a quiet wrong answer — a stale
// `origin/rc/*` ref passes the ancestor check against an old tip, and a
// checkout of another repo passes the paths check against the wrong repo.
// Here the rc tip comes from GitHub, not from a local ref, and each check is
// tested offline (scripts/release-prep-preflight.test.mjs).
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

const OWNER = 'AlaskaAirlines';
const NOTES_PATHS = ['docs/releases/', 'docs/releases/Release_Guide_TEMPLATE.md', 'docs/templates/RELEASE_NOTES.md'];

function run(cmd, args, cwd) {
  return execFileSync(cmd, args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

function tryRun(cmd, args, cwd) {
  try {
    return { ok: true, out: run(cmd, args, cwd) };
  } catch (err) {
    const why = (err.stderr || err.message || '').toString().trim().split('\n')[0];
    return { ok: false, out: '', why: err.code === 'ENOENT' ? `${cmd} is not installed` : why };
  }
}

const isRepoArg = (arg) => /^auro-[\w.-]+$/.test(arg) || new RegExp(`^${OWNER}/[\\w.-]+$`, 'i').test(arg);
const fullRepo = (arg) => (arg.includes('/') ? arg : `${OWNER}/${arg}`);
const sameRepo = (a, b) => Boolean(a && b) && a.toLowerCase() === b.toLowerCase();

function parseArgs(argv) {
  const args = { repo: null, released: null, corpusRef: 'main', notesBase: '' };
  const positional = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--corpus-ref' || arg === '--notes-base') {
      if (!argv[i + 1]) throw new Error(`${arg} needs a value`);
      args[arg === '--corpus-ref' ? 'corpusRef' : 'notesBase'] = argv[++i];
    } else if (arg.startsWith('--')) {
      throw new Error(`unknown option ${arg}`);
    } else if (arg.trim()) {
      positional.push(arg.trim());
    }
  }
  if (positional.length > 2) throw new Error(`expected at most a repo and a branch or range, got ${positional.length} arguments`);
  if (positional.length === 2) [args.repo, args.released] = positional;
  else if (positional.length === 1) args[isRepoArg(positional[0]) ? 'repo' : 'released'] = positional[0];
  if (args.repo) args.repo = fullRepo(args.repo);
  return args;
}

/** `Owner/name` of a GitHub remote URL (https or ssh), or null. */
function repoFromUrl(url) {
  const m = (url || '').match(/github\.com[:/]+([^/]+\/[^/]+?)(?:\.git)?\/?$/i);
  return m ? m[1] : null;
}

function checkoutInfo(cwd) {
  const top = tryRun('git', ['rev-parse', '--show-toplevel'], cwd);
  if (!top.ok) return { root: null, repo: null, branch: null };
  const origin = tryRun('git', ['remote', 'get-url', 'origin'], top.out);
  const branch = tryRun('git', ['symbolic-ref', '--quiet', '--short', 'HEAD'], top.out);
  return { root: top.out, repo: origin.ok ? repoFromUrl(origin.out) : null, branch: branch.ok ? branch.out : null };
}

function openRcPrs(repo) {
  const r = tryRun('gh', ['pr', 'list', '-R', repo, '--base', 'main', '--state', 'open', '--limit', '100', '--json', 'number,url,headRefName,headRefOid']);
  if (!r.ok) return { ok: false, why: r.why };
  let prs;
  try {
    prs = JSON.parse(r.out || '[]');
  } catch {
    return { ok: false, why: 'gh pr list returned something that is not JSON' };
  }
  return { ok: true, prs: prs.filter((pr) => /^rc\//.test(pr.headRefName)) };
}

/** Why the notes step cannot run in this checkout, or null when it can. */
function notesBlocker({ args, checkout, tip, released }) {
  if (!checkout.root) return 'this is not a git checkout';
  if (!sameRepo(checkout.repo, args.repo)) return `this checkout is ${checkout.repo ?? 'not a GitHub clone'}, not ${args.repo}`;
  const missing = NOTES_PATHS.filter((p) => !existsSync(join(checkout.root, p)));
  if (missing.length) return `repo not set up for release-notes (missing ${missing.join(', ')})`;
  if (checkout.branch && /^rc\//.test(checkout.branch)) {
    return `HEAD is the rc branch ${checkout.branch}; notes committed there are lost the next time dev is pushed`;
  }
  if (!tip.sha) return tip.why;
  if (!tryRun('git', ['cat-file', '-e', `${tip.sha}^{commit}`], checkout.root).ok) {
    return `this checkout does not have the tip of ${released} (${tip.sha.slice(0, 7)})`;
  }
  if (!tryRun('git', ['merge-base', '--is-ancestor', tip.sha, 'HEAD'], checkout.root).ok) {
    return `HEAD${checkout.branch ? ` (${checkout.branch})` : ''} does not contain the tip of ${released} (${tip.sha.slice(0, 7)})`;
  }
  return null;
}

function preflight(argv, { cwd = process.cwd(), env = process.env } = {}) {
  const lines = [];
  const say = (key, value) => lines.push(`${key}: ${value}`);
  const args = parseArgs(argv);
  const checkout = checkoutInfo(cwd);
  args.repo ??= checkout.repo;
  if (!args.repo) {
    say('ASK', 'which repo is being released? This checkout has no GitHub origin to default to');
    return lines;
  }
  say('REPO', args.repo);
  say('CHECKOUT', checkout.root ? `${checkout.repo ?? 'no GitHub origin'} · ${checkout.branch ?? 'detached HEAD'}` : 'not a git checkout');

  // What is released, and its tip.
  let released = args.released;
  let pr = null;
  let tip = { sha: null, why: null };
  const range = released && released.match(/^(.+?)\.\.(.+)$/);
  if (range) {
    const to = checkout.root && sameRepo(checkout.repo, args.repo) ? tryRun('git', ['rev-parse', '--verify', '--quiet', `${range[2]}^{commit}`], checkout.root) : { ok: false };
    tip = to.ok ? { sha: to.out } : { sha: null, why: `the range end ${range[2]} is not in this checkout` };
  } else {
    const prs = openRcPrs(args.repo);
    if (!released) {
      if (!prs.ok) {
        say('ASK', `could not look up the open rc PR (${prs.why}); which rc branch or from..to range is being released?`);
        return lines;
      }
      if (prs.prs.length !== 1) {
        say('ASK', prs.prs.length ? 'several open rc PRs into main; which one is being released?' : 'no open rc/* PR into main; which branch or from..to range is being released?');
        if (prs.prs.length) say('RC_CANDIDATES', prs.prs.map((p) => `${p.headRefName} (#${p.number})`).join(', '));
        return lines;
      }
      [pr] = prs.prs;
      released = pr.headRefName;
    } else if (prs.ok) {
      pr = prs.prs.find((p) => p.headRefName === released) ?? null;
    }
    if (pr) {
      tip = { sha: pr.headRefOid };
    } else {
      const branch = tryRun('gh', ['api', `repos/${args.repo}/branches/${encodeURIComponent(released)}`, '--jq', '.commit.sha']);
      tip = branch.ok && branch.out ? { sha: branch.out } : { sha: null, why: `could not find ${released} on ${args.repo}${branch.ok ? '' : ` (${branch.why})`}` };
    }
  }

  const ticket = !range && released.match(/^rc\/(\d+)$/);
  say('RELEASED', range ? `${released} (range)` : released);
  say('RC_PR', pr ? `#${pr.number} ${pr.url}` : 'none');
  say('RELEASE_TICKET', ticket ? `AB#${ticket[1]}` : 'none');
  say('CORPUS_REF', args.corpusRef);
  say('NOTES_BASE', args.notesBase || '(automatic)');
  say('ADO_PAT', env.ADO_PAT ? 'set' : 'not set');
  say('CAPTURE_ARGS', [args.repo, released, args.corpusRef !== 'main' ? `--corpus-ref ${args.corpusRef}` : ''].filter(Boolean).join(' '));

  const blocker = notesBlocker({ args, checkout, tip, released });
  say('NOTES', blocker ? `skip — ${blocker}` : 'run');
  say('NOTES_ARGS', args.notesBase || '(none)');
  const notesCmd = `/auro:release-notes${args.notesBase ? ` ${args.notesBase}` : ''}`;
  say(
    'NOTES_LATER',
    blocker
      ? `in a checkout of ${args.repo}, on a branch off dev whose HEAD contains ${released}, run ${notesCmd}`
      : `${notesCmd} (re-run here if needed)`,
  );
  return lines;
}

try {
  console.log(preflight(process.argv.slice(2)).join('\n'));
} catch (err) {
  console.log(`ERROR: ${err.message} — usage: preflight.mjs [<repo>] [<rc branch | from..to>] [--corpus-ref <branch>] [--notes-base <ref>]`);
  process.exit(1);
}
