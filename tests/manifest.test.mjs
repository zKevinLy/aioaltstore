import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { rawUrl, sourceUrl, validateManifest } from '../scripts/lib/manifest.mjs';

const valid = () => ({
  name: 'AIOStore',
  repository: 'zKevinLy/aiostore',
  branch: 'main',
  sources: [
    {
      id: 'ext',
      type: 'external',
      name: 'Ext',
      description: 'An external source.',
      url: 'https://example.com/source.json',
    },
    {
      id: 'gh',
      type: 'github',
      name: 'GH',
      description: 'A generated source.',
      repo: 'owner/app',
      app: { name: 'App', bundleIdentifier: 'com.example.app' },
    },
  ],
});

const problems = (change) => {
  const manifest = valid();
  change(manifest);
  return validateManifest(manifest).join('\n');
};

describe('sources.json (the real one)', () => {
  it('is valid', async () => {
    const manifest = JSON.parse(await readFile(new URL('../sources.json', import.meta.url), 'utf8'));
    assert.deepEqual(validateManifest(manifest), []);
  });
});

describe('validateManifest', () => {
  it('accepts a minimal valid manifest', () => {
    assert.deepEqual(validateManifest(valid()), []);
  });

  it('rejects duplicate and badly formed ids', () => {
    assert.match(problems((m) => (m.sources[1].id = 'ext')), /used twice/);
    assert.match(problems((m) => (m.sources[0].id = 'Not Valid')), /id must be/);
  });

  it('requires https URLs for external sources', () => {
    assert.match(problems((m) => (m.sources[0].url = 'http://example.com/a.json')), /https URL/);
    assert.match(problems((m) => delete m.sources[0].url), /https URL/);
  });

  it('requires a repo and a valid bundle identifier for github sources', () => {
    assert.match(problems((m) => (m.sources[1].repo = 'nope')), /owner\/name/);
    assert.match(problems((m) => (m.sources[1].app.bundleIdentifier = 'x')), /bundleIdentifier/);
    assert.match(problems((m) => delete m.sources[1].app), /app is required/);
  });

  it('rejects broken asset rules', () => {
    assert.match(problems((m) => (m.sources[1].assets = [])), /non-empty array/);
    assert.match(problems((m) => (m.sources[1].assets = [{ match: '(' }])), /valid regex/);
    assert.match(
      problems((m) => (m.sources[1].assets = [{ match: 'a', minOSVersion: 'seventeen' }])),
      /minOSVersion/,
    );
  });

  it('requires a capture group in tagPattern', () => {
    assert.match(problems((m) => (m.sources[1].tagPattern = '^v.+$')), /capture group/);
    assert.deepEqual(
      validateManifest({ ...valid(), sources: [{ ...valid().sources[1], tagPattern: '^v(.+)$' }] }),
      [],
    );
  });

  it('bounds maxReleases and checks includePrereleases', () => {
    assert.match(problems((m) => (m.sources[1].maxReleases = 0)), /maxReleases/);
    assert.match(problems((m) => (m.sources[1].maxReleases = 500)), /maxReleases/);
    assert.match(problems((m) => (m.sources[1].includePrereleases = 'yes')), /includePrereleases/);
  });

  it('reports every problem at once', () => {
    const manifest = valid();
    manifest.sources[0].url = 'nope';
    manifest.sources[1].repo = 'nope';
    delete manifest.name;
    assert.equal(validateManifest(manifest).length, 3);
  });

  it('checks maxVersions, globally and per source', () => {
    assert.match(problems((m) => (m.maxVersions = 0)), /maxVersions/);
    assert.match(problems((m) => (m.sources[0].maxVersions = 'x')), /maxVersions/);
    assert.deepEqual(problems((m) => { m.maxVersions = 3; m.sources[0].maxVersions = 5; }), '');
  });

  it('rejects an unknown type and an empty list', () => {
    assert.match(problems((m) => (m.sources[0].type = 'ftp')), /type must be/);
    assert.match(problems((m) => (m.sources = [])), /non-empty/);
  });
});

describe('urls', () => {
  const manifest = valid();

  it('builds raw URLs for this repo', () => {
    assert.equal(
      rawUrl(manifest, 'sources/gh.json'),
      'https://raw.githubusercontent.com/zKevinLy/aiostore/main/sources/gh.json',
    );
  });

  it('uses the external URL as-is and ours for generated sources', () => {
    assert.equal(sourceUrl(manifest, manifest.sources[0]), 'https://example.com/source.json');
    assert.match(sourceUrl(manifest, manifest.sources[1]), /\/main\/sources\/gh\.json$/);
  });
});
