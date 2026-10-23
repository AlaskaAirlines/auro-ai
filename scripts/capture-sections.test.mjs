#!/usr/bin/env node
// Regression tests for capture-standard's section locator. Invoked as:
//   node scripts/capture-sections.test.mjs   (npm run test:capture)
//
// Dependency-free by design, like validate-standards.test.mjs: no runner, no
// devDependency, no config. Each case is a small post-mortem fixture passed to
// locateSections(), with an assertion on which sections it found.
//
// WHY THIS EXISTS. Capture extracts lessons only from the sections this
// locator hands it (Phase 2 TRD #57 D4), so a heading it misses is a lesson
// that is never proposed — and nothing says so. That is the failure with no
// signal, and the reason locating is deterministic and tested offline while
// extraction is left to judgement. The corpus census (#57 §2.1) found five
// lesson shapes across four templates; a `## Learnings`-only search missed
// the lessons in over half of them. One case below pins each heading variant
// the census found, and the rest pin the boundaries — where a section ends,
// what is not a section — that a parser change could quietly move.
//
// When adding a case, break the behaviour it is named for and confirm this
// file reports that case failing. A case that cannot fail is cited as
// coverage it does not provide.
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const LOCATOR = join(ROOT, 'plugins/auro/skills/capture-standard/scripts/locate-sections.mjs');
const { locateSections } = await import(pathToFileURL(LOCATOR).href);

const failures = [];
const pass = (name) => console.log(`  ok    ${name}`);
const failCase = (name, detail) => {
  failures.push(`${name}: ${detail}`);
  console.error(`  FAIL  ${name}\n          ${detail}`);
};

/**
 * Assert the sections located in `source`. `expected` lists `[kind, heading]`
 * in document order; `contains` / `excludes` map a section index to text that
 * must or must not appear in its body, which is how a case pins where a
 * section ends.
 */
function expectSections(name, source, expected, { contains = {}, excludes = {} } = {}) {
  const { sections } = locateSections(source);
  const got = sections.map((s) => [s.kind, s.heading]);
  if (JSON.stringify(got) !== JSON.stringify(expected)) {
    return failCase(name, `expected ${JSON.stringify(expected)}, got ${JSON.stringify(got)}`);
  }
  for (const [i, text] of Object.entries(contains)) {
    if (!sections[i].text.includes(text)) return failCase(name, `section ${i} lacks "${text}"`);
  }
  for (const [i, text] of Object.entries(excludes)) {
    if (sections[i].text.includes(text)) return failCase(name, `section ${i} ran on into "${text}"`);
  }
  pass(name);
}

const doc = (...lines) => lines.join('\n');

// --- capture.sh, offline -----------------------------------------------------------
// The script keeps its state in fixed /tmp/capture_* paths. A case runs a copy with
// those paths moved into a scratch directory (so a real run's state is never touched)
// and with stub `gh` and `curl` first on PATH, so nothing reaches GitHub or ADO.
const CAPTURE_SH = join(ROOT, 'plugins/auro/skills/capture-standard/scripts/capture.sh');

const GH_STUB = `#!/usr/bin/env bash
# Answers the two post-mortem calls: the directory listing and a file fetch.
for a; do case "$a" in repos/*) url="$a" ;; esac; done
case "$url" in
  */docs/post-mortem\\?*) mode="$GH_LIST" ;;
  *) mode="$GH_FILE" ;;
esac
case "$mode" in
  ok)   case "$url" in */docs/post-mortem\\?*) echo 1234567.md ;; *) printf '# AB#1234567\\n## Learnings\\n- a lesson\\n' ;; esac ;;
  404)  echo '{"message":"Not Found","status":"404"}'; echo 'gh: Not Found (HTTP 404)' >&2; exit 1 ;;
  *)    echo '{"message":"Server Error"}'; echo "gh: Server Error (HTTP $mode)" >&2; exit 1 ;;
esac
`;

const CURL_STUB = `#!/usr/bin/env bash
# Logs every ADO call as "<METHOD> <url> <body>" and answers from $WIQL_JSON / $ITEM_JSON.
cat >/dev/null # the PAT config line ado_curl pipes in
out=/dev/stdout; method=GET; data=""; url=""
while [ $# -gt 0 ]; do
  case "$1" in
    -o) out="$2"; shift ;; -X) method="$2"; shift ;; --data-binary) data="$2"; shift ;;
    -w|-H|-K) shift ;; -*) ;; *) url="$1" ;;
  esac; shift
done
case "$data" in @*) data=$(tr '\\n' ' ' < "\${data#@}") ;; esac
printf '%s %s %s\\n' "$method" "$url" "$data" >> "$CURL_LOG"
case "$method $url" in
  "POST "*wiql*)           printf '%s' "$WIQL_JSON" > "$out" ;;
  "GET "*expand=relations*) printf '%s' "$ITEM_JSON" > "$out" ;;
esac
printf 200
`;

/** Run `capture.sh <args>` (or, with `fn`, one of its functions) in a scratch dir. */
function runCapture(args, { env = {}, setup = () => {}, fn } = {}) {
  const scratch = mkdtempSync(join(tmpdir(), 'capture-sh-'));
  try {
    const bin = join(scratch, 'bin');
    mkdirSync(bin);
    writeFileSync(join(bin, 'gh'), GH_STUB, { mode: 0o755 });
    writeFileSync(join(bin, 'curl'), CURL_STUB, { mode: 0o755 });
    let script = readFileSync(CAPTURE_SH, 'utf8').replaceAll('/tmp/capture_', `${scratch}/capture_`);
    if (fn) script = `${script.slice(0, script.indexOf('\nCMD="$1"'))}\n${fn} "$@"\n`;
    writeFileSync(join(scratch, 'capture.sh'), script, { mode: 0o755 });
    setup(scratch);
    const curlLog = join(scratch, 'curl.log');
    writeFileSync(curlLog, '');
    const r = spawnSync('bash', [join(scratch, 'capture.sh'), ...args], {
      encoding: 'utf8',
      env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, CURL_LOG: curlLog, ...env },
    });
    const read = (f) => (existsSync(join(scratch, f)) ? readFileSync(join(scratch, f), 'utf8') : '');
    return { status: r.status, out: r.stdout + r.stderr, curl: read('curl.log'), ticketLog: read('capture_ticket.log') };
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

/** `capture.sh postmortems` for one ticket, AB#1234567, with the given stub answers. */
function runPostmortems(env) {
  return runCapture(['postmortems'], {
    env,
    setup: (s) => {
      writeFileSync(join(s, 'capture_run.tsv'), 'AlaskaAirlines/auro-x\tlbl\tmain\trc\tcapture/auro-x-lbl\taaa\tbbb\n');
      writeFileSync(join(s, 'capture_ado_ids.txt'), '1234567\n');
      writeFileSync(join(s, 'capture_pr_ids.txt'), '');
    },
  });
}

const NEW_PR = 'https://github.com/AlaskaAirlines/auro-ai/pull/99';
/** create_ticket's reuse path: WIQL finds AB#7654321, whose state and links are `item`. */
function runReuse(item) {
  return runCapture([NEW_PR], {
    fn: 'create_ticket',
    env: {
      ADO_PAT: 'stub', REPO: 'AlaskaAirlines/auro-x', LABEL: 'lbl',
      WIQL_JSON: JSON.stringify({ workItems: [{ id: 7654321 }] }),
      ITEM_JSON: JSON.stringify(item),
    },
  });
}

const tests = {
  // --- one case per heading variant in the #57 §2.1 census ----------------------
  '## Learnings, the current template'() {
    expectSections('## Learnings, the current template',
      doc('# AB#1636704', '', '## Root Cause', 'x', '', '## Learnings', '- **Bind to validity.** y', '', '## Files', 'z'),
      [['learnings', '## Learnings']],
      { contains: { 0: 'Bind to validity' }, excludes: { 0: 'Files' } });
  },

  '## Lessons, numbered'() {
    expectSections('## Lessons, numbered',
      doc('# AB#1575423', '## Lessons', '1. One.', '2. Two.'),
      [['lessons', '## Lessons']], { contains: { 0: '2. Two.' } });
  },

  '### Key Lessons at level 3 is found'() {
    // The "AB#id — Title" template has almost no `##` headings. A `##`-only
    // match misses all seven of these files outright.
    expectSections('### Key Lessons at level 3 is found',
      doc('# AB#1599649 — Code review', '', '### What happened', 'x', '', '### Key Lessons', '1. Pin nothing mutable.', '', '### Timeline', 'y'),
      [['key-lessons', '### Key Lessons']],
      { contains: { 0: 'Pin nothing mutable' }, excludes: { 0: 'Timeline' } });
  },

  '## Recommendations with a suffix, prose between items kept'() {
    expectSections('## Recommendations with a suffix, prose between items kept',
      doc('# Post-Mortem: Datepicker (AB#1494482)', '## Recommendations for Future Datepicker/Layout Bugs',
        '1. Test at the smallest width.', '', 'This matters because the range end is the one that clips.', '', '2. Check both inputs.'),
      [['recommendations', '## Recommendations for Future Datepicker/Layout Bugs']],
      { contains: { 0: 'range end is the one that clips' } });
  },

  '## Lessons learned'() {
    expectSections('## Lessons learned',
      doc('# AB#1611713', '## Lessons learned', '- a'),
      [['lessons', '## Lessons learned']]);
  },

  '## Symptoms → Lesson with U+2192, as the only section'() {
    expectSections('## Symptoms → Lesson with U+2192, as the only section',
      doc('# Post-Mortem: X (AB#1550294)', '## Symptoms → Lesson', '| If you see... | This doc says... |', '|---|---|', '| a | b |'),
      [['symptoms-table', '## Symptoms → Lesson']], { contains: { 0: '| a | b |' } });
  },

  '## Symptoms -> Lesson with an ASCII arrow'() {
    expectSections('## Symptoms -> Lesson with an ASCII arrow',
      doc('# X', '## Symptoms -> Lessons', '| a | b |'),
      [['symptoms-table', '## Symptoms -> Lessons']]);
  },

  'a numbered heading — ## 9. Lessons for Future…'() {
    // An anchored `^## Lessons` misses this, and so does an anchored
    // `lessons?( learned)?` — the heading continues past the keyword.
    expectSections('a numbered heading — ## 9. Lessons for Future…',
      doc('# X', '## 8. Timeline', 'x', '## 9. Lessons for Future AI-Assisted Development', '1. a'),
      [['lessons', '## 9. Lessons for Future AI-Assisted Development']], { excludes: { 0: 'Timeline' } });
  },

  '## Takeaway, prose'() {
    expectSections('## Takeaway, prose',
      doc('# X', '## Takeaway', 'One paragraph of prose.'),
      [['takeaway', '## Takeaway']]);
  },

  '## Prevention'() {
    expectSections('## Prevention',
      doc('# X', '## Prevention', '- a'),
      [['prevention', '## Prevention']]);
  },

  // --- variants in no post-mortem yet, named by the parent TRD or the review ---------
  '## Key Takeaways'() {
    // Parent #46 §4.1 names it. The prefix match on `takeaway` alone misses it.
    expectSections('## Key Takeaways',
      doc('# X', '## Key Takeaways', '- a'),
      [['takeaway', '## Key Takeaways']]);
  },

  '## Key Learnings'() {
    expectSections('## Key Learnings',
      doc('# X', '## Key Learnings', '- a'),
      [['learnings', '## Key Learnings']]);
  },

  '## What we learned'() {
    expectSections('## What we learned',
      doc('# X', '## What We Learned', '- a'),
      [['learnings', '## What We Learned']]);
  },

  // --- the absence cases ---------------------------------------------------------
  'a post-mortem with no lessons section locates nothing'() {
    const name = 'a post-mortem with no lessons section locates nothing';
    const result = locateSections(doc('# AB#1364921 — padding', '## Summary', 'x', '## Root Cause', 'y', '## Fix', 'z'));
    if (result.sections.length) return failCase(name, `located ${result.sections.length} section(s)`);
    if (!result.hasRootCause || result.tickets[0] !== 'AB#1364921') return failCase(name, 'lost the post-mortem signals');
    pass(name);
  },

  'a file that is not a post-mortem carries no signals'() {
    // AuroDesignTokens 1491472 / 1601893 are consumer release notes in the
    // post-mortem directory: no H1, no ticket ID, no root cause. The skill
    // relies on these three signals to recognise them rather than inventing
    // derived lessons from release notes.
    const name = 'a file that is not a post-mortem carries no signals';
    const result = locateSections(doc('**Release 6.2.0**', '', '### Breaking', '- tokens renamed'));
    if (result.title !== null || result.tickets.length || result.hasRootCause || result.sections.length) {
      return failCase(name, JSON.stringify(result));
    }
    pass(name);
  },

  // --- boundaries -------------------------------------------------------------------
  'a section runs to the next heading at its level, deeper ones included'() {
    expectSections('a section runs to the next heading at its level, deeper ones included',
      doc('# X', '## Learnings', 'a', '### On timers', 'b', '#### Detail', 'c', '## Appendix', 'd'),
      [['learnings', '## Learnings']], { contains: { 0: 'c' }, excludes: { 0: 'Appendix' } });
  },

  'a level-3 section stops at a level-2 heading'() {
    expectSections('a level-3 section stops at a level-2 heading',
      doc('# X', '### Key Lessons', 'a', '## Files', 'b'),
      [['key-lessons', '### Key Lessons']], { excludes: { 0: 'Files' } });
  },

  'a lessons heading nested in a located section is not a second section'() {
    // Otherwise the model is handed the same lessons twice.
    expectSections('a lessons heading nested in a located section is not a second section',
      doc('# X', '## Lessons', 'intro', '### Key Lessons', '1. a', '## Files', 'z'),
      [['lessons', '## Lessons']], { contains: { 0: 'Key Lessons' } });
  },

  'a Symptoms table and a separate Learnings section are both located'() {
    // 7 files restate the table in a lessons section. Both must reach the
    // model, which dedupes within the post-mortem (#57 §6).
    expectSections('a Symptoms table and a separate Learnings section are both located',
      doc('# X', '## Symptoms → Lesson', '| a | b |', '## Root Cause', 'y', '## Learnings', '- a'),
      [['symptoms-table', '## Symptoms → Lesson'], ['learnings', '## Learnings']],
      { excludes: { 0: 'Root Cause' } });
  },

  'a heading inside a code fence is not structure'() {
    expectSections('a heading inside a code fence is not structure',
      doc('# X', '## Fix', '```markdown', '## Learnings', '- fake', '```', '## Lessons', '- real'),
      [['lessons', '## Lessons']], { excludes: { 0: 'fake' } });
  },

  'a fence inside a section does not end it'() {
    expectSections('a fence inside a section does not end it',
      doc('# X', '## Learnings', '```js', '## not a heading', '```', 'after the fence', '## Files'),
      [['learnings', '## Learnings']], { contains: { 0: 'after the fence' }, excludes: { 0: 'Files' } });
  },

  'a fence line with an info string does not close an open fence'() {
    // Only an opener takes an info string. Reading ```js as a closer flips
    // parity: the fenced example heading goes live and the real section
    // after it is swallowed — validate-standards.test.mjs case 14, here.
    expectSections('a fence line with an info string does not close an open fence',
      doc('# X', '## Fix', '```', '```js', '## Learnings', '- fake', '```', '## Lessons', '- real'),
      [['lessons', '## Lessons']], { contains: { 0: 'real' } });
  },

  'a commented-out lessons heading is not located'() {
    // A hidden draft, not a section. Multi-line, so the comment state has to
    // carry across lines; the trailing real section proves it closes again.
    expectSections('a commented-out lessons heading is not located',
      doc('# X', '<!--', '## Learnings', '- draft', '-->', '## Lessons', '- real'),
      [['lessons', '## Lessons']], { contains: { 0: 'real' } });
  },

  'a comment opener inside a fence is example text'() {
    // Fences are evaluated first. Read as a real opener, the `<!--` would never
    // close and hide the section after the fence.
    expectSections('a comment opener inside a fence is example text',
      doc('# X', '## Fix', '```html', '<!-- an example', '```', '## Learnings', '- a'),
      [['learnings', '## Learnings']]);
  },

  'a <!-- mid-line is text, not a comment that hides what follows'() {
    // auro-ai 1643439 mentions `<!--` in inline code in a bullet. Read as an
    // opener with no closer, it hid that file's `## Learnings` 170 lines on.
    expectSections('a <!-- mid-line is text, not a comment that hides what follows',
      doc('# X', '## Fix', '- **HTML comments.** `<!--` was honoured only as body.', 'more', '## Learnings', '- a'),
      [['learnings', '## Learnings']]);
  },

  'a one-line comment hides only its own line'() {
    expectSections('a one-line comment hides only its own line',
      doc('# X', '<!-- ## Learnings -->', '## Lessons', '- a'),
      [['lessons', '## Lessons']]);
  },

  'a heading with a trailing inline comment is still located'() {
    expectSections('a heading with a trailing inline comment is still located',
      doc('# X', '## Learnings <!-- reworded 2026-10-01 -->', '- a'),
      [['learnings', '## Learnings']]);
  },

  'a fence marker inside a comment does not open a fence'() {
    // Commented-out text is inert, fence markers included. Read as a real
    // opener, the ``` would swallow the comment's closer and the section after.
    expectSections('a fence marker inside a comment does not open a fence',
      doc('# X', '<!--', '```', '-->', '## Learnings', '- a'),
      [['learnings', '## Learnings']]);
  },

  'non-lessons headings are not located'() {
    expectSections('non-lessons headings are not located',
      doc('# X', '## Root Cause', '## What the Plan Missed', '## Summary', '## Fix', '## Check'),
      []);
  },

  // --- formatting a hand-written file can carry -------------------------------------
  'case, emphasis, a trailing colon and closing hashes are tolerated'() {
    expectSections('case, emphasis, a trailing colon and closing hashes are tolerated',
      doc('# X', '## **LEARNINGS:**', 'a', '## Lessons ##', 'b'),
      [['learnings', '## **LEARNINGS:**'], ['lessons', '## Lessons']]);
  },

  'CRLF line endings'() {
    expectSections('CRLF line endings',
      '# X\r\n## Learnings\r\n- a\r\n## Files\r\n',
      [['learnings', '## Learnings']], { excludes: { 0: 'Files' } });
  },

  // --- running the script, as capture.sh does ---------------------------------------
  'the CLI prints its report when reached through a symlinked directory'() {
    // Phase 2b found the locator printing nothing — exit 0 — when its path ran through a
    // symlink (macOS /tmp is one), because the run-as-script guard compared argv[1] with a
    // symlink-resolved import.meta.url. capture.sh then saw no lessons in any post-mortem.
    const name = 'the CLI prints its report when reached through a symlinked directory';
    const scratch = mkdtempSync(join(tmpdir(), 'capture-sections-'));
    try {
      const link = join(scratch, 'scripts-link');
      symlinkSync(dirname(LOCATOR), link, 'dir');
      const fixture = join(scratch, '1234567.md');
      writeFileSync(fixture, doc('# AB#1234567', '## Root Cause', 'x', '## Learnings', '- a lesson'));
      const out = execFileSync(process.execPath, [join(link, 'locate-sections.mjs'), fixture], { encoding: 'utf8' });
      if (!out.includes('=== 1234567.md') || !out.includes('## Learnings')) {
        return failCase(name, `expected a report for 1234567.md, got ${JSON.stringify(out.slice(0, 120))}`);
      }
      pass(name);
    } finally {
      rmSync(scratch, { recursive: true, force: true });
    }
  },

  // --- capture.sh postmortems: a GitHub error is a failure, not "no post-mortems" -----
  'postmortems: a 404 on docs/post-mortem/ means the repo has none'() {
    const name = 'postmortems: a 404 on docs/post-mortem/ means the repo has none';
    const r = runPostmortems({ GH_LIST: '404' });
    if (r.status !== 0 || !r.out.includes('NO_POSTMORTEMS') || r.out.includes('GITHUB_FAILED')) {
      return failCase(name, `expected exit 0 and NO_POSTMORTEMS, got ${r.status}: ${r.out.trim()}`);
    }
    pass(name);
  },

  'postmortems: any other listing error fails with GITHUB_FAILED'() {
    // Review of #60 (finding 5): a 5xx, timeout or rate limit was read as "no directory", so
    // the release's lessons were skipped behind a clean "nothing extractable" result.
    const name = 'postmortems: any other listing error fails with GITHUB_FAILED';
    for (const code of ['502', '403']) {
      const r = runPostmortems({ GH_LIST: code });
      if (r.status === 0 || !r.out.includes('GITHUB_FAILED') || r.out.includes('NO_POSTMORTEMS')) {
        return failCase(name, `HTTP ${code}: expected a GITHUB_FAILED exit, got ${r.status}: ${r.out.trim()}`);
      }
    }
    pass(name);
  },

  'postmortems: a failed post-mortem fetch fails with GITHUB_FAILED'() {
    const name = 'postmortems: a failed post-mortem fetch fails with GITHUB_FAILED';
    const r = runPostmortems({ GH_LIST: 'ok', GH_FILE: '502' });
    if (r.status === 0 || !r.out.includes('GITHUB_FAILED') || r.out.includes('NO_POSTMORTEMS')) {
      return failCase(name, `expected a GITHUB_FAILED exit, got ${r.status}: ${r.out.trim()}`);
    }
    pass(name);
  },

  'postmortems: a fetched post-mortem is counted'() {
    const name = 'postmortems: a fetched post-mortem is counted';
    const r = runPostmortems({ GH_LIST: 'ok', GH_FILE: 'ok' });
    if (r.status !== 0 || !r.out.includes('post-mortems carried by the range: 1') || r.out.includes('NO_POSTMORTEMS')) {
      return failCase(name, `expected one post-mortem, got ${r.status}: ${r.out.trim()}`);
    }
    pass(name);
  },

  // --- capture.sh publish: a reused review ticket follows the new PR -----------------
  'reused ticket: linked to the new PR and moved from New to Committed'() {
    // Review of #63 (finding 3): a reused story kept linking only to the earlier, closed PR,
    // and one left New by a refused Committed move stayed New.
    const name = 'reused ticket: linked to the new PR and moved from New to Committed';
    const r = runReuse({
      fields: { 'System.State': 'New' },
      relations: [{ rel: 'Hyperlink', url: 'https://github.com/AlaskaAirlines/auro-ai/pull/42' }],
    });
    const patches = r.curl.split('\n').filter((l) => l.startsWith('PATCH '));
    const linked = patches.some((l) => l.includes('"Hyperlink"') && l.includes(NEW_PR));
    const committed = patches.some((l) => l.includes('"Committed"'));
    if (r.out.trim() !== '7654321' || !linked || !committed || !r.ticketLog.startsWith('reused AB#7654321')) {
      return failCase(name, `expected AB#7654321 linked and Committed, got out=${r.out.trim()} log=${r.ticketLog.trim()} calls=${JSON.stringify(patches)}`);
    }
    pass(name);
  },

  'reused ticket: already linked and Committed, nothing is patched'() {
    const name = 'reused ticket: already linked and Committed, nothing is patched';
    const r = runReuse({ fields: { 'System.State': 'Committed' }, relations: [{ rel: 'Hyperlink', url: NEW_PR }] });
    if (r.out.trim() !== '7654321' || r.curl.includes('PATCH ')) {
      return failCase(name, `expected AB#7654321 with no PATCH, got out=${r.out.trim()} calls=${JSON.stringify(r.curl)}`);
    }
    pass(name);
  },
};

console.log('capture-sections.test: running');
for (const test of Object.values(tests)) test();

if (failures.length) {
  console.error(`capture-sections.test: ${failures.length} failure(s)`);
  process.exit(1);
}
console.log(`capture-sections.test: ${Object.keys(tests).length} passed`);
