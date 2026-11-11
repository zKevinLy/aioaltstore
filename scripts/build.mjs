// Builds everything derived from sources.json (the one master list):
//   sources/<id>.json   a snapshot of every source: generated from GitHub releases for
//                       `github` entries, mirrored from the developer's URL for `external` ones
//   store.json          all of those merged into the single source you add to Store
//   README.md           the table between the sources markers
//
//   node scripts/build.mjs                 all of it
//   node scripts/build.mjs --only ytkace   refresh one source (store.json + README still rebuilt)
//   node scripts/build.mjs --offline       store.json + README from the snapshots, no network
//
// Set GITHUB_TOKEN to avoid GitHub's 60 requests/hour unauthenticated limit.

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { STORE_FILE, buildStore } from './lib/aggregate.mjs';
import { buildSource } from './lib/store.mjs';
import { createGitHub } from './lib/github.mjs';
import { loadManifest } from './lib/manifest.mjs';
import { applyTable, renderTable, serialize } from './lib/render.mjs';

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

/** Downloads a developer's own source; refuses anything that isn't a source with apps. */
export async function fetchExternal(source, fetchImpl = fetch) {
  const response = await fetchImpl(source.url, { headers: { 'User-Agent': 'aiostore' } });
  if (!response.ok) throw new Error(`HTTP ${response.status} for ${source.url}`);
  const json = await response.json();
  if (!json || !Array.isArray(json.apps) || json.apps.length === 0) {
    throw new Error(`${source.url} is not a source with apps`);
  }
  return json;
}

/** Every snapshot on disk, in sources.json order. A source with no snapshot yet is skipped. */
export async function readSnapshots(manifest, root) {
  const snapshots = [];
  for (const source of manifest.sources) {
    const text = await readIfExists(path.join(root, 'sources', `${source.id}.json`));
    if (text !== null) snapshots.push({ source, json: JSON.parse(text) });
  }
  return snapshots;
}

export async function build({
  root = ROOT,
  github = createGitHub({ token: process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN }),
  fetchImpl = fetch,
  only = null,
  offline = false,
  log = console.log,
} = {}) {
  const manifest = await loadManifest(root);
  const result = { written: [], unchanged: [], failed: [], conflicts: [] };

  if (only && !manifest.sources.some((source) => source.id === only)) {
    throw new Error(`No source with id "${only}" in sources.json`);
  }

  const record = async (label, file, content) => {
    const changed = await writeIfChanged(path.join(root, file), content);
    (changed ? result.written : result.unchanged).push(label);
    log(`${changed ? 'updated  ' : 'unchanged'} ${file}`);
  };

  if (!offline) {
    for (const source of manifest.sources.filter((s) => !only || s.id === only)) {
      try {
        let snapshot;
        if (source.type === 'github') {
          const [repoInfo, releases] = await Promise.all([
            github.getRepo(source.repo),
            github.getReleases(source.repo),
          ]);
          snapshot = buildSource(manifest, source, repoInfo, releases);
        } else {
          snapshot = await fetchExternal(source, fetchImpl);
        }
        await record(source.id, `sources/${source.id}.json`, serialize(snapshot));
      } catch (error) {
        // Keep going: one broken source must not stop the others, and its last good file stays.
        result.failed.push({ id: source.id, error: error.message });
        log(`FAILED    ${source.id}: ${error.message}`);
      }
    }
  }

  const { store, conflicts } = buildStore(manifest, await readSnapshots(manifest, root));
  result.conflicts = conflicts;
  for (const conflict of conflicts) log(`warning   ${conflict}`);
  await record('store', STORE_FILE, serialize(store));

  const readmePath = path.join(root, 'README.md');
  const readme = await readFile(readmePath, 'utf8');
  await record('readme', 'README.md', applyTable(readme, renderTable(manifest)));

  return result;
}

function parseArgs(argv) {
  const args = { only: null, offline: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--offline') args.offline = true;
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
