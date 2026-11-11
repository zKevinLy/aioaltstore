import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildStore, limitVersions, storeIdentifier } from '../scripts/lib/aggregate.mjs';

const manifest = { name: 'AIOStore', repository: 'zKevinLy/aiostore', branch: 'main' };
const snap = (id, apps, news) => ({ source: { id }, json: { apps, news } });
const app = (bundleIdentifier, name = bundleIdentifier) => ({ name, bundleIdentifier, versions: [] });

describe('buildStore', () => {
  it('concatenates apps in order and names the store from sources.json', () => {
    const { store, conflicts } = buildStore(manifest, [
      snap('a', [app('com.a')]),
      snap('b', [app('com.b1'), app('com.b2')]),
    ]);
    assert.deepEqual(store.apps.map((x) => x.bundleIdentifier), ['com.a', 'com.b1', 'com.b2']);
    assert.equal(store.name, 'AIOStore');
    assert.equal(store.identifier, storeIdentifier(manifest));
    assert.deepEqual(conflicts, []);
  });

  it('keeps the first app when two sources share a bundle identifier', () => {
    const { store, conflicts } = buildStore(manifest, [
      snap('a', [app('com.same', 'first')]),
      snap('b', [app('com.same', 'second')]),
    ]);
    assert.deepEqual(store.apps.map((x) => x.name), ['first']);
    assert.match(conflicts[0], /com\.same.*"a".*"b"/);
  });

  it('merges news without repeating an item', () => {
    const item = { identifier: 'n1', title: 'Hi' };
    const { store } = buildStore(manifest, [snap('a', [app('com.a')], [item]), snap('b', [app('com.b')], [item])]);
    assert.equal(store.news.length, 1);
  });

  it('copes with no snapshots at all', () => {
    assert.deepEqual(buildStore(manifest, []).store.apps, []);
  });
});

const v = (version, date, extra = {}) => ({ version, date, ...extra });

describe('limitVersions', () => {
  const app = { name: 'A', versions: [v('1.0', '2026-01-01'), v('1.3', '2026-04-01'), v('1.2', '2026-03-01'), v('1.1', '2026-02-01')] };

  it('keeps the newest N versions, newest first, whatever the input order', () => {
    assert.deepEqual(limitVersions(app, 3).versions.map((x) => x.version), ['1.3', '1.2', '1.1']);
  });

  it('counts a release with two builds as one version', () => {
    const two = { versions: [v('2.0', '2026-05-01', { minOSVersion: '16.0' }), v('2.0', '2026-05-01', { minOSVersion: '17.0' }), v('1.9', '2026-04-01'), v('1.8', '2026-03-01')] };
    const kept = limitVersions(two, 2).versions;
    assert.deepEqual(kept.map((x) => x.version), ['2.0', '2.0', '1.9']);
  });

  it('does not change the original or touch apps without a versions list', () => {
    limitVersions(app, 1);
    assert.equal(app.versions.length, 4);
    const old = { name: 'Old', version: '1.0' };
    assert.equal(limitVersions(old, 3), old);
  });
});

describe('buildStore version limit', () => {
  const many = (id) => snap(id, [{ ...app(`com.${id}`), versions: ['1', '2', '3', '4', '5'].map((n) => v(n, `2026-0${n}-01`)) }]);

  it('defaults to 3, honours sources.json, and lets a source override it', () => {
    const count = (m, s) => buildStore(m, s).store.apps[0].versions.length;
    assert.equal(count(manifest, [many('a')]), 3);
    assert.equal(count({ ...manifest, maxVersions: 2 }, [many('a')]), 2);
    const overridden = { source: { id: 'a', maxVersions: 1 }, json: many('a').json };
    assert.equal(count({ ...manifest, maxVersions: 2 }, [overridden]), 1);
  });
});
