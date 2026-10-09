#!/usr/bin/env node
// Locate the lessons sections of a post-mortem. Used by `capture.sh sections`
// and pinned by scripts/capture-sections.test.mjs. Invoked as:
//   node locate-sections.mjs [--json] <post-mortem.md>...
//
// LOCATING IS DETERMINISTIC, EXTRACTION IS JUDGEMENT (Phase 2 TRD #57 D4). This
// file only finds where lessons are written and hands back the raw text; the
// model reads that text and decides what the candidates are. The corpus has
// five lesson shapes across four templates (§2.1), with prose interleaved in
// some numbered lists, so a fixed parser per shape would fail silently. A
// missed heading here is the one failure with no signal — a lesson is simply
// never proposed — so the match errs towards over-inclusion: a heading located
// in error is visible in the PR body and costs a reviewer one glance.
//
// Dependency-free and read-only, like validate-standards.mjs.
import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';
import { fileURLToPath } from 'node:url';

// Matched against the heading text after any leading section number and
// emphasis are stripped, case-insensitively, as a PREFIX: `Lessons learned`,
// `Lessons for Future AI-Assisted Development` and `Recommendations for the
// Remaining Sub-PRs` are all lessons sections. Level-agnostic — `### Key
// Lessons` is the only lessons section in seven files. The arrow is U+2192 in
// every file today; `->` is accepted too because an ASCII search for it would
// otherwise be the one that silently misses.
const KINDS = [
  ['symptoms-table', /^symptoms\s*(?:→|->)\s*lessons?\b/i],
  ['key-lessons', /^key\s+lessons?\b/i],
  ['learnings', /^learnings?\b/i],
  ['lessons', /^lessons?\b/i],
  ['takeaway', /^takeaways?\b/i],
  ['recommendations', /^recommendations?\b/i],
  ['prevention', /^prevention\b/i],
];

// CommonMark: up to three spaces of indent, then 1–6 `#`, then a space or the
// end of the line. An optional closing run of `#` is not part of the text.
const HEADING_RE = /^ {0,3}(#{1,6})(?:[ \t]+(.*?))?(?:[ \t]+#+)?[ \t]*$/;
const FENCE_RE = /^ {0,3}(`{3,}|~{3,})/;
// `9. Lessons…`, `2) Takeaway`, `3.1 Prevention`
const NUMBER_PREFIX_RE = /^\d+(?:\.\d+)*[.)]?\s+/;
const ROOT_CAUSE_RE = /^root\s+causes?\b/i;
const TICKET_RE = /\bAB#(\d{7})\b/g;

/** Heading text as a reader sees it: no number, no surrounding emphasis. */
function normalise(text) {
  return text
    .replace(NUMBER_PREFIX_RE, '')
    .replace(/^[*_`]+|[*_`:]+$/g, '')
    .trim();
}

/** The lessons kind a heading names, or null. */
export function classifyHeading(text) {
  const name = normalise(text);
  for (const [kind, pattern] of KINDS) {
    if (pattern.test(name)) return kind;
  }
  return null;
}

/** Split markdown into heading records, ignoring anything inside a fence. */
function headings(lines) {
  const found = [];
  let fence = null;
  lines.forEach((line, index) => {
    const f = line.match(FENCE_RE);
    if (f) {
      const marker = { char: f[1][0], len: f[1].length };
      if (!fence) fence = marker;
      else if (marker.char === fence.char && marker.len >= fence.len && !line.slice(f[0].length).trim()) fence = null;
      return;
    }
    if (fence) return;
    const h = line.match(HEADING_RE);
    if (h) found.push({ level: h[1].length, text: (h[2] || '').trim(), index });
  });
  return found;
}

/**
 * Locate every lessons section in one post-mortem.
 *
 * A section runs from its heading to the next heading at the same or a higher
 * level. A matching heading nested inside a section already located is part of
 * that section's text, not a second section — otherwise `## Lessons` containing
 * `### Key Lessons` would hand the model the same lessons twice.
 */
export function locateSections(source) {
  const lines = source.replace(/\r\n?/g, '\n').split('\n');
  const all = headings(lines);
  const sections = [];

  for (let i = 0; i < all.length; i += 1) {
    const h = all[i];
    const kind = classifyHeading(h.text);
    if (!kind) continue;

    const end = all.slice(i + 1).find((next) => next.level <= h.level);
    const stop = end ? end.index : lines.length;
    sections.push({
      kind,
      heading: `${'#'.repeat(h.level)} ${h.text}`,
      level: h.level,
      line: h.index + 1,
      text: lines.slice(h.index + 1, stop).join('\n').trim(),
    });

    // Skip the headings this section swallowed.
    while (i + 1 < all.length && all[i + 1].index < stop) i += 1;
  }

  const title = all.find((h) => h.level === 1)?.text || null;
  const tickets = [...new Set([...source.matchAll(TICKET_RE)].map((m) => `AB#${m[1]}`))];
  const hasRootCause = all.some((h) => ROOT_CAUSE_RE.test(normalise(h.text)));

  return { title, tickets, hasRootCause, sections };
}

/** The report `capture.sh sections` prints for the model. */
function render(file, result) {
  const out = [`=== ${file}`];
  out.push(`title: ${result.title || '(no H1)'}`);
  out.push(`tickets in body: ${result.tickets.join(', ') || 'none'}   root-cause heading: ${result.hasRootCause ? 'yes' : 'no'}`);
  if (!result.sections.length) {
    out.push('sections: NONE — no lessons heading located');
  } else {
    out.push(`sections: ${result.sections.length}`);
    for (const s of result.sections) {
      out.push('', `--- [${s.kind}] line ${s.line}: ${s.heading}`, s.text || '(empty section)');
    }
  }
  return out.join('\n');
}

async function main(argv) {
  const json = argv.includes('--json');
  const files = argv.filter((a) => a !== '--json');
  if (!files.length) {
    console.error('usage: locate-sections.mjs [--json] <post-mortem.md>...');
    process.exitCode = 2;
    return;
  }

  const results = [];
  for (const file of files) {
    results.push({ file: basename(file), ...locateSections(await readFile(file, 'utf8')) });
  }

  if (json) console.log(JSON.stringify(results, null, 2));
  else console.log(results.map((r) => render(r.file, r)).join('\n\n'));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
}
