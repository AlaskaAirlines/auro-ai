#!/usr/bin/env node
// Transforms the Claude Code skills (plugins/auro/skills/<name>/SKILL.md) into
// GitHub Copilot CLI custom agents (copilot/agents/<name>.agent.md).
//
// SKILL.md is the single source of truth. This script is idempotent — running it
// on a clean tree produces no diff. It is run manually via
// `npm run build:copilot:agents` and again at release time (see .releaserc
// prepareCmd) so the generated agent files never drift from the skills they mirror.
//
// Why a separate output from copilot/prompts/: the VS Code *prompt files* and the
// Copilot *CLI* are different products. The CLI does NOT load `.github/prompts/
// *.prompt.md` as slash commands (open feature request); its reusable, invocable
// unit is a **custom agent** — a `<name>.agent.md` file invoked with `/agent` or
// `copilot --agent <name>`. This script emits those.
//
// Two shapes are produced:
//   - inline:    the full workflow is embedded in the agent body (self-contained,
//                needs no checkout at runtime).
//   - bootstrap: for skills whose inlined body would exceed the CLI's 30,000-char
//                agent-prompt cap, the agent instead instructs Copilot to read the
//                SKILL.md from a local `auro-ai` checkout (via $AURO_AI_HOME) and
//                follow it. Keeps the agent tiny and cap-safe.
import { readdir, readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SKILLS_DIR = join(ROOT, 'plugins/auro/skills');
const OUT_DIR = join(ROOT, 'copilot/agents');

// The Copilot CLI caps a custom agent's prompt (frontmatter + body) at 30,000
// characters. Anything at or above this falls back to the bootstrap shape.
const AGENT_CHAR_LIMIT = 30000;

// --- frontmatter parsing (shared shape with build-copilot-prompts.mjs) -------

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

// --- emit --------------------------------------------------------------------

function yamlString(value) {
  // Single-quote and escape embedded single quotes, per YAML rules.
  return `'${value.replace(/'/g, "''")}'`;
}

/**
 * Build the agent YAML frontmatter. `tools` is intentionally omitted: the CLI
 * defaults an agent to all available tools, which is safer than mapping Claude's
 * `allowed-tools` onto CLI tool names that differ from the VS Code prompt names.
 * `disable-model-invocation` is carried through when the skill sets it.
 */
function renderFrontmatter(name, fields) {
  const lines = ['---', `name: ${name}`, `description: ${yamlString(fields.description || '')}`, 'user-invocable: true'];
  if (String(fields['disable-model-invocation']).toLowerCase() === 'true') {
    lines.push('disable-model-invocation: true');
  }
  lines.push('---');
  return lines.join('\n');
}

const GENERATED_NOTE = (name) =>
  `<!-- Generated from plugins/auro/skills/${name}/SKILL.md by scripts/build-copilot-agents.mjs. Do not edit by hand. -->`;

/** The argument banner. The CLI has no `${input:...}` substitution, so the body
 *  below defines `${input}` in prose as "the prompt you were invoked with". */
function argumentBanner(fields) {
  const hint = fields['argument-hint'] ? `: ${fields['argument-hint']}` : '';
  return `> **Argument** (\`\${input}\`)${hint} — you receive it as the text of the prompt you were invoked with (the part after the agent name; empty if none). Where a step says to prompt the user, ask inline in chat.`;
}

/** Inline shape: the whole workflow embedded, with `$ARGUMENTS` → `${input}`. */
function renderInlineBody(name, fields, body) {
  const transformed = body.replace(/\$ARGUMENTS/g, '${input}').replace(/^\n+/, '');
  return [GENERATED_NOTE(name), '', argumentBanner(fields), '', transformed.trimEnd()].join('\n');
}

/** Bootstrap shape: too large to inline — read the SKILL.md from a checkout. */
function renderBootstrapBody(name, fields) {
  return [
    GENERATED_NOTE(name),
    '',
    argumentBanner(fields),
    '',
    '## Task — start now',
    '',
    `You are executing the **${name}** workflow. Its full instructions are large and live in the \`auro-ai\` repository rather than inline here. **Read the workflow file in full and follow every step in order:**`,
    '',
    '1. Determine the path to your local `auro-ai` checkout — prefer the `AURO_AI_HOME` environment variable; if it is unset, ask the user for the path.',
    `2. Read \`"$AURO_AI_HOME/plugins/auro/skills/${name}/SKILL.md"\` in full (e.g. \`cat\` it via your shell tool, or open it with your read tool).`,
    '3. Execute that workflow exactly, in order. Treat every `$ARGUMENTS` reference in it as `${input}` — the argument you were invoked with. Where a step says to prompt the user, ask inline in chat.',
    '',
    'Do not summarize, reorder, or skip steps — follow the file as written.',
  ].join('\n');
}

function renderAgent(name, source) {
  const { frontmatter, body } = splitFrontmatter(source, name);
  const fields = parseFrontmatter(frontmatter);
  const fm = renderFrontmatter(name, fields);

  const inline = `${fm}\n\n${renderInlineBody(name, fields, body)}\n`;
  if (inline.length <= AGENT_CHAR_LIMIT) {
    return { out: inline, shape: 'inline', size: inline.length };
  }
  const bootstrap = `${fm}\n\n${renderBootstrapBody(name, fields)}\n`;
  return { out: bootstrap, shape: 'bootstrap', size: inline.length };
}

async function main() {
  const entries = await readdir(SKILLS_DIR, { withFileTypes: true });
  const skills = entries.filter((e) => e.isDirectory()).map((e) => e.name).sort();

  // Start from a clean output dir so removed skills don't leave stale agents.
  await rm(OUT_DIR, { recursive: true, force: true });
  await mkdir(OUT_DIR, { recursive: true });

  for (const name of skills) {
    const source = await readFile(join(SKILLS_DIR, name, 'SKILL.md'), 'utf8');
    const { out, shape, size } = renderAgent(name, source);
    await writeFile(join(OUT_DIR, `${name}.agent.md`), out);
    const note = shape === 'bootstrap' ? ` (bootstrap — inline would be ${size} > ${AGENT_CHAR_LIMIT} chars)` : '';
    console.log(`build-copilot-agents: wrote copilot/agents/${name}.agent.md [${shape}]${note}`);
  }

  console.log(`build-copilot-agents: generated ${skills.length} agent file(s)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
