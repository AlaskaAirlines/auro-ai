#!/usr/bin/env node
// Regression tests for score-trigger-transcript.mjs. Invoked as:
//   node scripts/score-trigger-transcript.test.mjs   (npm run test:trigger)
//
// Dependency-free, like validate-standards.test.mjs: no runner, no
// devDependency, no config. Each case writes a small synthetic JSONL
// transcript to a temp directory, runs the scorer on it, and asserts on the
// exit code and output.
//
// WHY THIS EXISTS. The scorer's contract is "the skill loads before the first
// edit to component source". Review of PR #55 found it measured something
// else, in both directions:
//
//   1. Any Edit/Write counted, so a plan written to /tmp before the skill
//      loaded turned a passing arm into a failing one.
//   2. Edits made through Bash (`sed -i`, `cat >`, `cp`) were invisible, so a
//      session that changed source before the skill loaded read as a pass.
//   3. `--skill` with no value crashed with a TypeError, and `--skill
//      coding-standards` reported NEVER against an `auro:coding-standards`
//      record -- the false negative the scorer was written to prevent.
//
// When adding a case, break the guard it is named for and confirm this file
// reports that case failing. A case that cannot fail is not coverage.
import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const run = promisify(execFile);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SCORER = join(ROOT, 'scripts/score-trigger-transcript.mjs');
const CWD = '/work/auro-formkit';
const SRC = 'components/select/src/auro-select.js';

const failures = [];
const pass = (name) => console.log(`  ok    ${name}`);
const failCase = (name, detail) => {
  failures.push(`${name}: ${detail}`);
  console.error(`  FAIL  ${name}\n          ${detail}`);
};

// Transcript records. Every record carries the session cwd, as Claude Code's do.
const tool = (name, input) => ({ type: 'assistant', cwd: CWD, message: { content: [{ type: 'tool_use', name, input }] } });
const skill = (name = 'auro:coding-standards') => tool('Skill', { skill: name });
const bash = (command) => tool('Bash', { command });

/**
 * Run the scorer on a transcript built from `records`. `args` go before the
 * transcript path and `trailing` after it.
 */
async function score(records, args = [], trailing = []) {
  const dir = await mkdtemp(join(tmpdir(), 'score-trigger-'));
  try {
    const file = join(dir, 't.jsonl');
    await writeFile(file, records.map((r) => JSON.stringify(r)).join('\n') + '\n');
    try {
      const { stdout, stderr } = await run(process.execPath, [SCORER, ...args, file, ...trailing]);
      return { code: 0, stdout, stderr };
    } catch (err) {
      return { code: err.code ?? 1, stdout: err.stdout ?? '', stderr: err.stderr ?? '' };
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/** Assert the scorer exits 0 and its ORDERING line reads `ordering`. */
async function expectOrdering(name, records, ordering, args) {
  const { code, stdout, stderr } = await score(records, args);
  if (code !== 0) return failCase(name, `scorer exited ${code}\n          ${stderr.trim()}`);
  const got = stdout.match(/^ORDERING\s*: (.*)$/m)?.[1];
  if (got !== ordering) return failCase(name, `ORDERING was ${JSON.stringify(got)}, expected ${JSON.stringify(ordering)}`);
  pass(name);
}

const tests = {
  // --- finding 1: scratch writes are not edits ---------------------------------
  async 'a Write to /tmp before the skill loads is not the first edit'() {
    await expectOrdering('a Write to /tmp before the skill loads is not the first edit', [
      tool('Write', { file_path: '/tmp/plan.md' }),
      skill(),
      tool('Edit', { file_path: `${CWD}/${SRC}` }),
    ], 'BEFORE first edit');
  },

  async 'a Write outside the session cwd before the skill loads is not the first edit'() {
    await expectOrdering('a Write outside the session cwd before the skill loads is not the first edit', [
      tool('Write', { file_path: '/home/someone/notes/plan.md' }),
      skill(),
    ], 'fired; no edits made');
  },

  async 'a relative Edit inside the cwd before the skill loads is the first edit'() {
    await expectOrdering('a relative Edit inside the cwd before the skill loads is the first edit', [
      tool('Edit', { file_path: SRC }),
      skill(),
    ], 'AFTER first edit');
  },

  // --- finding 1: Bash edits are edits -----------------------------------------
  async 'sed -i on component source counts as an edit'() {
    await expectOrdering('sed -i on component source counts as an edit', [
      bash(`sed -i '' 's/a/b/' ${SRC}`),
      skill(),
    ], 'AFTER first edit');
  },

  async 'a heredoc redirected into the repo counts as an edit'() {
    await expectOrdering('a heredoc redirected into the repo counts as an edit', [
      bash(`cat > ${SRC} <<'EOF'\nif (a > b) {}\nEOF`),
      skill(),
    ], 'AFTER first edit');
  },

  async 'cp onto a repo path counts as an edit'() {
    await expectOrdering('cp onto a repo path counts as an edit', [
      bash(`cp /tmp/fixed.js ${SRC}`),
      skill(),
    ], 'AFTER first edit');
  },

  async 'tee into a repo path counts as an edit'() {
    await expectOrdering('tee into a repo path counts as an edit', [
      bash(`echo x | tee -a ${SRC}`),
      skill(),
    ], 'AFTER first edit');
  },

  async 'read-only Bash, stderr redirects and scratch output are not edits'() {
    await expectOrdering('read-only Bash, stderr redirects and scratch output are not edits', [
      bash(`grep -n "a > b" ${SRC} 2>/dev/null`),
      bash('npm test > /tmp/out.txt 2>&1'),
      bash('cp src/a.js /tmp/a.js'),
      bash('git diff >"$TMPDIR/d.patch"'),
      bash("cat > /tmp/plan.md <<'EOF'\nkeep a > b in mind\nEOF"),
      skill(),
    ], 'fired; no edits made');
  },

  // --- finding 5: skill name forms and the --skill flag -------------------------
  async '--skill without the namespace matches the namespaced record'() {
    await expectOrdering('--skill without the namespace matches the namespaced record', [
      skill('auro:coding-standards'),
      tool('Edit', { file_path: SRC }),
    ], 'BEFORE first edit', ['--skill', 'coding-standards']);
  },

  async 'the default skill matches an un-namespaced record'() {
    await expectOrdering('the default skill matches an un-namespaced record', [
      skill('coding-standards'),
      tool('Edit', { file_path: SRC }),
    ], 'BEFORE first edit');
  },

  async 'a different skill with the same namespace does not match'() {
    await expectOrdering('a different skill with the same namespace does not match', [
      skill('auro:code-review'),
      tool('Edit', { file_path: SRC }),
    ], 'never fired; edits made');
  },

  async '--skill with no value is a usage error, not a crash'() {
    const name = '--skill with no value is a usage error, not a crash';
    // `--skill` last, after a real transcript: the shape that threw a TypeError.
    const { code, stderr } = await score([skill()], [], ['--skill']);
    if (code === 0) return failCase(name, 'scorer exited 0');
    if (!stderr.includes('usage:') || stderr.includes('TypeError')) {
      return failCase(name, `stderr was not a usage error\n          ${stderr.trim()}`);
    }
    pass(name);
  },

  // --- subagents are flagged, since their edits are not in this file -----------
  async 'a delegated subagent is reported'() {
    const name = 'a delegated subagent is reported';
    const { stdout } = await score([skill(), tool('Task', { description: 'fix it' })]);
    if (!/^subagents at\s*: 2\b/m.test(stdout)) return failCase(name, `no subagent line\n          ${stdout.trim()}`);
    pass(name);
  },
};

console.log('score-trigger-transcript.test: running');
for (const test of Object.values(tests)) await test();

if (failures.length) {
  console.error(`score-trigger-transcript.test: ${failures.length} failure(s)`);
  process.exit(1);
}
console.log(`score-trigger-transcript.test: ${Object.keys(tests).length} passed`);
