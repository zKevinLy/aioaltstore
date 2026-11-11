// Builds everything generated from sources.json:
//   sources/<id>.json   an Store source for every `github` entry (from its releases)
//   index.json          every source and its URL
//   README.md           the table between the sources markers
//
//   node scripts/build.mjs                 all of it
//   node scripts/build.mjs --only ytkace   just one source (still refreshes index + README)
//   node scripts/build.mjs --index-only    index + README, no network
//
// Set GITHUB_TOKEN to avoid GitHub's 60 requests/hour unauthenticated limit.

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildSource } from './lib/Store.mjs';
import { createGitHub } from './lib/github.mjs';
import { loadManifest } from './lib/manifest.mjs';
import { applyTable, renderIndex, renderTable, serialize } from './lib/render.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

async function readIfExists(file) {
  try {
    return await readFile(file, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

/** Writes only when the content changed, so reruns leave git clean. */
async function writeIfChanged(file, content) {
  if ((await readIfExists(file)) === content) return false;
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, content);
  return true;
}

export async function build({
  root = ROOT,
  github = createGitHub({ token: process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN }),
  only = null,
  indexOnly = false,
  log = console.log,
} = {}) {
  const manifest = await loadManifest(root);
  const result = { written: [], unchanged: [], failed: [] };

  if (only && !manifest.sources.some((source) => source.id === only)) {
    throw new Error(`No source with id "${only}" in sources.json`);
  }

  const record = async (label, file, content) => {
    const changed = await writeIfChanged(path.join(root, file), content);
    (changed ? result.written : result.unchanged).push(label);
    log(`${changed ? 'updated  ' : 'unchanged'} ${file}`);
  };

  if (!indexOnly) {
    const targets = manifest.sources.filter(
      (source) => source.type === 'github' && (!only || source.id === only),
    );

    for (const source of targets) {
      try {
        const [repoInfo, releases] = await Promise.all([
          github.getRepo(source.repo),
          github.getReleases(source.repo),
        ]);
        const generated = buildSource(manifest, source, repoInfo, releases);
        await record(source.id, `sources/${source.id}.json`, serialize(generated));
      } catch (error) {
        // Keep going: one broken repo must not stop the others, and its last good file stays.
        result.failed.push({ id: source.id, error: error.message });
        log(`FAILED    ${source.id}: ${error.message}`);
      }
    }
  }

  await record('index', 'index.json', serialize(renderIndex(manifest)));

  const readmePath = path.join(root, 'README.md');
  const readme = await readFile(readmePath, 'utf8');
  await record('readme', 'README.md', applyTable(readme, renderTable(manifest)));

  return result;
}

function parseArgs(argv) {
  const args = { only: null, indexOnly: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--index-only') args.indexOnly = true;
    else if (argv[i] === '--only') args.only = argv[++i] ?? null;
    else throw new Error(`Unknown argument: ${argv[i]}`);
  }
  return args;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const result = await build(parseArgs(process.argv.slice(2)));
    if (result.failed.length > 0) process.exitCode = 1;
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
