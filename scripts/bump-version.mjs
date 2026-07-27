#!/usr/bin/env node
// Sync the release version into auro-ai's plugin manifests.
//
// semantic-release computes the next version from Conventional Commits and
// invokes this script (via @semantic-release/exec) during the `prepare` step:
//
//   node scripts/bump-version.mjs <version>
//
// It writes <version> into both places the plugin's version is declared, which
// MUST stay in sync for the plugin to resolve correctly:
//   - plugins/auro/.claude-plugin/plugin.json  -> version
//   - .claude-plugin/marketplace.json          -> plugins[name==="auro"].version

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const version = process.argv[2];
if (!version) {
  console.error('Usage: node scripts/bump-version.mjs <version>');
  process.exit(1);
}

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// Read a JSON file, apply an update, and write it back with the original
// 2-space indentation and a trailing newline (matches the existing files).
function updateJson(relPath, mutate) {
  const filePath = resolve(repoRoot, relPath);
  const data = JSON.parse(readFileSync(filePath, 'utf8'));
  mutate(data);
  writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`);
  console.log(`bumped ${relPath} -> ${version}`);
}

updateJson('plugins/auro/.claude-plugin/plugin.json', (data) => {
  data.version = version;
});

updateJson('.claude-plugin/marketplace.json', (data) => {
  const plugin = data.plugins?.find((p) => p.name === 'auro');
  if (!plugin) {
    throw new Error('Could not find plugin "auro" in .claude-plugin/marketplace.json');
  }
  plugin.version = version;
});
