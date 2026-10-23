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
 * What counts as an edit. "Component source" is approximated as "a file inside
 * the session's working directory" -- the `cwd` each transcript record carries.
 * This is a heuristic, kept deliberately simple:
 *
 *   - Edit, Write, MultiEdit and NotebookEdit count, unless the target is a
 *     scratch path: /tmp, /private/tmp, /var/folders, $TMPDIR, /dev, or any
 *     absolute path outside the session's cwd. A plan written to /tmp before
 *     the skill loads is not a failed arm.
 *   - Bash counts when the command visibly writes a file in the repo: `sed -i`
 *     or `perl -i` (the last argument is taken as the target), `>`/`>>`
 *     redirection, `tee`, `cp`/`mv` onto a destination, and `git apply` or
 *     `patch` (taken to write the repo). Quoted strings and heredoc bodies are
 *     ignored when looking for redirections. Writes hidden inside an
 *     interpreter (`node -e`, `python -c`), a script, or a variable are NOT
 *     seen -- such a session can still read as passing.
 *   - With no `cwd` in the transcript, any path that is not a scratch path
 *     counts. An edit whose target cannot be determined counts.
 *
 * Subagents. Tool calls inside a delegated agent (Task/Agent) are written to a
 * separate transcript file in current Claude Code, so edits a subagent makes
 * are invisible here. Records inline in this file (including `isSidechain`
 * ones) are counted. The report lists the ordinals at which work was delegated
 * so a reader knows when the edit sequence may be incomplete.
 *
 * The skill matches by full name or by its un-namespaced name, so
 * `coding-standards` (a project-level install) and `auro:coding-standards` (the
 * plugin) are both found whichever form is passed to --skill.
 *
 * Usage:
 *   npm run score:trigger -- <transcript.jsonl> [more.jsonl ...]
 *   npm run score:trigger -- --skill other:skill-name <transcript.jsonl>
 */

import { readFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { basename, isAbsolute, resolve } from 'node:path';

const DEFAULT_SKILL = 'auro:coding-standards';
const EDIT_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit']);
const READ_TOOLS = new Set(['Read', 'Grep', 'Glob']);
const AGENT_TOOLS = new Set(['Task', 'Agent']);
const USAGE = 'usage: npm run score:trigger -- [--skill <name>] <transcript.jsonl> [...]';

const SCRATCH_ROOTS = [
  '/tmp', '/private/tmp', '/var/folders', '/private/var/folders', '/dev',
  process.env.TMPDIR, tmpdir(),
]
  .filter(Boolean)
  .map((p) => p.replace(/\/+$/, ''));

const bareName = (name) => name.split(':').pop();
const within = (path, root) => path === root || path.startsWith(`${root}/`);

/** True when `file` is a scratch path rather than something in the repo. */
function isScratch(file, cwd) {
  if (/^\$\{?TMPDIR\}?(\/|$)/.test(file)) return true;
  let abs = file.startsWith('~/') ? `${homedir()}${file.slice(1)}` : file;
  if (!isAbsolute(abs)) {
    if (!cwd) return false;
    abs = resolve(cwd, abs);
  }
  abs = resolve(abs);
  if (SCRATCH_ROOTS.some((root) => within(abs, root))) return true;
  return Boolean(cwd) && !within(abs, resolve(cwd));
}

/**
 * The files a Bash command visibly writes, or [] when it writes none. A `null`
 * target means "writes the repo, file unknown" (`git apply`, `patch`).
 */
function bashWriteTargets(command) {
  // Drop heredoc bodies: everything after the first line that opens one.
  const lines = command.split('\n');
  const heredoc = lines.findIndex((l) => /<<-?\s*['"]?\w+/.test(l));
  const text = (heredoc === -1 ? lines : lines.slice(0, heredoc + 1)).join('\n');
  // Unquote, neutralising shell metacharacters inside the quotes.
  const unquoted = text.replace(/'([^']*)'|"((?:\\.|[^"\\])*)"/g, (_, s, d) => (s ?? d).replace(/[\s<>|;&()]/g, '_'));

  const targets = [];
  // `>`, `>>`, `2>`, `&>` into a file. `>&2` and `2>&1` capture nothing,
  // because a target cannot start with `&`.
  for (const m of unquoted.matchAll(/(?:^|[^>])>>?\|?\s*([^\s;&|<>()]+)/g)) targets.push(m[1]);

  for (const segment of text.split(/&&|\|\||[;|\n]/)) {
    const words = (segment.match(/'[^']*'|"(?:\\.|[^"\\])*"|\S+/g) ?? [])
      .map((w) => w.replace(/^(['"])(.*)\1$/, '$2'));
    const cmdAt = words.findIndex((w) => !/^\w+=/.test(w) && w !== 'sudo');
    const cmd = words[cmdAt];
    const args = words.slice(cmdAt + 1).filter((w) => !w.startsWith('<') && !w.startsWith('>'));
    const files = args.filter((w) => !w.startsWith('-'));

    if ((cmd === 'sed' || cmd === 'perl') && args.some((w) => /^-\w*i/.test(w))) {
      if (files.length) targets.push(files.at(-1));
    } else if (cmd === 'tee') {
      targets.push(...files);
    } else if ((cmd === 'cp' || cmd === 'mv') && files.length >= 2) {
      targets.push(files.at(-1));
    } else if (cmd === 'git' && words[cmdAt + 1] === 'apply' && !args.some((w) => /^--(check|stat|numstat|summary)$/.test(w))) {
      targets.push(null);
    } else if (cmd === 'patch' && !args.includes('--dry-run')) {
      targets.push(null);
    }
  }
  return targets;
}

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
  let cwd = null;

  for (const line of readFileSync(path, 'utf8').split('\n')) {
    if (!line.trim()) continue;

    let record;
    try {
      record = JSON.parse(line);
    } catch {
      continue; // a partially-flushed final line on a live session
    }

    if (typeof record.cwd === 'string') cwd = record.cwd;
    const content = record.message?.content;
    if (!Array.isArray(content)) continue;

    for (const block of content) {
      if (block?.type !== 'tool_use') continue;
      ordinal += 1;

      const { name, input = {} } = block;
      const file = input.file_path ?? input.notebook_path ?? input.path ?? '';

      if (name === 'Skill') events.push({ ordinal, kind: 'skill', detail: input.skill });
      else if (EDIT_TOOLS.has(name)) {
        if (!file || !isScratch(file, cwd)) events.push({ ordinal, kind: 'edit', detail: file });
      } else if (name === 'Bash' && typeof input.command === 'string') {
        const hit = bashWriteTargets(input.command).find((t) => t === null || !isScratch(t, cwd));
        if (hit !== undefined) events.push({ ordinal, kind: 'edit', detail: `Bash: ${hit ?? input.command.split('\n')[0]}` });
      } else if (AGENT_TOOLS.has(name)) events.push({ ordinal, kind: 'agent', detail: input.description ?? '' });
      else if (READ_TOOLS.has(name)) events.push({ ordinal, kind: 'read', detail: file });
    }
  }

  return events;
}

function score(path, skillName) {
  const events = collectEvents(path);
  const isTarget = (detail) =>
    typeof detail === 'string' && (detail === skillName || bareName(detail) === skillName || detail === bareName(skillName));

  const firedAt = events.find((e) => e.kind === 'skill' && isTarget(e.detail))?.ordinal ?? null;
  const edits = events.filter((e) => e.kind === 'edit');
  const firstEdit = edits[0] ?? null;

  const references = [
    ...new Set(
      events
        .filter((e) => (e.kind === 'read' || e.kind === 'edit') && e.detail?.includes(`${bareName(skillName)}/references/`))
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
    firedAt,
    otherSkills: [...new Set(events.filter((e) => e.kind === 'skill' && !isTarget(e.detail)).map((e) => e.detail))].sort(),
    firstEdit,
    editCount: edits.length,
    edits,
    delegatedAt: events.filter((e) => e.kind === 'agent').map((e) => e.ordinal),
    references,
    ordering
  };
}

function report(result) {
  console.log('transcript      :', result.transcript);
  console.log('skill fired at  :', result.firedAt ?? 'NEVER');
  if (result.otherSkills.length) console.log('other skills    :', result.otherSkills.join(', '));
  console.log('first edit at   :', result.firstEdit ? `${result.firstEdit.ordinal}  ${result.firstEdit.detail}` : 'NONE');
  console.log('total edits     :', result.editCount);
  if (result.delegatedAt.length) {
    console.log('subagents at    :', `${result.delegatedAt.join(', ')}  (their edits are not in this transcript)`);
  }
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
  if (!skillName || skillName.startsWith('-')) {
    console.error('--skill needs a skill name');
    console.error(USAGE);
    process.exit(1);
  }
  argv.splice(flagIndex, 2);
}

if (!argv.length) {
  console.error(USAGE);
  process.exit(1);
}

argv.forEach((path, i) => {
  if (i) console.log();
  report(score(path, skillName));
});
