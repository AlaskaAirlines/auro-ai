#!/usr/bin/env node
// Schema linter for the coding-standards skill. Validates
// plugins/auro/skills/coding-standards/SKILL.md and its references/*.md
// against the rule schema in the parent TRD (AB#1642023 §3.2–§3.5), and
// prints a non-failing staleness report (§7). Invoked as:
//   node scripts/validate-standards.mjs        (npm run validate:standards)
//
// Dependency-free and read-only. It runs ahead of the copilot drift gates in
// check-copilot-prompts.yml — it must never write to the working tree, or
// those gates would see its output as drift.
//
// ZERO RULES IS A VALID, PASSING STATE. Phase 1 PR-1 ships ten empty
// reference files, so there is deliberately no minimum-count check here and
// adding one would break that phase (Phase 1 TRD §4.2).
//
// There is no per-repo scoping to validate. Auro standards apply to all Auro
// code in every Auro repository (parent TRD §3.4), so reference files carry no
// scope header and no rule is limited to the project it was learned in. Phase 4
// introduces an optional `<!-- scope: paths=... -->` header for Copilot
// applyTo globs, which narrow by file path only.
import { readdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SKILL_DIR = join(ROOT, 'plugins/auro/skills/coding-standards');
const SKILL_FILE = join(SKILL_DIR, 'SKILL.md');
const REFS_DIR = join(SKILL_DIR, 'references');

// Filenames are the lowercased ID segment (Phase 1 TRD D1), so the expected
// file for any rule ID is derivable with no lookup table. Taxonomy per parent
// TRD §3.3. A category split (the §3.3 overflow rule) adds an entry here.
const CATEGORIES = [
  'a11y', 'form', 'intx', 'life', 'style',
  'api', 'build', 'test', 'xbrw', 'tool',
];

const MAX_RULES_PER_FILE = 25; // parent §3.3 overflow rule
const MAX_SKILL_LINES = 200;   // parent §3.1, D3
const MAX_TITLE_CHARS = 80;    // parent §3.2

const ID_RE = /^CS-([A-Z0-9]+)-(\d{3})$/;
const HEADING_RE = /^###\s+(\S+)\s+—\s+(.+?)\s*$/;
// Case-insensitive, and tolerant of a trailing period: `Merged into CS-X-001.`
// is what an author actually types. Matching only the lowercase form meant a
// sentence-cased tombstone was never recognised as one, so its target was never
// resolved and a dangling merge pointer shipped at exit 0 — with no secondary
// signal, because an unrecognised retired title is exempt from every field
// check anyway.
const TOMBSTONE_RE = /^merged into (CS-[A-Z0-9]+-\d{3})\.?$/i;
const FRONTMATTER_RE = /^---\n([\s\S]*?)\n---/;
const FIELD_RE = /^-\s+\*\*([^:*]+):\*\*\s*(.*)$/;
// A rule's provenance is either an Azure DevOps work item or a repository
// reference. Not every lesson comes from a ticket: several pilot rules were
// learned from AI code review on an auro-formkit pull request, where the
// durable handle is the PR number and no work item exists. Forcing those into
// `AB#` produced citations that look valid and resolve to nothing, so the
// second form is first-class rather than a workaround.
// Matched case-insensitively: `ab#1511` is a shift-key slip, not a different
// kind of citation. Matching only `AB#` let the lowercase form fall through to
// REPO_SOURCE_RE, where it was captured as a repository named `ab` and skipped
// the 7-digit check entirely — the very fail-open ADO_ID_DIGITS exists to close.
const ADO_SOURCE_RE = /\bAB#(\d+)/gi;
const REPO_SOURCE_RE = /\b([A-Za-z][A-Za-z0-9._-]*)#(\d+)/g;
const ADO_ID_DIGITS = 7; // every real work item in this org is 7 digits
const LEARNED_RE = /^×(\d+)$/;
const SINCE_RE = /^\d{4}-\d{2}-\d{2}$/;

const errors = [];
const fail = (where, message) => errors.push(`${where}: ${message}`);

// Merge tombstones (§3.5) name a target ID that may live in any category file,
// so they can only be resolved once every file has been parsed.
const tombstones = [];

// Rules sitting under `## Retired` that are not themselves tombstones. A merge
// must land on a rule that is actually loaded, so resolving a chain needs to
// know whether the ID it terminates at is retired — `seenIds` alone cannot say,
// because it holds every ID regardless of section.
const retiredIds = new Set();

/** Read a file, returning null when it does not exist. */
async function readIfPresent(path) {
  try {
    return await readFile(path, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    throw err;
  }
}

const FENCE_RE = /^\s*(`{3,}|~{3,})/;

// CommonMark allows up to three spaces of indentation before a heading or a
// list marker; at four or more the line is an indented code block and is inert
// by the same reasoning as a fence.
const MAX_STRUCTURE_INDENT = 3;

/**
 * Advance fence state by one line. `open` is the currently open fence
 * descriptor (`{ char, len }`) or null. Returns the new state plus whether this
 * line is itself a delimiter rather than fence content.
 *
 * CommonMark closes a fence only with the *same* character and a run at least
 * as long as the opener. Tracking a single boolean instead let a `~~~` line
 * inside a ``` block toggle the fence off mid-block, re-exposing example text
 * as live structure — and because the toggle count stayed even, the
 * unterminated-fence backstop never fired either. Nesting by alternating
 * markers is the ordinary way to show a fenced example inside a fenced example,
 * which is exactly the pattern this handling exists for.
 */
function fenceTransition(line, open) {
  const match = line.match(FENCE_RE);
  if (!match) return { open, delimiter: false };

  const [char, len] = [match[1][0], match[1].length];
  if (!open) return { open: { char, len }, delimiter: true };
  if (char === open.char && len >= open.len) return { open: null, delimiter: true };

  // A different marker inside an open fence is content, not a delimiter.
  return { open, delimiter: false };
}

/**
 * Remove every complete `<!-- ... -->` span from one line, given whether a
 * comment was already open when the line started. Returns the visible remainder
 * and whether a comment is still open after it, so a caller can carry the state
 * to the next line. Text after a `-->` is visible again on the same line.
 */
function stripComments(line, open) {
  let visible = '';
  let rest = line;

  while (rest) {
    if (open) {
      const end = rest.indexOf('-->');
      if (end === -1) return { visible, open: true };
      rest = rest.slice(end + 3);
      open = false;
    } else {
      const start = rest.indexOf('<!--');
      if (start === -1) return { visible: visible + rest, open: false };
      visible += rest.slice(0, start);
      rest = rest.slice(start + 4);
      open = true;
    }
  }

  return { visible, open };
}

/**
 * Drop fenced code blocks and HTML comments, so neither an example nor a
 * commented-out line is ever read as structure. Fences are evaluated first: a
 * `<!--` inside a fence is example text, not a comment.
 */
function stripFencesAndComments(source, file) {
  let fence = null;
  let inComment = false;

  const text = source
    .split('\n')
    .map((line) => {
      if (!inComment) {
        const next = fenceTransition(line, fence);
        const wasDelimiter = next.delimiter;
        fence = next.open;
        if (wasDelimiter || fence) return null;
      }
      const stripped = stripComments(line, inComment);
      inComment = stripped.open;
      return stripped.visible;
    })
    .filter((line) => line !== null)
    .join('\n');

  // `parseRules` reports these for a reference file; do the same here rather
  // than letting the reachability scan quietly lose routing rows. The failure
  // is already fail-closed — dropped rows surface as "category unreachable" —
  // but that message sends the reader to the routing table instead of to the
  // dropped backtick that actually caused it.
  if (fence) fail(file, 'unterminated code fence — the routing table after it was not scanned');
  if (inComment) fail(file, 'unterminated HTML comment — the routing table after it was not scanned');

  return text;
}

// --- reference-file parsing --------------------------------------------------

/**
 * Split a reference file into rule blocks, tracking which `##` section each
 * block sits under so `## Retired` entries (§3.5) can be exempted from the
 * field requirements while still holding their ID reserved.
 *
 * Fenced blocks and HTML comments are treated as body content, never as
 * structure — a rule that documents the schema by example, or one that leaves a
 * template commented out, must not be able to reconfigure the parser.
 */
function parseRules(source, file) {
  const rules = [];
  let section = null;
  let current = null;
  let fence = null;
  let inComment = false;
  const flush = () => {
    if (current) rules.push(current);
    current = null;
  };

  source.split('\n').forEach((raw, index) => {
    const rawLine = raw.trimEnd();

    // Headings and fields inside a fence are content, not structure. Without
    // this the failure is fail-open, and silently so: a rule body containing a
    // fenced `## Retired` flips `section` mid-file, every rule after it is
    // treated as retired, and validateRule then exempts each one from the
    // field checks — so the linter accepts a rule citing no `AB#` source and
    // still exits 0. The fence is matched loosely because one indented under a
    // list item is exactly as likely to appear in a rule body.
    //
    // Fences are evaluated before comments so a `<!--` inside a fenced markdown
    // example is example text rather than a real comment opener.
    if (!inComment) {
      const next = fenceTransition(rawLine, fence);
      const wasDelimiter = next.delimiter;
      fence = next.open;
      if (wasDelimiter || fence) {
        if (current && rawLine.trim()) current.body.push(rawLine.trim());
        return;
      }
    }

    // A commented-out line is not structure either, and for the same reason: a
    // schema template left inside `<!-- ... -->` used to satisfy the field
    // checks it was only illustrating (a commented `Sources` line registered as
    // a real source), and a commented `## Retired` flipped section state for
    // the rest of the file. Both exited 0 — the same fail-open shape as the
    // fenced cases above, reached through the other markdown comment mechanism.
    const stripped = stripComments(rawLine, inComment);
    inComment = stripped.open;
    const visible = stripped.visible.trimEnd();
    if (!visible.trim()) return;

    // Structure was matched against the raw line while the fence regex had been
    // loosened to `^\s*`, so any indented heading was not merely exempted from
    // the checks — it was absent from them. One stray leading space and a rule
    // escaped the source, ID, duplicate, title-length and category checks at
    // once, while still rendering as a rule and being served to the model.
    //
    // CommonMark decides this by indent width: up to three spaces is still a
    // heading, four or more is an indented code block and inert, which is the
    // same reasoning fences already follow. Matching that keeps an indented
    // example inert without letting an indented *rule* disappear.
    const indent = visible.length - visible.trimStart().length;
    if (indent > MAX_STRUCTURE_INDENT) {
      if (current) current.body.push(visible.trim());
      return;
    }
    const line = visible.trimStart();

    const h3 = line.match(/^###\s+(.*)$/);
    if (h3) {
      flush();
      current = { heading: line, text: h3[1].trim(), line: index + 1, section, body: [], fields: {} };
      return;
    }

    const h2 = line.match(/^##\s+(.*)$/);
    if (h2) {
      flush();
      const name = h2[1].trim().toLowerCase();
      if (name === 'rules') section = 'rules';
      else if (name === 'retired') section = 'retired';
      // Any other `##` heading ends the rule section. Without this, a `###`
      // under a later prose heading would still be validated as a rule and
      // fail with a misleading "malformed rule heading".
      else section = null;
      return;
    }

    if (!current) return;

    const field = line.match(FIELD_RE);
    if (field) {
      current.fields[field[1].trim().toLowerCase()] = field[2].trim();
      return;
    }
    current.body.push(line.trim());
  });

  flush();

  // A fence that is never closed swallows the remainder of the file: every
  // later `###`, `##` and field line is absorbed as body text, so those rules
  // are not merely exempted from the field checks — they are never parsed at
  // all, and the run still exits 0. That is the same fail-open the fence
  // handling above exists to prevent, reached by a single dropped closing
  // fence in exactly the document-by-example pattern fences were added for,
  // so it has to be an error rather than a tolerated formatting slip.
  if (fence) {
    fail(file, 'unterminated code fence — every rule after it was swallowed as body text and never validated');
  }

  // Same failure, same reasoning, one character different: a `<!--` that is
  // never closed hides every rule after it from the parser and still exits 0.
  if (inComment) {
    fail(file, 'unterminated HTML comment — every rule after it was swallowed and never validated');
  }

  return rules;
}

/** Distinct sources cited in a Sources value. */
function uniqueSources(value) {
  const text = value || '';
  const found = new Map();
  for (const m of text.matchAll(ADO_SOURCE_RE)) {
    found.set(`AB#${m[1]}`, { kind: 'ado', id: m[1], cite: `AB#${m[1]}` });
  }
  for (const m of text.matchAll(REPO_SOURCE_RE)) {
    if (m[1].toUpperCase() === 'AB') continue; // already captured as an ADO work item
    found.set(`${m[1]}#${m[2]}`, { kind: 'repo', repo: m[1], id: m[2], cite: `${m[1]}#${m[2]}` });
  }
  return [...found.values()];
}

/** Validate one rule block. Returns the parsed rule, or null if unusable. */
function validateRule(file, segment, rule, seenIds) {
  const where = `${file}:${rule.line}`;

  if (rule.section !== 'rules' && rule.section !== 'retired') {
    fail(where, `rule block "${rule.text}" is not under a "## Rules" or "## Retired" heading`);
    return null;
  }

  const heading = rule.heading.match(HEADING_RE);
  if (!heading) {
    fail(where, `malformed rule heading — expected "### CS-<CAT>-<NNN> — <title>", got "${rule.heading}"`);
    return null;
  }

  const [, id, title] = heading;
  const parsed = id.match(ID_RE);
  if (!parsed) {
    fail(where, `malformed rule ID "${id}" — expected CS-<CATEGORY>-<NNN> with a three-digit number`);
    return null;
  }

  if (seenIds.has(id)) {
    fail(where, `duplicate rule ID ${id} — first seen at ${seenIds.get(id)}`);
  } else {
    seenIds.set(id, where);
  }

  // D1: the category segment must match the file the rule lives in.
  if (parsed[1] !== segment) {
    fail(where, `${id} has category segment ${parsed[1]} but lives in ${file} (expected CS-${segment}-<NNN>)`);
  }

  // Tombstones (§3.5 merge) hold an ID reserved and carry no other fields.
  // The target is resolved after every file is parsed — see resolveTombstones.
  const tombstone = title.match(TOMBSTONE_RE);
  if (tombstone) {
    // The tombstone branch skips the body, Sources and title-length checks, so
    // it must not be reachable from the section that is still loaded and
    // served. Matching the title before reading the section let a bodyless,
    // sourceless rule under `## Rules` short-circuit every field check while
    // remaining live (SKILL.md: withdrawing a rule means moving it to
    // `## Retired`).
    if (rule.section !== 'retired') {
      fail(where, `${id} is a merge tombstone but sits under "## Rules" — move it under "## Retired", or it stays loaded while skipping every field check`);
      return null;
    }
    tombstones.push({ id, target: tombstone[1].toUpperCase(), where });
    return { id, retired: true, sources: [] };
  }

  const retired = rule.section === 'retired';

  if (title.length > MAX_TITLE_CHARS) {
    fail(where, `${id} title is ${title.length} chars (max ${MAX_TITLE_CHARS})`);
  }

  const sources = uniqueSources(rule.fields.sources);

  // Retired rules stay traceable but are not loaded, so they are exempt from
  // the field requirements that exist to make a rule actionable.
  if (retired) {
    retiredIds.add(id);
    return { id, retired: true, sources };
  }

  if (!rule.body.length) fail(where, `${id} has no body — state the rule and the failure it prevents`);
  // `Applies to` is deliberately OPTIONAL. Auro standards apply to all Auro code by
  // default; the field is present only when a rule has a genuine technical
  // precondition that narrows when it bites. Requiring it produced boilerplate
  // ("any component", "all code"), which is the anti-platitude problem relocated
  // into a different field. Its presence is the signal.
  if (!rule.fields.sources) fail(where, `${id} is missing "Sources"`);
  if (!sources.length) {
    fail(where, `${id} has no source — cite a work item (AB#1234567) or a repo reference (auro-formkit#1511); no traceability, no rule`);
  }

  // A short `AB#` is almost always a pull-request number that has been given
  // an ADO prefix by mistake. It satisfies every syntactic check and resolves
  // to nothing in Azure DevOps, so the rule reads as traceable while pointing
  // at no record at all — the exact failure this field exists to prevent.
  for (const source of sources) {
    if (source.kind === 'ado' && source.id.length !== ADO_ID_DIGITS) {
      fail(where, `${id} cites ${source.cite}, which is not a ${ADO_ID_DIGITS}-digit work item — if this is a pull request, cite it as <repo>#${source.id}`);
    }
  }

  const learned = rule.fields.learned;
  if (sources.length > 1) {
    if (!learned) {
      fail(where, `${id} cites ${sources.length} sources but has no "Learned" field (expected ×${sources.length})`);
    } else {
      const match = learned.match(LEARNED_RE);
      if (!match) fail(where, `${id} has malformed "Learned: ${learned}" — expected ×N`);
      else if (Number(match[1]) !== sources.length) {
        fail(where, `${id} says Learned ×${match[1]} but cites ${sources.length} distinct sources`);
      }
    }
  } else if (learned) {
    const match = learned.match(LEARNED_RE);
    if (!match || Number(match[1]) !== 1) {
      fail(where, `${id} says "Learned: ${learned}" but cites ${sources.length} distinct source`);
    }
  }

  const since = rule.fields.since;
  if (since && !SINCE_RE.test(since)) {
    fail(where, `${id} has malformed "Since: ${since}" — expected YYYY-MM-DD`);
  }

  return { id, retired: false, sources, since, appliesTo: rule.fields['applies to'] };
}

/**
 * Check that every merge tombstone points at a rule that exists and that the
 * chain of merges terminates. Runs after all files are parsed, because a
 * tombstone may name a target in any category file.
 */
function resolveTombstones(seenIds) {
  const targets = new Map(tombstones.map((t) => [t.id, t.target]));

  for (const { id, target, where } of tombstones) {
    if (!seenIds.has(target)) {
      fail(where, `${id} is merged into ${target}, which does not exist`);
      continue;
    }

    // Follow A → B → C so a merge chain still lands on a real rule.
    const chain = new Set([id]);
    let next = target;
    while (targets.has(next)) {
      if (chain.has(next)) break;
      chain.add(next);
      next = targets.get(next);
    }
    if (chain.has(next)) {
      fail(where, `${id} is merged into ${target}, which loops back to a tombstone`);
      continue;
    }

    // The chain terminated on a real ID — but a merge exists so readers are
    // sent somewhere useful, and a retired rule is never loaded. Landing on
    // one satisfies the existence check while pointing at nothing the model
    // will ever serve, which is the same shape as citing a work item that
    // does not resolve.
    if (retiredIds.has(next)) {
      const via = next === target ? '' : ` (via ${target})`;
      fail(where, `${id} is merged into ${next}${via}, which is itself retired and never loaded — point the merge at an active rule`);
    }
  }
}

// --- SKILL.md ----------------------------------------------------------------

/** Validate SKILL.md and return the set of categories its routing table names. */
async function validateSkill() {
  const source = await readIfPresent(SKILL_FILE);
  if (source === null) {
    fail('SKILL.md', 'not found at plugins/auro/skills/coding-standards/SKILL.md');
    return new Set();
  }

  const lines = source.replace(/\n$/, '').split('\n').length;
  if (lines > MAX_SKILL_LINES) {
    fail('SKILL.md', `is ${lines} lines (max ${MAX_SKILL_LINES}) — rules belong in references/, not the body`);
  }

  // D4: model-invocability is an *omission*. A copy-paste from any other Auro
  // skill re-adds this key and silently un-triggers the whole skill.
  const frontmatter = source.match(FRONTMATTER_RE);
  if (!frontmatter) {
    fail('SKILL.md', 'missing YAML frontmatter');
  } else if (/^disable-model-invocation:/m.test(frontmatter[1])) {
    fail('SKILL.md', 'sets disable-model-invocation — coding-standards must stay model-invocable');
  }

  // Match any plausible filename rather than just the lowercase-alphanumeric
  // shape the current categories happen to have, so a route pointing at
  // `references/foo-bar.md` or `references/FOO.md` is reported as unknown
  // instead of being skipped as if the row were not there. The character class
  // deliberately excludes `*`, so a prose mention of `references/*.md`
  // describing the layout is not itself flagged as a missing category.
  // Scanning the raw file would read fenced examples as real routes, the same
  // blind spot parseRules had: a usage example naming `references/<name>.md`
  // would either fail as an unknown category or mask a genuinely unreachable
  // one. A commented-out route is the same problem in the other direction — it
  // is not a live route and must not count as one, so the category it names is
  // correctly reported unreachable. Strip fences and comments first so only
  // prose and table rows are scanned.
  const scannable = stripFencesAndComments(source, 'SKILL.md');
  const referenced = new Set([...scannable.matchAll(/references\/([A-Za-z0-9_-]+)\.md/g)].map((m) => m[1]));
  for (const name of referenced) {
    if (!CATEGORIES.includes(name)) {
      fail('SKILL.md', `routing table points at references/${name}.md, which is not a known category`);
    }
  }
  return referenced;
}

// --- main --------------------------------------------------------------------

async function main() {
  const referenced = await validateSkill();

  const present = new Set();
  try {
    for (const entry of await readdir(REFS_DIR, { withFileTypes: true })) {
      if (entry.isFile() && entry.name.endsWith('.md')) present.add(entry.name.replace(/\.md$/, ''));
    }
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
    fail('references/', 'directory not found');
  }

  for (const name of present) {
    if (!CATEGORIES.includes(name)) {
      fail(`references/${name}.md`, 'is not a known category — add it to CATEGORIES or remove the file');
    }
  }

  const seenIds = new Map();
  const report = [];

  for (const name of CATEGORIES) {
    const file = `references/${name}.md`;
    const segment = name.toUpperCase();
    const source = await readIfPresent(join(REFS_DIR, `${name}.md`));

    if (source === null) {
      fail(file, 'missing — all ten category files must exist, even when empty');
      continue;
    }
    if (!referenced.has(name)) {
      fail('SKILL.md', `routing table never points at ${file} — the category is unreachable`);
    }

    const rules = parseRules(source, file)
      .map((rule) => validateRule(file, segment, rule, seenIds))
      .filter(Boolean);

    const active = rules.filter((r) => !r.retired);
    if (active.length > MAX_RULES_PER_FILE) {
      fail(file, `has ${active.length} active rules (max ${MAX_RULES_PER_FILE}) — split the category per §3.3`);
    }

    report.push({ file, active, retired: rules.length - active.length });
  }

  resolveTombstones(seenIds);

  // --- staleness report (never fails the build, parent TRD §7) ---------------
  console.log('validate-standards: staleness report');
  let total = 0;
  for (const entry of report) {
    total += entry.active.length;
    const suffix = entry.retired ? ` (+${entry.retired} retired)` : '';
    console.log(`validate-standards:   ${entry.file.padEnd(22)} ${entry.active.length} rule(s)${suffix}`);
    for (const rule of entry.active) {
      const scoped = rule.appliesTo ? ' scoped' : '';
      console.log(`validate-standards:     ${rule.id}  sources=${rule.sources.length}  since=${rule.since || 'unknown'}  cited=n/a (Phase 5)${scoped}`);
    }
  }
  console.log(`validate-standards:   total ${total} rule(s) across ${CATEGORIES.length} categories`);

  if (errors.length) {
    for (const message of errors) console.error(`validate-standards: ${message}`);
    console.error(`validate-standards: ${errors.length} error(s)`);
    process.exit(1);
  }

  console.log('validate-standards: OK');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
