# AIO Store

One master list of [Store](https://Store.io) sources, merged into a single source you add once.

Some sources come straight from the app's developers. For apps that only publish `.ipa` files on GitHub
releases, this repo **generates** a source automatically and keeps it up to date.

Everything is plain JSON served from this repo. No servers, no Workers.

## Add everything at once

In Store open **Sources → +** and paste:

```
https://raw.githubusercontent.com/zKevinLy/aiostore/main/store.json
```

[`store.json`](store.json) holds every app from every source below. It is rebuilt for you; never edit it.
If two sources ship the same bundle ID, the one listed first in `sources.json` wins.

To keep it small, each app keeps only its newest **3 versions** (a release with an iOS 16 and an iOS 17
build counts as one). Change `maxVersions` at the top of `sources.json`, or add it to one source to
override it for that source. The files in `sources/` keep the full history.

## Sources

Prefer to add them one by one? Copy a URL, then in Store open **Sources → +** and paste it.

<!-- sources:start -->
| Source | About | Kind | Source URL |
| --- | --- | --- | --- |
| [Taurus](https://github.com/samj-exe/taurus) | Open-source Spotify client with built-in Premium, maintained by the Taurus project. | External | `https://raw.githubusercontent.com/samj-exe/taurus/refs/heads/stable/altstore-source.json` |
| [Nuvio](https://github.com/NuvioMedia/NuvioMobile) | Free, open-source media app. Official iOS builds, published by the Nuvio developers. | External | `https://raw.githubusercontent.com/NuvioMedia/NuvioMobile/refs/heads/cmp-rewrite/store.json` |
| [YTKACE](https://github.com/itzzace/ytkace) | YouTube enhancer for iOS with SponsorBlock, background playback and downloads. Generated from GitHub releases. | Generated | `https://raw.githubusercontent.com/zKevinLy/aiostore/main/sources/ytkace.json` |
<!-- sources:end -->

Prefer a URL that only changes when a release is cut? Every release also attaches the files, e.g.
`https://github.com/zKevinLy/aiostore/releases/latest/download/ytkace.json`.

## Add a source

Everything lives in [`sources.json`](sources.json). Add an entry, push to `main`, and the rest follows:
the table above, `store.json` and every source snapshot are rebuilt for you.

### An existing source (the developer already publishes one)

```json
{
  "id": "nuvio",
  "type": "external",
  "name": "Nuvio",
  "description": "Free, open-source media app.",
  "homepage": "https://github.com/NuvioMedia/NuvioMobile",
  "url": "https://raw.githubusercontent.com/NuvioMedia/NuvioMobile/refs/heads/cmp-rewrite/store.json"
}
```

### A GitHub repo that attaches IPAs to its releases

The smallest working entry takes every `.ipa` from the 10 newest releases:

```json
{
  "id": "myapp",
  "type": "github",
  "name": "My App",
  "description": "What it does, in one line.",
  "repo": "owner/myapp",
  "app": { "name": "My App", "bundleIdentifier": "com.example.myapp" }
}
```

Then run the **Update sources** workflow (or wait for the schedule) to create `sources/myapp.json` and add it to `store.json`.

| Key                  | Where  | Meaning                                                                                  |
| -------------------- | ------ | ---------------------------------------------------------------------------------------- |
| `app.bundleIdentifier` | `app`  | **Required, and must match the IPA's real bundle ID** or Store will refuse to update. |
| `app.developerName`  | `app`  | Defaults to the repo owner.                                                              |
| `app.iconURL`        | `app`  | Defaults to the repo owner's GitHub avatar.                                              |
| `app.subtitle`, `app.localizedDescription`, `app.tintColor`, `app.category`, `app.screenshots` | `app` | Optional. Description defaults to the repo's description. |
| `assets`             | entry  | Which release files to use. A list of `{ "match", "minOSVersion"?, "buildVersion"? }`. `match` is a regex on the file name; the **first** rule that fits wins, so put specific ones first. Default: every `.ipa`. |
| `tagPattern`         | entry  | Regex with one capture group that pulls the version out of the tag. Default `^[vV]?(.+)$` (`v1.2.3` → `1.2.3`). |
| `maxReleases`        | entry  | How many releases to keep (1–50, default 10).                                            |
| `includePrereleases` | entry  | Default `false`.                                                                         |

A release that ships several IPAs gets one version entry per IPA. [YTKACE](https://github.com/itzzace/ytkace)
publishes an iOS 16 build and an iOS 17+ build side by side, so it uses two rules and Store picks the newest
one each device can run:

```json
"assets": [
  { "match": "^YTKACE_.+_YouTube_iOS16_.+\\.ipa$", "minOSVersion": "16.0" },
  { "match": "^YTKACE_.+_YouTube_[0-9.]+\\.ipa$", "minOSVersion": "17.0" }
]
```

If no release matches your rules, the build fails with a message instead of publishing an empty source, and the
last good file is left alone.

## How it works

| Workflow                                              | When                                         | What it does                                                                 |
| ----------------------------------------------------- | -------------------------------------------- | ---------------------------------------------------------------------------- |
| [CI](.github/workflows/ci.yml)                        | Every push and PR                            | Runs the tests and `validate`. On `main`, cuts a release.                    |
| [Update sources](.github/workflows/update.yml)        | Every 6 hours, on demand, when `sources.json` changes | Regenerates every `github` source, re-mirrors every `external` one into `sources/`, rebuilds `store.json`, commits changes, cuts a release. |
| [Release](.github/workflows/release.yml)              | Called by the two above                      | Tags the next `vX.Y.Z` and attaches every JSON file plus a zip to a GitHub Release. |

Versions follow [Conventional Commits](https://www.conventionalcommits.org): `feat:` bumps the minor,
`feat!:` the major, anything else the patch.

## Develop

Needs Node 22+. There are no dependencies to install.

```sh
npm test                       # unit tests
npm run validate               # checks sources.json, sources/, store.json and the table above
npm run build:offline          # rebuild store.json and the table from sources/ (no network)
GITHUB_TOKEN=... npm run build # regenerate everything from GitHub
npm run build -- --only ytkace # just one source
```

`GITHUB_TOKEN` is optional locally; without it GitHub allows 60 requests an hour.

If `main` is protected, allow `github-actions[bot]` to push to it, since *Update sources* commits there.

## Notes

- Apps listed here belong to their authors; this repo only links to and lists their releases. Only install
  software you have the right to use.
- `sources.json` is the only file you edit. `sources/`, `store.json` and the table above are generated.
- `sources/<id>.json` for an `external` entry is a copy of the developer's file, kept so `store.json` still
  builds when their URL is down.

## License

[MIT](LICENSE)
