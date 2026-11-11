import { afterEach, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { copyFile, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from '../scripts/build.mjs';
import { validate } from '../scripts/validate.mjs';
import { applyTable, renderTable } from '../scripts/lib/render.mjs';
import { loadManifest } from '../scripts/lib/manifest.mjs';
import { releases, repoInfo } from './fixtures.mjs';

/** A fetch that serves one tiny external source per URL (or fails). */
function fakeFetch({ fail = false } = {}) {
  const calls = [];
  const impl = async (url) => {
    calls.push(url);
    if (fail) return { ok: false, status: 503 };
    const id = url.includes('taurus') ? 'taurus' : 'nuvio';
    return {
      ok: true,
      json: async () => ({
        name: id,
        apps: [{ name: id, bundleIdentifier: `com.example.${id}`, versions: [{ version: '1.0' }] }],
      }),
    };
  };
  impl.calls = calls;
  return impl;
}

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** A GitHub client that answers from fixtures and counts calls. */
function fakeGitHub({ fail = false } = {}) {
  const calls = [];
  return {
    calls,
    getRepo: async (repo) => {
      calls.push(['repo', repo]);
      if (fail) throw new Error('GitHub 500');
      return repoInfo;
    },
    getReleases: async (repo) => {
      calls.push(['releases', repo]);
      if (fail) throw new Error('GitHub 500');
      return releases;
    },
  };
}

let root;
const quiet = () => {};

beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), 'aiostore-'));
  await copyFile(path.join(REPO_ROOT, 'sources.json'), path.join(root, 'sources.json'));
  await copyFile(path.join(REPO_ROOT, 'README.md'), path.join(root, 'README.md'));
});

afterEach(() => rm(root, { recursive: true, force: true }));

const read = (file) => readFile(path.join(root, file), 'utf8');

describe('build', () => {
  it('generates a source for every github entry, and only those', async () => {
    const github = fakeGitHub();
    const result = await build({ root, github, fetchImpl: fakeFetch(), log: quiet });

    assert.deepEqual(result.failed, []);
    assert.ok(result.written.includes('ytkace'));
    assert.deepEqual(github.calls, [
      ['repo', 'itzzace/ytkace'],
      ['releases', 'itzzace/ytkace'],
    ]);

    const source = JSON.parse(await read('sources/ytkace.json'));
    assert.equal(source.apps[0].bundleIdentifier, 'com.google.ios.youtube');
    // sources.json only has the iOS 17+ rule for YTKACE, so v1.1.7 and v1.1.6 give one entry each.
    assert.equal(source.apps[0].versions.length, 2);
    assert.ok(source.apps[0].versions.every((v) => v.minOSVersion === '17.0'));
  });

  it('mirrors external sources and merges every app into store.json', async () => {
    const fetchImpl = fakeFetch();
    await build({ root, github: fakeGitHub(), fetchImpl, log: quiet });
    assert.equal(fetchImpl.calls.length, 2);
    assert.equal(JSON.parse(await read('sources/taurus.json')).apps[0].name, 'taurus');

    const store = JSON.parse(await read('store.json'));
    assert.equal(store.name, 'AIOStore');
    assert.deepEqual(
      store.apps.map((app) => app.name),
      ['taurus', 'nuvio', 'YTKACE'],
    );
    assert.equal(
      store.sourceURL,
      'https://raw.githubusercontent.com/zKevinLy/aiostore/main/store.json',
    );
  });

  it('keeps an external source\'s last good mirror when its URL fails', async () => {
    await build({ root, github: fakeGitHub(), fetchImpl: fakeFetch(), log: quiet });
    const before = await read('store.json');

    const result = await build({ root, github: fakeGitHub(), fetchImpl: fakeFetch({ fail: true }), log: quiet });
    assert.deepEqual(result.failed.map((f) => f.id), ['taurus', 'nuvio']);
    assert.equal(await read('store.json'), before);
  });

  it('is idempotent: a second run changes nothing', async () => {
    await build({ root, github: fakeGitHub(), fetchImpl: fakeFetch(), log: quiet });
    const second = await build({ root, github: fakeGitHub(), fetchImpl: fakeFetch(), log: quiet });
    assert.deepEqual(second.written, []);
    assert.ok(second.unchanged.includes('ytkace'));
  });

  it('--offline never touches the network', async () => {
    const github = fakeGitHub();
    const fetchImpl = fakeFetch();
    await build({ root, github, fetchImpl, offline: true, log: quiet });
    assert.deepEqual(github.calls, []);
    assert.deepEqual(fetchImpl.calls, []);
  });

  it('--only limits generation to one source, and rejects an unknown id', async () => {
    const github = fakeGitHub();
    await build({ root, github, fetchImpl: fakeFetch(), only: 'ytkace', log: quiet });
    assert.equal(github.calls.length, 2);
    await assert.rejects(build({ root, github, only: 'nope', log: quiet }), /No source with id/);
  });

  it('reports a failing source but keeps its last good file and carries on', async () => {
    await build({ root, github: fakeGitHub(), fetchImpl: fakeFetch(), log: quiet });
    const before = await read('sources/ytkace.json');

    const result = await build({ root, github: fakeGitHub({ fail: true }), fetchImpl: fakeFetch(), log: quiet });
    assert.equal(result.failed.length, 1);
    assert.equal(result.failed[0].id, 'ytkace');
    assert.match(result.failed[0].error, /GitHub 500/);
    assert.equal(await read('sources/ytkace.json'), before);
  });

  it('refuses to write a source when no release has a matching IPA', async () => {
    const empty = { ...fakeGitHub(), getReleases: async () => [] };
    const result = await build({ root, github: empty, fetchImpl: fakeFetch(), log: quiet });
    assert.match(result.failed[0].error, /matching/);
    await assert.rejects(read('sources/ytkace.json'), { code: 'ENOENT' });
  });

  it('keeps the README table in sync', async () => {
    await build({ root, github: fakeGitHub(), fetchImpl: fakeFetch(), log: quiet });
    const readme = await read('README.md');
    const manifest = await loadManifest(root);
    assert.ok(readme.includes(renderTable(manifest)));
  });
});

describe('applyTable', () => {
  it('replaces only what is between the markers', () => {
    const out = applyTable('before\n<!-- sources:start -->\nold\n<!-- sources:end -->\nafter', 'NEW');
    assert.equal(out, 'before\n<!-- sources:start -->\nNEW\n<!-- sources:end -->\nafter');
  });

  it('throws when the markers are gone', () => {
    assert.throws(() => applyTable('no markers', 'x'), /markers/);
  });
});

describe('validate', () => {
  it('passes after a build', async () => {
    await build({ root, github: fakeGitHub(), fetchImpl: fakeFetch(), log: quiet });
    const { errors, warnings } = await validate(root);
    assert.deepEqual(errors, []);
    assert.deepEqual(warnings, []);
  });

  it('only warns when a source has not been built yet', async () => {
    await build({ root, github: fakeGitHub(), offline: true, log: quiet });
    const { errors, warnings } = await validate(root);
    assert.deepEqual(errors, []);
    assert.match(warnings.join(), /sources\/ytkace\.json doesn't exist yet/);
  });

  it('catches a stale store.json', async () => {
    await build({ root, github: fakeGitHub(), fetchImpl: fakeFetch(), log: quiet });
    await writeFile(path.join(root, 'store.json'), '{}\n');
    const { errors } = await validate(root);
    assert.match(errors.join(), /store\.json is out of date/);
  });

  it('catches a stale README table', async () => {
    await build({ root, github: fakeGitHub(), fetchImpl: fakeFetch(), log: quiet });
    const readme = (await read('README.md')).replace('YTKACE', 'Renamed');
    await writeFile(path.join(root, 'README.md'), readme);
    const { errors } = await validate(root);
    assert.match(errors.join(), /README\.md source table is out of date/);
  });

  it('catches a broken generated source', async () => {
    await build({ root, github: fakeGitHub(), fetchImpl: fakeFetch(), log: quiet });
    const file = path.join(root, 'sources/ytkace.json');
    const json = JSON.parse(await readFile(file, 'utf8'));
    json.apps[0].versions[0].downloadURL = 'http://insecure.example/app.ipa';
    json.apps[0].bundleIdentifier = 'com.other.app';
    await writeFile(file, JSON.stringify(json));
    const { errors } = await validate(root);
    assert.match(errors.join('\n'), /downloadURL must be https/);
    assert.match(errors.join('\n'), /bundleIdentifier differs/);
  });

  it('catches a leftover file for a removed source', async () => {
    await build({ root, github: fakeGitHub(), fetchImpl: fakeFetch(), log: quiet });
    await writeFile(path.join(root, 'sources/old.json'), '{}');
    const { errors } = await validate(root);
    assert.match(errors.join(), /sources\/old\.json has no matching/);
  });
});

describe('the committed repo', () => {
  it('passes validation as it stands', async () => {
    const { errors } = await validate(REPO_ROOT);
    assert.deepEqual(errors, []);
  });
});
