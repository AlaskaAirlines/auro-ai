#!/usr/bin/env node
// Transforms the Claude Code skills (plugins/auro/skills/<name>/SKILL.md) into
// GitHub Copilot prompt files (copilot/prompts/<name>.prompt.md).
//
// SKILL.md is the single source of truth. This script is idempotent — running it
// on a clean tree produces no diff. It is run manually via `npm run build:copilot`
// and again at release time (see .releaserc prepareCmd) so the generated prompt
// files never drift from the skills they mirror.
//
// The two formats are close but not identical: Copilot prompt files use a
// `mode`/`tools` frontmatter and `${input:...}` variables, and have no equivalent
// for Claude-only features (sub-agent `Task` fan-out, multi-model `context: fork`,
// the structured `AskUserQuestion` tool, or per-command Bash allowlists). Those
// features degrade gracefully and are called out in a compatibility note.
import { readdir, readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SKILLS_DIR = join(ROOT, 'plugins/auro/skills');
const OUT_DIR = join(ROOT, 'copilot/prompts');

// --- frontmatter parsing -----------------------------------------------------

/** Split a SKILL.md into its raw YAML frontmatter block and Markdown body. */
function splitFrontmatter(source, file) {
  const match = source.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!match) {
    throw new Error(`${file}: missing YAML frontmatter`);
  }
  return { frontmatter: match[1], body: match[2] };
}

/**
 * Parse the flat `key: value` frontmatter the skills use. Values are treated as
 * plain strings (the only multi-token value, `allowed-tools`, is a single line).
 */
function parseFrontmatter(frontmatter) {
  const fields = {};
  for (const line of frontmatter.split('\n')) {
    const m = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (m) fields[m[1]] = m[2].trim();
  }
  return fields;
}

// --- tool mapping ------------------------------------------------------------

// Canonical output order so the generated `tools` list is deterministic.
const TOOL_ORDER = ['runCommands', 'editFiles', 'search', 'codebase', 'fetch'];

/** Map one Claude `allowed-tools` token to zero or more Copilot tool names. */
function mapTool(token) {
  if (token.startsWith('Bash(') || token === 'Bash') return ['runCommands'];
  if (token.startsWith('Write') || token === 'Edit') return ['editFiles'];
  if (token === 'Read' || token === 'Grep' || token === 'Glob') return ['search', 'codebase'];
  if (token === 'WebFetch') return ['fetch'];
  // Dropped — no Copilot equivalent: AskUserQuestion (agent asks inline), Task
  // (sub-agents), and anything else Claude-specific.
  return [];
}

/** Split `allowed-tools` on top-level commas (ignoring commas inside parens). */
function splitAllowedTools(value) {
  const tokens = [];
  let depth = 0;
  let current = '';
  for (const ch of value) {
    if (ch === '(') depth++;
    else if (ch === ')') depth--;
    if (ch === ',' && depth === 0) {
      tokens.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  if (current.trim()) tokens.push(current.trim());
  return tokens;
}

function mapTools(allowedTools) {
  const mapped = new Set();
  for (const token of splitAllowedTools(allowedTools || '')) {
    for (const tool of mapTool(token)) mapped.add(tool);
  }
  return TOOL_ORDER.filter((t) => mapped.has(t));
}

// --- per-skill compatibility notes -------------------------------------------

// Extra lines appended to the compatibility note for skills that lose behavior
// in the Copilot port. Keyed by skill name; omitted skills get only the base note.
const CAVEATS = {
  'code-review':
    "Claude runs this as an adversarial multi-model review via sub-agents; Copilot runs a single-model review. Posting findings to the GitHub PR still works through `gh` in the terminal.",
  ado: 'Requires the GitHub CLI (`gh`) and an Azure DevOps PAT in your environment; the terminal will ask to approve each command.',
  'post-mortem':
    'Requires the GitHub CLI (`gh`); Azure DevOps context needs an ADO PAT in your environment. The terminal will ask to approve each command.',
  'sprint-report':
    'Requires an Azure DevOps PAT in your environment and shell tools (`curl`, `jq`); the terminal will ask to approve each command.',
};

/** Build the leading banner + compatibility block prepended to each prompt body. */
function buildPreamble(name, fields) {
  const lines = [
    `<!-- Generated from plugins/auro/skills/${name}/SKILL.md by scripts/build-copilot-prompts.mjs. Do not edit by hand. -->`,
    '',
  ];

  if (fields['argument-hint']) {
    lines.push(
      `> **Argument** (\`\${input:args}\`): ${fields['argument-hint']}`,
      '',
    );
  }

  const noteParts = [];
  const dropped = new Set(splitAllowedTools(fields['allowed-tools'] || '').map((t) => t.split('(')[0]));
  if (dropped.has('AskUserQuestion')) {
    noteParts.push('Where the workflow says to prompt you, Copilot asks inline in chat instead of via a structured picker.');
  }
  if (CAVEATS[name]) noteParts.push(CAVEATS[name]);

  if (noteParts.length) {
    lines.push('> **Copilot compatibility:** ' + noteParts.join(' '), '');
  }

  return lines.join('\n');
}

// --- body transformation -----------------------------------------------------

function transformBody(body) {
  // Claude exposes the invocation argument as `$ARGUMENTS`; Copilot uses the
  // `${input:...}` variable syntax and prompts for it on invocation.
  return body.replace(/\$ARGUMENTS/g, '${input:args}');
}

// --- emit --------------------------------------------------------------------

function yamlString(value) {
  // Single-quote and escape embedded single quotes, per YAML rules.
  return `'${value.replace(/'/g, "''")}'`;
}

function renderPrompt(name, source) {
  const { frontmatter, body } = splitFrontmatter(source, name);
  const fields = parseFrontmatter(frontmatter);
  const tools = mapTools(fields['allowed-tools']);

  const fm = [
    '---',
    "mode: 'agent'",
    `description: ${yamlString(fields.description || '')}`,
    `tools: [${tools.map((t) => `'${t}'`).join(', ')}]`,
    '---',
  ].join('\n');

  const preamble = buildPreamble(name, fields).trimEnd();
  const transformedBody = transformBody(body).replace(/^\n+/, '');

  return `${fm}\n\n${preamble}\n\n${transformedBody.trimEnd()}\n`;
}

async function main() {
  const entries = await readdir(SKILLS_DIR, { withFileTypes: true });
  const skills = entries.filter((e) => e.isDirectory()).map((e) => e.name).sort();

  // Start from a clean output dir so removed skills don't leave stale prompts.
  await rm(OUT_DIR, { recursive: true, force: true });
  await mkdir(OUT_DIR, { recursive: true });

  for (const name of skills) {
    const source = await readFile(join(SKILLS_DIR, name, 'SKILL.md'), 'utf8');
    const out = renderPrompt(name, source);
    await writeFile(join(OUT_DIR, `${name}.prompt.md`), out);
    console.log(`build-copilot-prompts: wrote copilot/prompts/${name}.prompt.md`);
  }

  console.log(`build-copilot-prompts: generated ${skills.length} prompt file(s)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
