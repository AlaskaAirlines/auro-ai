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
};

console.log('capture-sections.test: running');
for (const test of Object.values(tests)) test();

if (failures.length) {
  console.error(`capture-sections.test: ${failures.length} failure(s)`);
  process.exit(1);
}
console.log(`capture-sections.test: ${Object.keys(tests).length} passed`);
