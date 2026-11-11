// Turns a GitHub repo's releases into an Store / Store source (the v2 format,
// with a `versions` array). Pure functions: no network, no file access.

export const DEFAULT_TAG_PATTERN = '^[vV]?(.+)$';
export const DEFAULT_ASSETS = [{ match: '\\.ipa$' }];
export const DEFAULT_MAX_RELEASES = 10;
const MAX_NOTES = 4000;

/** "v1.1.7" -> "1.1.7". Returns null when the tag doesn't match the pattern. */
export function versionFromTag(tag, pattern = DEFAULT_TAG_PATTERN) {
  const match = new RegExp(pattern).exec(tag ?? '');
  return match?.[1] ? match[1] : null;
}

/** Numeric dotted-version compare: "17.0" > "16.4.1". Missing parts count as 0. */
export function compareVersions(a = '0', b = '0') {
  const left = a.split('.').map(Number);
  const right = b.split('.').map(Number);
  for (let i = 0; i < Math.max(left.length, right.length); i++) {
    const diff = (left[i] ?? 0) - (right[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

function cleanNotes(body) {
  const text = (body ?? '').replace(/\r\n?/g, '\n').trim();
  if (!text) return undefined;
  return text.length > MAX_NOTES ? `${text.slice(0, MAX_NOTES - 1).trimEnd()}…` : text;
}

/** "sha256:abc…" (GitHub's asset digest) -> "abc…". Undefined for anything else. */
function sha256Of(digest) {
  return /^sha256:([0-9a-f]{64})$/i.exec(digest ?? '')?.[1]?.toLowerCase();
}

/** The first rule whose `match` fits the file name wins, so put specific rules first. */
function ruleFor(assetName, rules) {
  return rules.find((rule) => new RegExp(rule.match).test(assetName));
}

/**
 * One version entry per matching IPA. A release that ships several IPAs (say an iOS 16
 * build and an iOS 17+ build) gives several entries; Store picks the newest one the
 * device's iOS can run, using `minOSVersion`.
 */
export function buildVersions(releases, source) {
  const rules = source.assets ?? DEFAULT_ASSETS;
  const max = source.maxReleases ?? DEFAULT_MAX_RELEASES;

  const usable = releases
    .filter((release) => !release.draft)
    .filter((release) => source.includePrereleases || !release.prerelease)
    .map((release) => ({ release, version: versionFromTag(release.tag_name, source.tagPattern) }))
    .filter(({ version }) => version !== null)
    .map((entry) => ({ ...entry, date: entry.release.published_at ?? entry.release.created_at }))
    .filter(({ date }) => date)
    .sort((a, b) => Date.parse(b.date) - Date.parse(a.date));

  const versions = [];
  let kept = 0;

  for (const { release, version, date } of usable) {
    if (kept >= max) break;

    const entries = (release.assets ?? [])
      .filter((asset) => asset.state === undefined || asset.state === 'uploaded')
      .map((asset) => ({ asset, rule: ruleFor(asset.name, rules) }))
      .filter(({ rule }) => rule)
      .map(({ asset, rule }) => ({
        version,
        ...(rule.buildVersion ? { buildVersion: rule.buildVersion } : {}),
        date,
        ...(cleanNotes(release.body) ? { localizedDescription: cleanNotes(release.body) } : {}),
        downloadURL: asset.browser_download_url,
        size: asset.size,
        ...(sha256Of(asset.digest) ? { sha256: sha256Of(asset.digest) } : {}),
        ...(rule.minOSVersion ? { minOSVersion: rule.minOSVersion } : {}),
        _name: asset.name,
      }))
      // Same release: the build for the newest iOS first, then by file name for a stable order.
      .sort(
        (a, b) =>
          compareVersions(b.minOSVersion, a.minOSVersion) || a._name.localeCompare(b._name),
      );

    if (entries.length === 0) continue;
    kept += 1;
    versions.push(...entries.map(({ _name, ...entry }) => entry));
  }

  return versions;
}

/** The reverse-DNS id of a generated source, e.g. io.github.zkevinly.aiostore.ytkace. */
export function sourceIdentifier(manifest, source) {
  const [owner, name] = manifest.repository.toLowerCase().split('/');
  return `io.github.${owner}.${name}.${source.id}`;
}

/**
 * The whole Store source for one `github` entry of sources.json.
 * `repoInfo` is GET /repos/{repo}; `releases` is GET /repos/{repo}/releases.
 */
export function buildSource(manifest, source, repoInfo, releases) {
  const versions = buildVersions(releases, source);
  if (versions.length === 0) {
    throw new Error(
      `no release of ${source.repo} has an IPA matching the "assets" rules; ` +
        'check the patterns in sources.json against the real file names',
    );
  }

  const [owner] = source.repo.split('/');
  const app = source.app;
  const iconURL = app.iconURL ?? repoInfo?.owner?.avatar_url ?? `https://github.com/${owner}.png`;
  const about = repoInfo?.description || source.description;

  return {
    name: source.name,
    identifier: sourceIdentifier(manifest, source),
    subtitle: source.description,
    iconURL,
    website: source.homepage ?? repoInfo?.html_url ?? `https://github.com/${source.repo}`,
    ...(app.tintColor ? { tintColor: app.tintColor } : {}),
    apps: [
      {
        name: app.name,
        bundleIdentifier: app.bundleIdentifier,
        developerName: app.developerName ?? owner,
        subtitle: app.subtitle ?? source.description,
        localizedDescription: app.localizedDescription ?? about,
        iconURL,
        ...(app.tintColor ? { tintColor: app.tintColor } : {}),
        ...(app.category ? { category: app.category } : {}),
        ...(app.screenshots ? { screenshots: app.screenshots } : {}),
        versions,
        appPermissions: { entitlements: [], privacy: {} },
      },
    ],
    news: [],
  };
}
