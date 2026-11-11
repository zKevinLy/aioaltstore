// Merges every source (generated or mirrored) into the one `store.json` people add to Store.
// Pure function: no network, no file access.

import { rawUrl } from './manifest.mjs';

export const STORE_FILE = 'store.json';
export const DEFAULT_MAX_VERSIONS = 3;

/** The reverse-DNS id of the combined store, e.g. io.github.zkevinly.aiostore. */
export function storeIdentifier(manifest) {
  const [owner, name] = manifest.repository.toLowerCase().split('/');
  return `io.github.${owner}.${name}`;
}

/** The URL to paste into Store -> Sources. */
export const storeUrl = (manifest) => rawUrl(manifest, STORE_FILE);

/**
 * Keeps the newest `max` distinct version numbers of an app, newest first. Every entry of a
 * kept version stays (an iOS 16 and an iOS 17 build of 1.1.7 count as one version). An app
 * in the older format, with no `versions` array, is returned untouched.
 */
export function limitVersions(app, max) {
  if (!Array.isArray(app.versions)) return app;
  const time = (entry) => Date.parse(entry.date) || 0;
  const newestFirst = app.versions
    .map((entry, order) => ({ entry, order }))
    .sort((a, b) => time(b.entry) - time(a.entry) || a.order - b.order)
    .map(({ entry }) => entry);

  const keep = new Set();
  for (const entry of newestFirst) {
    if (keep.size >= max && !keep.has(entry.version)) break;
    keep.add(entry.version);
  }
  return { ...app, versions: newestFirst.filter((entry) => keep.has(entry.version)) };
}

/**
 * `snapshots` is `[{ source, json }]` in sources.json order. Apps are concatenated; when two
 * sources ship the same bundle identifier the first one wins and the clash is reported,
 * because Store can't tell two apps with one bundle ID apart. Each app keeps only its newest
 * `maxVersions` versions (3 unless sources.json says otherwise, globally or per source).
 */
export function buildStore(manifest, snapshots) {
  const apps = [];
  const news = [];
  const owners = new Map(); // bundleIdentifier -> source id
  const seenNews = new Set();
  const conflicts = [];

  for (const { source, json } of snapshots) {
    const max = source.maxVersions ?? manifest.maxVersions ?? DEFAULT_MAX_VERSIONS;
    for (const raw of json.apps ?? []) {
      const app = limitVersions(raw, max);
      const owner = owners.get(app.bundleIdentifier);
      if (owner) {
        conflicts.push(`${app.bundleIdentifier} is in both "${owner}" and "${source.id}"; kept "${owner}"`);
        continue;
      }
      owners.set(app.bundleIdentifier, source.id);
      apps.push(app);
    }
    for (const item of json.news ?? []) {
      const key = item.identifier ?? JSON.stringify(item);
      if (seenNews.has(key)) continue;
      seenNews.add(key);
      news.push(item);
    }
  }

  const store = {
    name: manifest.name,
    identifier: storeIdentifier(manifest),
    ...(manifest.subtitle ? { subtitle: manifest.subtitle } : {}),
    ...(manifest.iconURL ? { iconURL: manifest.iconURL } : {}),
    ...(manifest.tintColor ? { tintColor: manifest.tintColor } : {}),
    website: `https://github.com/${manifest.repository}`,
    sourceURL: storeUrl(manifest),
    apps,
    news,
  };
  return { store, conflicts };
}
