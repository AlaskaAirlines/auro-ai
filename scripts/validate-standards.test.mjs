#!/usr/bin/env node
// Regression tests for validate-standards.mjs. Invoked as:
//   node scripts/validate-standards.test.mjs   (npm run test:standards)
//
// Dependency-free by design, like the linter it guards: no runner, no
// devDependency, no config. Each case writes a fixture corpus to a temp
// directory, runs the linter against it, and asserts on exit code and stderr.
//
// WHY THIS EXISTS. Four separate fail-open defects have been found in
// validate-standards.mjs, every one by human review and none by CI:
//
//   1. `section` stayed stale across a non-Rules `##`, so a `###` under a
//      prose heading was validated as a rule.
//   2. TOMBSTONE_RE captured its merge target and discarded it, so a merge
//      into a nonexistent ID passed.
//   3. A fenced `## Retired` inside a rule body flipped section state, and
//      every later rule was exempted from the field checks.
//   4. An unterminated fence swallowed the rest of the file, so later rules
//      were never parsed at all.
//
// All four share a shape: the linter accepts bad input and exits 0. That is
// the worst direction for a check that is the only automated safety net this
// system has — a rule with no traceable source ships and nothing says so. The
// cases below pin each one, so the next parser change cannot quietly reopen
// them.
import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const run = promisify(execFile);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const LINTER = join(ROOT, 'scripts/validate-standards.mjs');
const SKILL_SRC = join(ROOT, 'plugins/auro/skills/coding-standards/SKILL.md');

const CATEGORIES = [
  'a11y', 'form', 'intx', 'life', 'style',
  'api', 'build', 'test', 'xbrw', 'tool',
];

const failures = [];
const pass = (name) => console.log(`  ok    ${name}`);
const failCase = (name, detail) => {
  failures.push(`${name}: ${detail}`);
  console.error(`  FAIL  ${name}\n          ${detail}`);
};

/**
 * Run the linter against a throwaway corpus. `files` maps a category name to
 * the contents of its reference file; every unlisted category gets an empty
 * placeholder so the "all ten must exist" check is satisfied.
 *
 * The real SKILL.md is copied in rather than stubbed, so a change to the
 * routing table cannot silently invalidate these fixtures.
 */
async function lint(files) {
  const dir = await mkdtemp(join(tmpdir(), 'validate-standards-'));
  try {
    const skillDir = join(dir, 'plugins/auro/skills/coding-standards');
    await mkdir(join(skillDir, 'references'), { recursive: true });
    await mkdir(join(dir, 'scripts'), { recursive: true });

    const { readFile, copyFile } = await import('node:fs/promises');
    await copyFile(SKILL_SRC, join(skillDir, 'SKILL.md'));
    await writeFile(join(dir, 'scripts/validate-standards.mjs'), await readFile(LINTER));

    for (const name of CATEGORIES) {
      const body = files[name] ?? `# CS-${name.toUpperCase()}\n\n## Rules\n\n_No rules yet._\n`;
      await writeFile(join(skillDir, 'references', `${name}.md`), body);
    }

    try {
      const { stdout, stderr } = await run(process.execPath, [join(dir, 'scripts/validate-standards.mjs')]);
      return { code: 0, stdout, stderr };
    } catch (err) {
      return { code: err.code ?? 1, stdout: err.stdout ?? '', stderr: err.stderr ?? '' };
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/** Assert the linter rejected the corpus, and that it said why. */
async function expectFail(name, files, expected) {
  const { code, stderr } = await lint(files);
  if (code === 0) return failCase(name, 'linter exited 0 — fail-open');
  if (expected && !stderr.includes(expected)) {
    return failCase(name, `exited ${code} but stderr lacked ${JSON.stringify(expected)}\n          got: ${stderr.trim().split('\n').join('\n          ')}`);
  }
  pass(name);
}

/** Assert the linter accepted the corpus. */
async function expectPass(name, files) {
  const { code, stderr } = await lint(files);
  if (code !== 0) return failCase(name, `linter exited ${code} on valid input\n          ${stderr.trim()}`);
  pass(name);
}

const tests = {
  // --- defect 4: unterminated fence ------------------------------------------
  async 'unterminated fence is reported rather than swallowing the file'() {
    await expectFail('unterminated fence is reported rather than swallowing the file', {
      api: [
        '# CS-API', '', '## Rules', '',
        '### CS-API-001 — A rule with a dropped closing fence', '',
        '- **Sources:** AB#1636704', '',
        '```js', 'const x = 1;', '',
        '### CS-API-002 — Never parsed, and cites no source', '',
        'Body text.', '',
      ].join('\n'),
    }, 'unterminated code fence');
  },

  // --- defect 3: fenced heading flips section state ---------------------------
  async 'a fenced "## Retired" does not change section state'() {
    await expectFail('a fenced "## Retired" does not change section state', {
      api: [
        '# CS-API', '', '## Rules', '',
        '### CS-API-001 — A rule documenting the schema by example', '',
        '- **Sources:** AB#1636704', '',
        '```markdown', '## Retired', '', '### CS-API-900 — superseded', '```', '',
        '### CS-API-002 — Still an active rule, and cites no source', '',
        'Body text.', '',
      ].join('\n'),
    }, 'no source');
  },

  async 'a fenced field does not register as a real field'() {
    await expectFail('a fenced field does not register as a real field', {
      api: [
        '# CS-API', '', '## Rules', '',
        '### CS-API-001 — A rule showing the field syntax', '',
        'Cite the source like this:', '',
        '```markdown', '- **Sources:** AB#1234567', '```', '',
      ].join('\n'),
    }, 'is missing "Sources"');
  },

  async 'a fence indented under a list item is still a fence'() {
    await expectFail('a fence indented under a list item is still a fence', {
      api: [
        '# CS-API', '', '## Rules', '',
        '### CS-API-001 — Indented example', '',
        '- **Sources:** AB#1636704', '',
        '- Example:', '',
        '  ```markdown', '  ## Retired', '  ```', '',
        '### CS-API-002 — Active, cites no source', '', 'Body text.', '',
      ].join('\n'),
    }, 'no source');
  },

  async 'a rule whose body is only a fenced example still counts as a body'() {
    await expectPass('a rule whose body is only a fenced example still counts as a body', {
      api: [
        '# CS-API', '', '## Rules', '',
        '### CS-API-001 — Throw on unresolved imports', '',
        '- **Sources:** AB#1575423', '',
        '```js', "if (w.code === 'UNRESOLVED_IMPORT') throw new Error(w.message);", '```', '',
      ].join('\n'),
    });
  },

  // --- defect 1: stale section across an unrelated `##` -----------------------
  async 'a "###" under an unrelated "##" is reported, not validated as a rule'() {
    await expectFail('a "###" under an unrelated "##" is reported, not validated as a rule', {
      api: [
        '# CS-API', '', '## Rules', '',
        '### CS-API-001 — Real rule', '',
        '- **Sources:** AB#1636704', '', 'Body text.', '',
        '## Notes on this category', '',
        '### Not a rule at all', '',
      ].join('\n'),
    }, 'is not under a "## Rules" or "## Retired" heading');
  },

  // --- defect 2: tombstone targets --------------------------------------------
  async 'a merge tombstone pointing at a nonexistent ID is reported'() {
    await expectFail('a merge tombstone pointing at a nonexistent ID is reported', {
      api: ['# CS-API', '', '## Retired', '', '### CS-API-001 — merged into CS-API-999', ''].join('\n'),
    }, 'does not exist');
  },

  async 'a tombstone cycle is reported rather than looping'() {
    await expectFail('a tombstone cycle is reported rather than looping', {
      api: [
        '# CS-API', '', '## Retired', '',
        '### CS-API-001 — merged into CS-API-002', '',
        '### CS-API-002 — merged into CS-API-001', '',
      ].join('\n'),
    }, 'loops back');
  },

  // --- traceability ------------------------------------------------------------
  async 'a short AB# is rejected as a mistyped pull-request number'() {
    await expectFail('a short AB# is rejected as a mistyped pull-request number', {
      api: [
        '# CS-API', '', '## Rules', '',
        '### CS-API-001 — Learned from a pull request, cited as a work item', '',
        '- **Sources:** AB#1511', '', 'Body text.', '',
      ].join('\n'),
    }, 'not a 7-digit work item');
  },

  async 'a repo reference is a valid source'() {
    await expectPass('a repo reference is a valid source', {
      api: [
        '# CS-API', '', '## Rules', '',
        '### CS-API-001 — Learned from AI review on a formkit pull request', '',
        '- **Sources:** auro-formkit#1511', '', 'Body text.', '',
      ].join('\n'),
    });
  },

  async 'a rule with no source at all is rejected'() {
    await expectFail('a rule with no source at all is rejected', {
      api: ['# CS-API', '', '## Rules', '', '### CS-API-001 — No provenance', '', 'Body text.', ''].join('\n'),
    }, 'no source');
  },

  // --- the phase-1 invariant ----------------------------------------------------
  async 'an empty corpus passes'() {
    await expectPass('an empty corpus passes', {});
  },
};

console.log('validate-standards.test: running');
for (const test of Object.values(tests)) await test();

if (failures.length) {
  console.error(`validate-standards.test: ${failures.length} failure(s)`);
  process.exit(1);
}
console.log(`validate-standards.test: ${Object.keys(tests).length} passed`);
