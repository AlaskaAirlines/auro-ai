#!/usr/bin/env node
/**
 * Score a skill-trigger scenario from a Claude Code session transcript.
 *
 * The gate criterion (Phase 1 TRD #40 §6.3) is *ordering*, not presence: the
 * Skill record for the standards skill must appear BEFORE the first Edit/Write
 * touching component source. A skill that loads after the code is written has
 * changed nothing.
 *
 * Why this exists rather than a grep. Both #40 §9 and the S5 runbook specify
 * shell one-liners over the raw JSONL, and both are wrong in ways that fail
 * silently and in the same direction as the finding:
 *
 *   1. `grep -c '"skill":"coding-standards"'` cannot match. The record is
 *      plugin-namespaced -- `auro:coding-standards`. This produced a false
 *      negative on 2026-09-22.
 *   2. `grep -n '"name":"Edit"'` matches the *tool schemas* carried in the
 *      system prompt, not tool calls. Every transcript reports a first edit in
 *      its opening records, which makes a passing arm look like a failing one.
 *
 * Both are avoided here by parsing `tool_use` content blocks.
 *
 * Usage:
 *   npm run score:trigger -- <transcript.jsonl> [more.jsonl ...]
 *   npm run score:trigger -- --skill other:skill-name <transcript.jsonl>
 */

import { readFileSync } from 'node:fs';
import { basename } from 'node:path';

const DEFAULT_SKILL = 'auro:coding-standards';
const EDIT_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit']);
const READ_TOOLS = new Set(['Read', 'Grep', 'Glob']);

/**
 * Walk a transcript and return every tool call we care about, tagged with its
 * position in the session's full tool-use sequence.
 *
 * Ordinals count *all* tool calls, including ones we do not classify (Bash,
 * TodoWrite, Task). That is deliberate: the ordinals are meant to be citable
 * against the transcript, so they have to match what is actually there. It
 * also means the ordinal of the last event is normally higher than the number
 * of events returned.
 */
function collectEvents(path) {
  const events = [];
  let ordinal = 0;

  for (const line of readFileSync(path, 'utf8').split('\n')) {
    if (!line.trim()) continue;

    let record;
    try {
      record = JSON.parse(line);
    } catch {
      continue; // a partially-flushed final line on a live session
    }

    const content = record.message?.content;
    if (!Array.isArray(content)) continue;

    for (const block of content) {
      if (block?.type !== 'tool_use') continue;
      ordinal += 1;

      const { name, input = {} } = block;
      const file = input.file_path ?? input.notebook_path ?? input.path ?? '';

      if (name === 'Skill') events.push({ ordinal, kind: 'skill', detail: input.skill });
      else if (EDIT_TOOLS.has(name)) events.push({ ordinal, kind: 'edit', detail: file });
      else if (READ_TOOLS.has(name)) events.push({ ordinal, kind: 'read', detail: file });
    }
  }

  return events;
}

function score(path, skillName) {
  const events = collectEvents(path);
  const raw = readFileSync(path, 'utf8');

  const firedAt = events.find((e) => e.kind === 'skill' && e.detail === skillName)?.ordinal ?? null;
  const edits = events.filter((e) => e.kind === 'edit');
  const firstEdit = edits[0] ?? null;

  const references = [
    ...new Set(
      events
        .filter((e) => (e.kind === 'read' || e.kind === 'edit') && e.detail?.includes(`${skillName.split(':').pop()}/references/`))
        .map((e) => basename(e.detail))
    )
  ].sort();

  let ordering;
  if (firedAt && firstEdit) ordering = firedAt < firstEdit.ordinal ? 'BEFORE first edit' : 'AFTER first edit';
  else if (firedAt) ordering = 'fired; no edits made';
  else if (firstEdit) ordering = 'never fired; edits made';
  else ordering = 'never fired; no edits';

  return {
    transcript: basename(path),
    // `advertised` distinguishes "the skill was on the menu and was not chosen"
    // from "the skill was never offered" -- the second is a broken install, not
    // a trigger failure, and the two are easy to confuse.
    advertised: raw.includes(skillName),
    firedAt,
    otherSkills: [...new Set(events.filter((e) => e.kind === 'skill' && e.detail !== skillName).map((e) => e.detail))].sort(),
    firstEdit,
    editCount: edits.length,
    edits,
    references,
    ordering
  };
}

function report(result) {
  console.log('transcript      :', result.transcript);
  console.log('skill advertised:', result.advertised);
  console.log('skill fired at  :', result.firedAt ?? 'NEVER');
  if (result.otherSkills.length) console.log('other skills    :', result.otherSkills.join(', '));
  console.log('first edit at   :', result.firstEdit ? `${result.firstEdit.ordinal}  ${result.firstEdit.detail}` : 'NONE');
  console.log('total edits     :', result.editCount);
  console.log('references read :');
  if (result.references.length) result.references.forEach((r) => console.log('   -', r));
  else console.log('    (none)');
  console.log('ORDERING        :', result.ordering);

  if (result.edits.length) {
    console.log('edit sequence   :');
    for (const e of result.edits.slice(0, 12)) {
      console.log(`   ${String(e.ordinal).padStart(4)}  ${e.detail}`);
    }
  }
}

const argv = process.argv.slice(2);
let skillName = DEFAULT_SKILL;

const flagIndex = argv.indexOf('--skill');
if (flagIndex !== -1) {
  skillName = argv[flagIndex + 1];
  argv.splice(flagIndex, 2);
}

if (!argv.length) {
  console.error('usage: npm run score:trigger -- [--skill <name>] <transcript.jsonl> [...]');
  process.exit(1);
}

argv.forEach((path, i) => {
  if (i) console.log();
  report(score(path, skillName));
});
