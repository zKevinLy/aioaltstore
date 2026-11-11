// Shapes copied from GitHub's REST API (GET /repos/{repo}/releases). Sizes and digests are
// made up; the IPA file names and URLs follow the real itzzace/ytkace release v1.1.7.

export const manifest = { repository: 'zKevinLy/aio-altstore', branch: 'main' };

export const ytkaceSource = {
  id: 'ytkace',
  type: 'github',
  name: 'YTKACE',
  description: 'YouTube enhancer for iOS.',
  repo: 'itzzace/ytkace',
  app: { name: 'YTKACE', bundleIdentifier: 'com.google.ios.youtube', developerName: 'itzzace' },
  assets: [
    { match: '^YTKACE_.+_YouTube_iOS16_.+\\.ipa$', minOSVersion: '16.0' },
    { match: '^YTKACE_.+_YouTube_[0-9.]+\\.ipa$', minOSVersion: '17.0' },
  ],
};

export const repoInfo = {
  description: 'YTKACE is a free, open-source YouTube enhancer for iOS.',
  html_url: 'https://github.com/itzzace/ytkace',
  owner: { avatar_url: 'https://avatars.githubusercontent.com/u/318309682?v=4' },
};

const asset = (tag, name, size, digest) => ({
  name,
  state: 'uploaded',
  size,
  digest,
  browser_download_url: `https://github.com/itzzace/ytkace/releases/download/${tag}/${name}`,
});

export const sha = (char) => char.repeat(64);

export function release(tag, published, assets, extra = {}) {
  return {
    tag_name: tag,
    draft: false,
    prerelease: false,
    published_at: published,
    created_at: published,
    body: `Notes for ${tag}\r\n\r\n• Something new`,
    assets,
    ...extra,
  };
}

export const v117 = release('v1.1.7', '2026-11-10T21:54:00Z', [
  asset('v1.1.7', 'YTKACE_1.1.7_YouTube_iOS16_21.33.6.ipa', 150_000_000, `sha256:${sha('a')}`),
  asset('v1.1.7', 'YTKACE_1.1.7_YouTube_21.45.4.ipa', 160_000_000, `sha256:${sha('b')}`),
  asset('v1.1.7', 'com.example.ytkace_1.1.7_iphoneos-arm64.deb', 5_000_000, null),
  asset('v1.1.7', 'com.example.ytkace_1.1.7_iphoneos-arm.deb', 5_000_000, null),
]);

export const v116 = release('v1.1.6', '2026-10-20T10:00:00Z', [
  asset('v1.1.6', 'YTKACE_1.1.6_YouTube_21.42.4.ipa', 158_000_000, null),
]);

export const v118Beta = release(
  'v1.1.8-beta',
  '2026-11-12T10:00:00Z',
  [asset('v1.1.8-beta', 'YTKACE_1.1.8_YouTube_21.46.0.ipa', 1, null)],
  { prerelease: true },
);

export const v119Draft = release(
  'v1.1.9',
  '2026-11-13T10:00:00Z',
  [asset('v1.1.9', 'YTKACE_1.1.9_YouTube_21.46.0.ipa', 1, null)],
  { draft: true },
);

// GitHub lists newest first, but the generator must not depend on that.
export const releases = [v116, v119Draft, v117, v118Beta];
