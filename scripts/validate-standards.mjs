#!/usr/bin/env node
// Schema linter for the coding-standards skill. Validates
// plugins/auro/skills/coding-standards/SKILL.md and its references/*.md
// against the rule schema in the parent TRD (AB#1642023 §3.2–§3.5), and
// prints a non-failing staleness report (§7). Invoked as:
//   node scripts/validate-standards.mjs        (npm run validate:standards)
//
// Dependency-free and read-only. It runs as the first step of
// check-copilot-prompts.yml, ahead of the two regenerate-and-diff gates —
// it must never write to the working tree, or those gates would see its
// output as drift.
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
const TOMBSTONE_RE = /^merged into (CS-[A-Z0-9]+-\d{3})$/;
const FRONTMATTER_RE = /^---\n([\s\S]*?)\n---/;
const FIELD_RE = /^-\s+\*\*([^:*]+):\*\*\s*(.*)$/;
const SOURCE_RE = /AB#(\d+)/g;
const LEARNED_RE = /^×(\d+)$/;
const SINCE_RE = /^\d{4}-\d{2}-\d{2}$/;

const errors = [];
const fail = (where, message) => errors.push(`${where}: ${message}`);

// Merge tombstones (§3.5) name a target ID that may live in any category file,
// so they can only be resolved once every file has been parsed.
const tombstones = [];

/** Read a file, returning null when it does not exist. */
async function readIfPresent(path) {
  try {
    return await readFile(path, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    throw err;
  }
}

// --- reference-file parsing --------------------------------------------------

/**
 * Split a reference file into rule blocks, tracking which `##` section each
 * block sits under so `## Retired` entries (§3.5) can be exempted from the
 * field requirements while still holding their ID reserved.
 */
function parseRules(source) {
  const rules = [];
  let section = null;
  let current = null;
  const flush = () => {
    if (current) rules.push(current);
    current = null;
  };

  source.split('\n').forEach((raw, index) => {
    const line = raw.trimEnd();

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
    if (line.trim() && !line.trim().startsWith('<!--')) current.body.push(line.trim());
  });

  flush();
  return rules;
}

/** Distinct `AB#` ticket numbers cited in a Sources value. */
function uniqueSources(value) {
  return [...new Set([...(value || '').matchAll(SOURCE_RE)].map((m) => m[1]))];
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
    tombstones.push({ id, target: tombstone[1], where });
    return { id, retired: true, sources: [] };
  }

  const retired = rule.section === 'retired';

  if (title.length > MAX_TITLE_CHARS) {
    fail(where, `${id} title is ${title.length} chars (max ${MAX_TITLE_CHARS})`);
  }

  const sources = uniqueSources(rule.fields.sources);

  // Retired rules stay traceable but are not loaded, so they are exempt from
  // the field requirements that exist to make a rule actionable.
  if (retired) return { id, retired: true, sources };

  if (!rule.body.length) fail(where, `${id} has no body — state the rule and the failure it prevents`);
  // `Applies to` is deliberately OPTIONAL. Auro standards apply to all Auro code by
  // default; the field is present only when a rule has a genuine technical
  // precondition that narrows when it bites. Requiring it produced boilerplate
  // ("any component", "all code"), which is the anti-platitude problem relocated
  // into a different field. Its presence is the signal.
  if (!rule.fields.sources) fail(where, `${id} is missing "Sources"`);
  if (!sources.length) fail(where, `${id} has no AB# source — no traceability, no rule`);

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

  const referenced = new Set([...source.matchAll(/references\/([a-z0-9]+)\.md/g)].map((m) => m[1]));
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

    const rules = parseRules(source)
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
