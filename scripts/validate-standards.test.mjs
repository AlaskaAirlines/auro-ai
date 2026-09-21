#!/usr/bin/env node
// Regression tests for validate-standards.mjs. Invoked as:
//   node scripts/validate-standards.test.mjs   (npm run test:standards)
//
// Dependency-free by design, like the linter it guards: no runner, no
// devDependency, no config. Each case writes a fixture corpus to a temp
// directory, runs the linter against it, and asserts on exit code and stderr.
//
// WHY THIS EXISTS. Thirteen separate fail-open defects have been found in
// validate-standards.mjs, every one by review and none by CI. The first seven,
// which this suite was built to pin:
//
//   1. `section` stayed stale across a non-Rules `##`, so a `###` under a
//      prose heading was validated as a rule.
//   2. TOMBSTONE_RE captured its merge target and discarded it, so a merge
//      into a nonexistent ID passed.
//   3. A fenced `## Retired` inside a rule body flipped section state, and
//      every later rule was exempted from the field checks.
//   4. An unterminated fence swallowed the rest of the file, so later rules
//      were never parsed at all.
//   5. ADO_SOURCE_RE was case-sensitive, so `ab#1511` fell through to the
//      repo form, was captured as a repository named `ab`, and skipped the
//      7-digit work-item check that case 4's commit had just added.
//   6. HTML comments were only honoured when deciding body content, so a
//      commented-out `Sources` line satisfied the field check and a
//      commented-out `## Retired` flipped section state — case 3's defect
//      through the other markdown comment mechanism.
//   7. An unterminated `<!--` swallowed the rest of the file — case 4 again,
//      one character different.
//
// Six more were found after this suite existed, by review passes over the
// commits that were each said to have closed the class:
//
//   8.  An indented `###` was not exempt from the checks but absent from
//       them — the fence regex had been loosened to `^\s*` while the heading
//       and field regexes stayed `^`-anchored.
//   9.  A `~~~` line closed a ``` fence, because one boolean tracked both.
//   10. A merge tombstone under `## Rules` short-circuited every field check.
//   11. TOMBSTONE_RE was case-sensitive, so `Merged into ...` was not a
//       tombstone and its target was never resolved.
//   12. A merge could point at a rule that is itself retired.
//   13. FENCE_RE still had no indent cap after 8 fixed the other half, so a
//       four-space-indented fence pair swallowed an un-indented rule, and a
//       lone indented pseudo-fence desynced the parity silently.
//
// All thirteen share a shape: the linter accepts bad input and exits 0. That
// is the worst direction for a check that is the only automated safety net
// this system has — a rule with no traceable source ships and nothing says so.
// The cases below pin each one, so the next parser change cannot quietly
// reopen them.
//
// Five cases in this file have themselves been vacuous — passing against a
// linter with the guard deleted, because something else in the same fixture
// satisfied the asserted message. When adding a case, delete the guard it is
// named for and confirm this file reports that case failing. A case that
// cannot fail is cited as coverage it does not provide.
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

// A minimal routing table: one line per category, enough for the reachability
// scan to resolve every reference file. Used by the SKILL.md-override cases,
// which vary one thing at a time against this baseline.
const ROUTES = CATEGORIES.map((name) => `| \`references/${name}.md\` | when it applies |`);

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
async function lint(files, skill) {
  const dir = await mkdtemp(join(tmpdir(), 'validate-standards-'));
  try {
    const skillDir = join(dir, 'plugins/auro/skills/coding-standards');
    await mkdir(join(skillDir, 'references'), { recursive: true });
    await mkdir(join(dir, 'scripts'), { recursive: true });

    const { readFile, copyFile } = await import('node:fs/promises');
    // The real SKILL.md by default, so a routing-table change cannot silently
    // invalidate these fixtures. `skill` overrides it for the cases that need
    // to assert on SKILL.md itself — without the hook, the frontmatter guards
    // were structurally untestable, including the `disable-model-invocation`
    // ban the whole design rests on.
    if (skill === undefined) await copyFile(SKILL_SRC, join(skillDir, 'SKILL.md'));
    else await writeFile(join(skillDir, 'SKILL.md'), skill);
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
async function expectFail(name, files, expected, skill) {
  const { code, stderr } = await lint(files, skill);
  if (code === 0) return failCase(name, 'linter exited 0 — fail-open');
  if (expected && !stderr.includes(expected)) {
    return failCase(name, `exited ${code} but stderr lacked ${JSON.stringify(expected)}\n          got: ${stderr.trim().split('\n').join('\n          ')}`);
  }
  pass(name);
}

/** Assert the linter accepted the corpus. */
async function expectPass(name, files, skill) {
  const { code, stderr } = await lint(files, skill);
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
    // The fence marker is indented; its *content* is not. An earlier version of
    // this case indented the content too, which made it vacuous — the enclosed
    // `## Retired` could never have flipped section state regardless of the
    // fence, so the case passed with the guard removed.
    await expectFail('a fence indented under a list item is still a fence', {
      api: [
        '# CS-API', '', '## Rules', '',
        '### CS-API-001 — Indented example', '',
        '- **Sources:** AB#1636704', '',
        '- Example:', '',
        '  ```markdown', '## Retired', '  ```', '',
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

  async 'a lowercase ab# is rejected, not captured as a repo named "ab"'() {
    await expectFail('a lowercase ab# is rejected, not captured as a repo named "ab"', {
      api: [
        '# CS-API', '', '## Rules', '',
        '### CS-API-001 — A work item cited with a lowercase prefix', '',
        '- **Sources:** ab#1511', '', 'Body text.', '',
      ].join('\n'),
    }, 'not a 7-digit work item');
  },

  // --- defect 5: HTML comments were not treated as non-structure --------------
  async 'a commented-out field does not register as a real field'() {
    await expectFail('a commented-out field does not register as a real field', {
      api: [
        '# CS-API', '', '## Rules', '',
        '### CS-API-001 — A rule with the schema template left commented out', '',
        'Body text.', '',
        '<!--', '- **Sources:** AB#1234567', '- **Since:** 2026-09-18', '-->', '',
      ].join('\n'),
    }, 'is missing "Sources"');
  },

  async 'a commented-out "## Retired" does not change section state'() {
    await expectFail('a commented-out "## Retired" does not change section state', {
      api: [
        '# CS-API', '', '## Rules', '',
        '### CS-API-001 — A rule with a retired block commented out', '',
        '- **Sources:** AB#1636704', '',
        '<!--', '## Retired', '', '### CS-API-900 — superseded', '-->', '',
        '### CS-API-002 — Still an active rule, and cites no source', '',
        'Body text.', '',
      ].join('\n'),
    }, 'no source');
  },

  async 'an unterminated HTML comment is reported rather than swallowing the file'() {
    await expectFail('an unterminated HTML comment is reported rather than swallowing the file', {
      api: [
        '# CS-API', '', '## Rules', '',
        '### CS-API-001 — A rule with a dropped comment close', '',
        '- **Sources:** AB#1636704', '',
        '<!-- TODO: revisit this wording', '',
        '### CS-API-002 — Never parsed, and cites no source', '',
        'Body text.', '',
      ].join('\n'),
    }, 'unterminated HTML comment');
  },

  async 'a commented-out fence marker does not open a fence'() {
    // The marker must start its line inside a multi-line comment. An earlier
    // version used an inline `<!-- ```js -->`, which the fence regex never
    // matched anyway, so the case passed with comment tracking removed.
    await expectFail('a commented-out fence marker does not open a fence', {
      api: [
        '# CS-API', '', '## Rules', '',
        '### CS-API-001 — A rule whose example fence is commented out', '',
        '- **Sources:** AB#1636704', '',
        '<!--', '```js', 'const x = 1;', '-->', '',
        '### CS-API-002 — Active, cites no source', '', 'Body text.', '',
      ].join('\n'),
    }, 'no source');
  },

  async 'a fenced HTML comment is example text, not a comment'() {
    // Asserted as a *pass*: if the fenced `<!--` were treated as a real comment
    // opener it would never close, and the run would fail with "unterminated
    // HTML comment". Asserting a failure message here made the case vacuous,
    // since an unrelated sourceless rule satisfied it either way.
    await expectPass('a fenced HTML comment is example text, not a comment', {
      api: [
        '# CS-API', '', '## Rules', '',
        '### CS-API-001 — A rule documenting the Phase 4 scope header', '',
        '- **Sources:** AB#1636704', '',
        '```markdown', '<!-- scope: paths=src/**', '```', '',
        '### CS-API-002 — Active, and properly sourced', '',
        '- **Sources:** AB#1344690', '', 'Body text.', '',
      ].join('\n'),
    });
  },

  async 'a trailing inline comment does not break the line it annotates'() {
    // The comment on the `Sources` line carries a second, distinct `AB#` so the
    // case can tell whether stripping actually happened. Without it the test was
    // vacuous: `HEADING_RE` swallows a trailing comment into the title (still
    // under the 80-char cap) and `ADO_SOURCE_RE` substring-matches straight
    // through trailing junk, so the run passed with the stripping removed. Now
    // an unstripped comment yields two sources and no `Learned` field.
    await expectPass('a trailing inline comment does not break the line it annotates', {
      api: [
        '# CS-API', '', '## Rules', '',
        '### CS-API-001 — Throw on unresolved imports <!-- reworded 2026-09-18 -->', '',
        '- **Sources:** AB#1575423 <!-- superseded AB#7654321, kept for history -->', '',
        'Body text.', '',
      ].join('\n'),
    });
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

  // --- defect 8: an indented heading was invisible, not exempt -----------------
  async 'an indented rule heading is still parsed and validated'() {
    await expectFail('an indented rule heading is still parsed and validated', {
      api: ['# CS-API', '', '## Rules', '', '  ### CS-API-001 — Indented, cites no source', '', '  Body text.', ''].join('\n'),
    }, 'no source');
  },

  async 'a four-space-indented heading is a code block and stays inert'() {
    await expectPass('a four-space-indented heading is a code block and stays inert', {
      api: [
        '# CS-API', '', '## Rules', '',
        '### CS-API-001 — Shows a rule heading by example', '',
        '- **Sources:** AB#1636704', '',
        'Like this:', '',
        '    ### CS-API-900 — not a real rule', '',
      ].join('\n'),
    });
  },

  async 'a four-space-indented fence is a code block and cannot swallow a rule'() {
    // The same indent cap, applied to fences. Uncapped, this pair opened and
    // closed a real fence, so CS-API-002 never reached validateRule at all —
    // and the pair being balanced meant the unterminated-fence backstop stayed
    // silent too. The run exited 0 with an unsourced rule served to the model.
    await expectFail('a four-space-indented fence is a code block and cannot swallow a rule', {
      api: [
        '# CS-API', '', '## Rules', '',
        '### CS-API-001 — Shows a fenced example by example', '',
        '- **Sources:** AB#1636704', '',
        '    ```markdown',
        '### CS-API-002 — Active, cites no source', '', 'Body text.', '',
        '    ```', '',
      ].join('\n'),
    }, 'no source');
  },

  async 'a tab-indented fence is a code block and cannot swallow a rule'() {
    // A tab counts as four columns in CommonMark, so this is an indented code
    // block for the same reason four spaces is. Worth pinning separately: the
    // cap is written in spaces, and `\s*` used to match a tab.
    await expectFail('a tab-indented fence is a code block and cannot swallow a rule', {
      api: [
        '# CS-API', '', '## Rules', '',
        '### CS-API-001 — Shows a fenced example by example', '',
        '- **Sources:** AB#1636704', '',
        '\t```markdown',
        '### CS-API-002 — Active, cites no source', '', 'Body text.', '',
        '\t```', '',
      ].join('\n'),
    }, 'no source');
  },

  async 'an indented pseudo-fence does not desync the fence parity'() {
    // The quieter half of the same defect: uncapped, the indented marker opened
    // a fence that the next *real* opener then closed, so the `## Retired`
    // inside the genuine example became live section state and exempted
    // CS-API-002 from the field checks — with no symptom pointing at the cause.
    await expectFail('an indented pseudo-fence does not desync the fence parity', {
      api: [
        '# CS-API', '', '## Rules', '',
        '### CS-API-001 — Mentions a fence marker inside an indented block', '',
        '- **Sources:** AB#1636704', '',
        '    ```', '',
        '```markdown', '## Retired', '```', '',
        '### CS-API-002 — Active, cites no source', '', 'Body text.', '',
      ].join('\n'),
    }, 'no source');
  },

  // --- defect 9: mismatched fence delimiters ----------------------------------
  async 'a ~~~ line inside a ``` fence does not close it'() {
    await expectFail('a ~~~ line inside a ``` fence does not close it', {
      api: [
        '# CS-API', '', '## Rules', '',
        '### CS-API-001 — Nests one fenced example inside another', '',
        '- **Sources:** AB#1636704', '',
        '```markdown', '~~~', '## Retired', '~~~', '```', '',
        '### CS-API-002 — Active, cites no source', '', 'Body text.', '',
      ].join('\n'),
    }, 'no source');
  },

  async 'a ``` line inside a ~~~ fence does not close it'() {
    // The enclosed payload has to be section state, not another `Sources` line.
    // An earlier version wrapped `- **Sources:** AB#1234567`, which made the
    // case vacuous: with the fence-character guard removed the exposed field
    // merely overwrote a `sources` entry that was already valid, so stderr was
    // byte-identical either way.
    await expectFail('a ``` line inside a ~~~ fence does not close it', {
      api: [
        '# CS-API', '', '## Rules', '',
        '### CS-API-001 — Wraps a backtick example in a tilde fence', '',
        '- **Sources:** AB#1636704',
        '',
        '~~~markdown', '```', '## Retired', '```', '~~~', '',
        '### CS-API-002 — Active, cites no source', '', 'Body text.', '',
      ].join('\n'),
    }, 'no source');
  },

  // --- tombstone placement and casing -----------------------------------------
  async 'a merge tombstone under "## Rules" is rejected'() {
    await expectFail('a merge tombstone under "## Rules" is rejected', {
      api: [
        '# CS-API', '', '## Rules', '',
        '### CS-API-001 — merged into CS-API-002', '',
        '### CS-API-002 — A real rule', '', '- **Sources:** AB#1636704', '', 'Body text.', '',
      ].join('\n'),
    }, 'sits under "## Rules"');
  },

  async 'a sentence-cased tombstone is still recognised as one'() {
    await expectFail('a sentence-cased tombstone is still recognised as one', {
      api: ['# CS-API', '', '## Retired', '', '### CS-API-001 — Merged into CS-API-999.', ''].join('\n'),
    }, 'does not exist');
  },

  async 'a merge pointing at a retired rule is reported'() {
    await expectFail('a merge pointing at a retired rule is reported', {
      api: [
        '# CS-API', '', '## Retired', '',
        '### CS-API-001 — merged into CS-API-002', '',
        '### CS-API-002 — Withdrawn, and not a tombstone', '', 'Body text.', '',
      ].join('\n'),
    }, 'itself retired and never loaded');
  },

  async 'a merge chain ending at a live rule passes'() {
    await expectPass('a merge chain ending at a live rule passes', {
      api: [
        '# CS-API', '', '## Rules', '',
        '### CS-API-003 — The live target', '', '- **Sources:** AB#1636704', '', 'Body text.', '',
        '## Retired', '',
        '### CS-API-001 — merged into CS-API-002', '',
        '### CS-API-002 — merged into CS-API-003', '',
      ].join('\n'),
    });
  },

  // --- SKILL.md guards, reachable only via the `skill` override ----------------
  async 'an unterminated fence in SKILL.md is reported, not silently scanned'() {
    await expectFail('an unterminated fence in SKILL.md is reported, not silently scanned', {},
      'unterminated code fence',
      ['---', 'name: coding-standards', 'description: x', '---', '', ...ROUTES, '', '```markdown'].join('\n'));
  },

  async 'SKILL.md setting disable-model-invocation is rejected'() {
    await expectFail('SKILL.md setting disable-model-invocation is rejected', {},
      'disable-model-invocation',
      ['---', 'name: coding-standards', 'description: x', 'disable-model-invocation: true', '---', '', ...ROUTES].join('\n'));
  },

  async 'SKILL.md with no frontmatter is rejected'() {
    await expectFail('SKILL.md with no frontmatter is rejected', {},
      'missing YAML frontmatter',
      ['# coding-standards', '', ...ROUTES].join('\n'));
  },

  async 'a routing table that never reaches a category is reported'() {
    await expectFail('a routing table that never reaches a category is reported', {},
      'never points at references/tool.md',
      ['---', 'name: coding-standards', 'description: x', '---', '', ...ROUTES.filter((r) => !r.includes('tool.md'))].join('\n'));
  },

  async 'a route pointing at an unknown category is reported'() {
    await expectFail('a route pointing at an unknown category is reported', {},
      'which is not a known category',
      ['---', 'name: coding-standards', 'description: x', '---', '', ...ROUTES, '`references/nope.md`'].join('\n'));
  },

  async 'a SKILL.md over the line cap is reported'() {
    await expectFail('a SKILL.md over the line cap is reported', {},
      'max 200',
      ['---', 'name: coding-standards', 'description: x', '---', '', ...ROUTES,
        ...Array.from({ length: 200 }, (_, i) => `filler ${i}`)].join('\n'));
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
