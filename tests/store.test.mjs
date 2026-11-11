import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildSource,
  buildVersions,
  compareVersions,
  sourceIdentifier,
  versionFromTag,
} from '../scripts/lib/store.mjs';
import { manifest, release, releases, repoInfo, sha, v117, ytkaceSource } from './fixtures.mjs';

describe('versionFromTag', () => {
  it('strips a leading v', () => {
    assert.equal(versionFromTag('v1.1.7'), '1.1.7');
    assert.equal(versionFromTag('V2.0'), '2.0');
    assert.equal(versionFromTag('1.0.0'), '1.0.0');
  });

  it('uses the capture group of a custom pattern', () => {
    assert.equal(versionFromTag('release-3.4', '^release-(.+)$'), '3.4');
    assert.equal(versionFromTag('nightly', '^release-(.+)$'), null);
  });
});

describe('compareVersions', () => {
  it('compares numerically, not as text', () => {
    assert.ok(compareVersions('17.0', '16.4.1') > 0);
    assert.ok(compareVersions('9', '10') < 0);
    assert.equal(compareVersions('16', '16.0.0'), 0);
  });

  it('treats a missing value as 0', () => {
    assert.ok(compareVersions('16.0', undefined) > 0);
    assert.equal(compareVersions(undefined, undefined), 0);
  });
});

describe('buildVersions', () => {
  const versions = buildVersions(releases, ytkaceSource);

  it('makes one entry per matching IPA and ignores .deb files', () => {
    assert.equal(versions.length, 3);
    for (const v of versions) assert.match(v.downloadURL, /\.ipa$/);
  });

  it('skips drafts and (by default) pre-releases', () => {
    assert.deepEqual([...new Set(versions.map((v) => v.version))], ['1.1.7', '1.1.6']);
  });

  it('can include pre-releases', () => {
    const all = buildVersions(releases, { ...ytkaceSource, includePrereleases: true });
    assert.equal(all[0].version, '1.1.8-beta');
  });

  it('sorts newest release first, and the newest-iOS build first within a release', () => {
    assert.deepEqual(
      versions.map((v) => [v.version, v.minOSVersion]),
      [
        ['1.1.7', '17.0'],
        ['1.1.7', '16.0'],
        ['1.1.6', '17.0'],
      ],
    );
  });

  it('gives each IPA its own url, size, sha256 and minOSVersion', () => {
    const [ios17, ios16] = versions;
    assert.equal(
      ios17.downloadURL,
      'https://github.com/itzzace/ytkace/releases/download/v1.1.7/YTKACE_1.1.7_YouTube_21.45.4.ipa',
    );
    assert.equal(ios17.size, 160_000_000);
    assert.equal(ios17.sha256, sha('b'));
    assert.equal(ios16.sha256, sha('a'));
    assert.match(ios16.downloadURL, /iOS16_21\.33\.6\.ipa$/);
  });

  it('leaves sha256 out when GitHub has no digest', () => {
    assert.equal('sha256' in versions[2], false);
  });

  it('uses the release date and normalised release notes', () => {
    assert.equal(versions[0].date, '2026-11-10T21:54:00Z');
    assert.equal(versions[0].localizedDescription, 'Notes for v1.1.7\n\n• Something new');
  });

  it('applies the first matching rule only', () => {
    const rules = [
      { match: 'iOS16', minOSVersion: '16.0' },
      { match: '\\.ipa$', minOSVersion: '99.0' },
    ];
    const out = buildVersions([v117], { ...ytkaceSource, assets: rules });
    assert.deepEqual(out.map((v) => v.minOSVersion).sort(), ['16.0', '99.0']);
  });

  it('takes every .ipa when no rules are given', () => {
    const { assets: _unused, ...plain } = ytkaceSource;
    assert.equal(buildVersions([v117], plain).length, 2);
  });

  it('keeps at most maxReleases releases (not entries)', () => {
    const out = buildVersions(releases, { ...ytkaceSource, maxReleases: 1 });
    assert.equal(out.length, 2);
    assert.ok(out.every((v) => v.version === '1.1.7'));
  });

  it('sets buildVersion only for rules that ask for it', () => {
    const rules = [{ match: 'iOS16', buildVersion: 'ios16' }, { match: '21\\.45' }];
    const out = buildVersions([v117], { ...ytkaceSource, assets: rules });
    assert.equal(out.find((v) => /iOS16/.test(v.downloadURL)).buildVersion, 'ios16');
    assert.equal('buildVersion' in out.find((v) => /21\.45/.test(v.downloadURL)), false);
  });

  it('ignores assets that are not fully uploaded', () => {
    const partial = release('v2.0.0', '2026-12-01T00:00:00Z', [
      { name: 'App.ipa', state: 'starter', size: 1, browser_download_url: 'https://x/App.ipa' },
    ]);
    assert.deepEqual(buildVersions([partial], { ...ytkaceSource, assets: undefined }), []);
  });

  it('skips releases whose tag does not match tagPattern', () => {
    const out = buildVersions(releases, { ...ytkaceSource, tagPattern: '^release-(.+)$' });
    assert.deepEqual(out, []);
  });

  it('caps very long release notes', () => {
    const long = release('v3.0.0', '2026-12-02T00:00:00Z', v117.assets, { body: 'x'.repeat(9000) });
    const [first] = buildVersions([long], ytkaceSource);
    assert.ok(first.localizedDescription.length <= 4000);
    assert.ok(first.localizedDescription.endsWith('…'));
  });
});

describe('buildSource', () => {
  const source = buildSource(manifest, ytkaceSource, repoInfo, releases);
  const [app] = source.apps;

  it('names the source and gives it a stable identifier', () => {
    assert.equal(source.name, 'YTKACE');
    assert.equal(source.identifier, 'io.github.zkevinly.aiostore.ytkace');
    assert.equal(sourceIdentifier(manifest, ytkaceSource), source.identifier);
  });

  it('describes the app from the config, falling back to the repo', () => {
    assert.equal(app.bundleIdentifier, 'com.google.ios.youtube');
    assert.equal(app.developerName, 'itzzace');
    assert.equal(app.localizedDescription, repoInfo.description);
    assert.equal(app.iconURL, repoInfo.owner.avatar_url);
    assert.equal(source.website, 'https://github.com/itzzace/ytkace');
  });

  it('prefers values from the config', () => {
    const custom = {
      ...ytkaceSource,
      homepage: 'https://example.com',
      app: {
        ...ytkaceSource.app,
        iconURL: 'https://example.com/icon.png',
        localizedDescription: 'Mine',
        tintColor: 'FF0000',
        category: 'entertainment',
      },
    };
    const out = buildSource(manifest, custom, repoInfo, releases);
    assert.equal(out.website, 'https://example.com');
    assert.equal(out.apps[0].iconURL, 'https://example.com/icon.png');
    assert.equal(out.apps[0].localizedDescription, 'Mine');
    assert.equal(out.tintColor, 'FF0000');
    assert.equal(out.apps[0].category, 'entertainment');
  });

  it('works without repo info', () => {
    const out = buildSource(manifest, ytkaceSource, undefined, releases);
    assert.equal(out.apps[0].iconURL, 'https://github.com/itzzace.png');
    assert.equal(out.apps[0].localizedDescription, ytkaceSource.description);
  });

  it('fails loudly instead of publishing an app with no versions', () => {
    const wrong = { ...ytkaceSource, assets: [{ match: '\\.apk$' }] };
    assert.throws(() => buildSource(manifest, wrong, repoInfo, releases), /itzzace\/ytkace/);
  });

  it('is deterministic (no timestamps), so reruns leave git clean', () => {
    const again = buildSource(manifest, ytkaceSource, repoInfo, [...releases].reverse());
    assert.deepEqual(again, source);
  });
});
