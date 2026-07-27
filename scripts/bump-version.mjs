#!/usr/bin/env node
// Writes a release version into the two files Claude Code reads at install time,
// keeping them in lockstep. Invoked by semantic-release's @semantic-release/exec
// prepareCmd as: node scripts/bump-version.mjs <version>
//
// Both files are re-serialized with 2-space indentation and a trailing newline
// to match their committed formatting so the release diff stays minimal.
import { readFile, writeFile } from 'node:fs/promises';

const version = process.argv[2];
if (!version) {
  console.error('Usage: node scripts/bump-version.mjs <version>');
  process.exit(1);
}

const PLUGIN_MANIFEST = 'plugins/auro/.claude-plugin/plugin.json';
const MARKETPLACE_MANIFEST = '.claude-plugin/marketplace.json';

async function writeJson(path, value) {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`);
}

// plugins/auro/.claude-plugin/plugin.json — top-level `version`.
const plugin = JSON.parse(await readFile(PLUGIN_MANIFEST, 'utf8'));
plugin.version = version;
await writeJson(PLUGIN_MANIFEST, plugin);

// .claude-plugin/marketplace.json — the `auro` entry's `version`.
const marketplace = JSON.parse(await readFile(MARKETPLACE_MANIFEST, 'utf8'));
const auro = marketplace.plugins.find((p) => p.name === 'auro');
if (!auro) {
  console.error(`No plugin named "auro" in ${MARKETPLACE_MANIFEST}`);
  process.exit(1);
}
auro.version = version;
await writeJson(MARKETPLACE_MANIFEST, marketplace);

console.log(`bump-version: set auro plugin version to ${version}`);
