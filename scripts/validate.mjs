// Checks everything committed to the repo, offline. CI runs this on every push.
//   - sources.json is valid
//   - each snapshot in sources/ is a well-formed Store source
//   - store.json and the README table match sources.json + the snapshots (else: npm run build:offline)
//   - no leftover files for sources that were removed
//
// A snapshot that doesn't exist yet is only a warning: the "Update sources" workflow
// creates it the first time it runs.

import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { STORE_FILE, buildStore } from './lib/aggregate.mjs';
import { readSnapshots } from './build.mjs';
import { loadManifest } from './lib/manifest.mjs';
import { TABLE_END, TABLE_START, applyTable, renderTable, serialize } from './lib/render.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const isHttps = (value) => {
  try {
    return new URL(value).protocol === 'https:';
  } catch {
    return false;
  }
};

/** Problems with one Store source object (empty = fine). */
export function checkStoreSource(json, source) {
  const errors = [];
  const need = (ok, message) => ok || errors.push(message);

  need(json && typeof json === 'object', 'not a JSON object');
  if (errors.length) return errors;

  // Generated sources are ours, so they get the full check. A mirrored external source is the
  // developer's file (possibly the older format without `versions`), so only the basics.
  const strict = source.type === 'github';

  need(json.name, 'missing name');
  if (strict) need(json.identifier, 'missing identifier');
  need(Array.isArray(json.apps) && json.apps.length > 0, 'apps must be a non-empty array');

  for (const app of json.apps ?? []) {
    const where = `app ${app?.bundleIdentifier ?? '?'}`;
    need(app?.name, `${where}: missing name`);
    need(app?.bundleIdentifier, `${where}: missing bundleIdentifier`);
    if (!strict) continue;
    need(app?.bundleIdentifier === source.app.bundleIdentifier, `${where}: bundleIdentifier differs from sources.json`);
    need(Array.isArray(app?.versions) && app.versions.length > 0, `${where}: needs at least one version`);

    for (const version of app?.versions ?? []) {
      const label = `${where} ${version?.version ?? '?'}`;
      need(version?.version, `${label}: missing version`);
      need(!Number.isNaN(Date.parse(version?.date)), `${label}: date is not a valid date`);
      need(isHttps(version?.downloadURL), `${label}: downloadURL must be https`);
      need(Number.isInteger(version?.size) && version.size > 0, `${label}: size must be a positive number`);
    }
  }
  return errors;
}

async function readIfExists(file) {
  try {
    return await readFile(file, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

export async function validate(root = ROOT) {
  const errors = [];
  const warnings = [];
  const manifest = await loadManifest(root); // throws with every manifest problem

  for (const source of manifest.sources) {
    const file = `sources/${source.id}.json`;
    const text = await readIfExists(path.join(root, file));
    if (text === null) {
      warnings.push(`${file} doesn't exist yet (run the "Update sources" workflow or npm run build)`);
      continue;
    }
    try {
      for (const problem of checkStoreSource(JSON.parse(text), source)) {
        errors.push(`${file}: ${problem}`);
      }
    } catch (error) {
      errors.push(`${file}: invalid JSON (${error.message})`);
    }
  }

  const known = new Set(manifest.sources.map((source) => `${source.id}.json`));
  const present = await readdir(path.join(root, 'sources')).catch(() => []);
  for (const name of present.filter((n) => n.endsWith('.json') && !known.has(n))) {
    errors.push(`sources/${name} has no matching entry in sources.json (delete it)`);
  }

  const { store, conflicts } = buildStore(manifest, await readSnapshots(manifest, root));
  for (const conflict of conflicts) warnings.push(conflict);
  const current = await readIfExists(path.join(root, STORE_FILE));
  if (current !== serialize(store)) {
    errors.push(`${STORE_FILE} is out of date (run npm run build:offline)`);
  }

  const readme = await readIfExists(path.join(root, 'README.md'));
  if (readme === null || !readme.includes(TABLE_START) || !readme.includes(TABLE_END)) {
    errors.push(`README.md needs ${TABLE_START} and ${TABLE_END} markers`);
  } else if (readme !== applyTable(readme, renderTable(manifest))) {
    errors.push('README.md source table is out of date (run npm run build:offline)');
  }

  return { errors, warnings };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const { errors, warnings } = await validate();
    for (const warning of warnings) console.warn(`warning: ${warning}`);
    for (const error of errors) console.error(`error: ${error}`);
    if (errors.length > 0) process.exitCode = 1;
    else console.log('OK');
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
