// Checks everything committed to the repo, offline. CI runs this on every push.
//   - sources.json is valid
//   - each generated source in sources/ is a well-formed AltStore source
//   - index.json and the README table match sources.json (else: npm run build:index)
//   - no leftover files for sources that were removed
//
// A generated source that doesn't exist yet is only a warning: the "Update sources"
// workflow creates it the first time it runs.

import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadManifest } from './lib/manifest.mjs';
import { TABLE_END, TABLE_START, applyTable, renderIndex, renderTable, serialize } from './lib/render.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const isHttps = (value) => {
  try {
    return new URL(value).protocol === 'https:';
  } catch {
    return false;
  }
};

/** Problems with one AltStore source object (empty = fine). */
export function checkAltStoreSource(json, source) {
  const errors = [];
  const need = (ok, message) => ok || errors.push(message);

  need(json && typeof json === 'object', 'not a JSON object');
  if (errors.length) return errors;

  need(json.name, 'missing name');
  need(json.identifier, 'missing identifier');
  need(Array.isArray(json.apps) && json.apps.length > 0, 'apps must be a non-empty array');

  for (const app of json.apps ?? []) {
    const where = `app ${app?.bundleIdentifier ?? '?'}`;
    need(app?.name, `${where}: missing name`);
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

  const generated = manifest.sources.filter((source) => source.type === 'github');
  for (const source of generated) {
    const file = `sources/${source.id}.json`;
    const text = await readIfExists(path.join(root, file));
    if (text === null) {
      warnings.push(`${file} doesn't exist yet (run the "Update sources" workflow or npm run build)`);
      continue;
    }
    try {
      for (const problem of checkAltStoreSource(JSON.parse(text), source)) {
        errors.push(`${file}: ${problem}`);
      }
    } catch (error) {
      errors.push(`${file}: invalid JSON (${error.message})`);
    }
  }

  const known = new Set(generated.map((source) => `${source.id}.json`));
  const present = await readdir(path.join(root, 'sources')).catch(() => []);
  for (const name of present.filter((n) => n.endsWith('.json') && !known.has(n))) {
    errors.push(`sources/${name} has no matching "github" entry in sources.json (delete it)`);
  }

  const index = await readIfExists(path.join(root, 'index.json'));
  if (index !== serialize(renderIndex(manifest))) {
    errors.push('index.json is out of date (run npm run build:index)');
  }

  const readme = await readIfExists(path.join(root, 'README.md'));
  if (readme === null || !readme.includes(TABLE_START) || !readme.includes(TABLE_END)) {
    errors.push(`README.md needs ${TABLE_START} and ${TABLE_END} markers`);
  } else if (readme !== applyTable(readme, renderTable(manifest))) {
    errors.push('README.md source table is out of date (run npm run build:index)');
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
