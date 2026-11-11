// Everything derived from sources.json that isn't an AltStore source: index.json and the
// table in the README. Pure functions, so `validate` can check the files are up to date.

import { sourceUrl } from './manifest.mjs';

export const TABLE_START = '<!-- sources:start -->';
export const TABLE_END = '<!-- sources:end -->';

export const serialize = (value) => `${JSON.stringify(value, null, 2)}\n`;

const homepageOf = (source) =>
  source.homepage ?? (source.type === 'github' ? `https://github.com/${source.repo}` : undefined);

/** index.json: every source with its final URL, for scripts and the website to read. */
export function renderIndex(manifest) {
  return {
    name: 'AIO AltStore',
    repository: manifest.repository,
    sources: manifest.sources.map((source) => ({
      id: source.id,
      name: source.name,
      description: source.description,
      type: source.type,
      url: sourceUrl(manifest, source),
      homepage: homepageOf(source),
    })),
  };
}

const cell = (text) => text.replace(/\|/g, '\\|').replace(/\s+/g, ' ').trim();

/** The markdown table that goes between the README's markers. */
export function renderTable(manifest) {
  const rows = manifest.sources.map((source) => {
    const homepage = homepageOf(source);
    const name = homepage ? `[${cell(source.name)}](${homepage})` : cell(source.name);
    const kind = source.type === 'github' ? 'Generated' : 'External';
    return `| ${name} | ${cell(source.description)} | ${kind} | \`${sourceUrl(manifest, source)}\` |`;
  });

  return [
    '| Source | About | Kind | Source URL |',
    '| --- | --- | --- | --- |',
    ...rows,
  ].join('\n');
}

/** Replaces what's between the markers; throws if the README lost them. */
export function applyTable(readme, table) {
  const start = readme.indexOf(TABLE_START);
  const end = readme.indexOf(TABLE_END);
  if (start === -1 || end === -1 || end < start) {
    throw new Error(`README.md needs ${TABLE_START} and ${TABLE_END} markers around the table`);
  }
  return `${readme.slice(0, start + TABLE_START.length)}\n${table}\n${readme.slice(end)}`;
}
