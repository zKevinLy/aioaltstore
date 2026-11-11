// Loads and validates sources.json, the one master list. Everything else (mirrored and
// generated sources, store.json, the README table) is derived from it.

import { readFile } from 'node:fs/promises';
import path from 'node:path';

const ID = /^[a-z0-9][a-z0-9-]*$/;
const REPO = /^[\w.-]+\/[\w.-]+$/;
const BUNDLE_ID = /^[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+$/;
const OS_VERSION = /^\d+(\.\d+){0,2}$/;

const isCount = (value) => Number.isInteger(value) && value >= 1 && value <= 50;
const isString = (value) => typeof value === 'string' && value.trim() !== '';

function isHttps(value) {
  try {
    return new URL(value).protocol === 'https:';
  } catch {
    return false;
  }
}

/** Returns the regex's error message, or null when it compiles. */
function regexError(source) {
  try {
    new RegExp(source);
    return null;
  } catch (error) {
    return error.message;
  }
}

function validateAssetRule(rule, where, errors) {
  if (!rule || typeof rule !== 'object') return errors.push(`${where} must be an object`);
  if (!isString(rule.match)) return errors.push(`${where}.match must be a regex string`);

  const problem = regexError(rule.match);
  if (problem) errors.push(`${where}.match is not a valid regex: ${problem}`);

  if (rule.minOSVersion !== undefined && !OS_VERSION.test(rule.minOSVersion ?? '')) {
    errors.push(`${where}.minOSVersion must look like "16.0"`);
  }
  if (rule.buildVersion !== undefined && !isString(rule.buildVersion)) {
    errors.push(`${where}.buildVersion must be a non-empty string`);
  }
}

function validateGithubSource(source, where, errors) {
  if (!REPO.test(source.repo ?? '')) errors.push(`${where}.repo must be "owner/name"`);

  const app = source.app;
  if (!app || typeof app !== 'object') {
    errors.push(`${where}.app is required`);
  } else {
    if (!isString(app.name)) errors.push(`${where}.app.name is required`);
    if (!BUNDLE_ID.test(app.bundleIdentifier ?? '')) {
      errors.push(`${where}.app.bundleIdentifier must look like "com.example.app"`);
    }
    if (app.iconURL !== undefined && !isHttps(app.iconURL)) {
      errors.push(`${where}.app.iconURL must be an https URL`);
    }
  }

  if (source.assets !== undefined) {
    if (!Array.isArray(source.assets) || source.assets.length === 0) {
      errors.push(`${where}.assets must be a non-empty array (or leave it out to take every .ipa)`);
    } else {
      source.assets.forEach((rule, i) => validateAssetRule(rule, `${where}.assets[${i}]`, errors));
    }
  }

  if (source.tagPattern !== undefined) {
    const problem = isString(source.tagPattern) ? regexError(source.tagPattern) : 'not a string';
    if (problem) errors.push(`${where}.tagPattern is not a valid regex: ${problem}`);
    // Appending an empty alternative makes exec('') succeed, so its length reveals the groups.
    else if (new RegExp(`${source.tagPattern}|`).exec('').length < 2) {
      errors.push(`${where}.tagPattern needs a capture group around the version`);
    }
  }

  const max = source.maxReleases;
  if (max !== undefined && !(Number.isInteger(max) && max >= 1 && max <= 50)) {
    errors.push(`${where}.maxReleases must be a whole number from 1 to 50`);
  }
  if (source.includePrereleases !== undefined && typeof source.includePrereleases !== 'boolean') {
    errors.push(`${where}.includePrereleases must be true or false`);
  }
}

/** Every problem with the manifest, as readable strings (empty = valid). */
export function validateManifest(manifest) {
  const errors = [];

  if (!manifest || typeof manifest !== 'object') return ['sources.json must be an object'];
  if (!REPO.test(manifest.repository ?? '')) errors.push('repository must be "owner/name"');
  if (!isString(manifest.name)) errors.push('name is required (shown as the store\'s name)');
  if (manifest.maxVersions !== undefined && !isCount(manifest.maxVersions)) {
    errors.push('maxVersions must be a whole number from 1 to 50');
  }
  if (manifest.iconURL !== undefined && !isHttps(manifest.iconURL)) {
    errors.push('iconURL must be an https URL');
  }
  if (!isString(manifest.branch)) errors.push('branch is required');

  if (!Array.isArray(manifest.sources) || manifest.sources.length === 0) {
    errors.push('sources must be a non-empty array');
    return errors;
  }

  const seen = new Set();
  manifest.sources.forEach((source, i) => {
    const where = `sources[${i}]${isString(source?.id) ? ` (${source.id})` : ''}`;
    if (!source || typeof source !== 'object') return errors.push(`${where} must be an object`);

    if (!ID.test(source.id ?? '')) errors.push(`${where}.id must be lowercase letters, digits, "-"`);
    else if (seen.has(source.id)) errors.push(`${where}.id is used twice`);
    seen.add(source.id);

    if (!isString(source.name)) errors.push(`${where}.name is required`);
    if (!isString(source.description)) errors.push(`${where}.description is required`);
    if (source.maxVersions !== undefined && !isCount(source.maxVersions)) {
      errors.push(`${where}.maxVersions must be a whole number from 1 to 50`);
    }
    if (source.homepage !== undefined && !isHttps(source.homepage)) {
      errors.push(`${where}.homepage must be an https URL`);
    }

    if (source.type === 'external') {
      if (!isHttps(source.url)) errors.push(`${where}.url must be an https URL`);
    } else if (source.type === 'github') {
      validateGithubSource(source, where, errors);
    } else {
      errors.push(`${where}.type must be "external" or "github"`);
    }
  });

  return errors;
}

/** Reads and validates sources.json under `root`; throws one error listing every problem. */
export async function loadManifest(root) {
  const file = path.join(root, 'sources.json');
  let manifest;
  try {
    manifest = JSON.parse(await readFile(file, 'utf8'));
  } catch (error) {
    throw new Error(`Could not read ${file}: ${error.message}`);
  }

  const errors = validateManifest(manifest);
  if (errors.length > 0) {
    throw new Error(`sources.json is invalid:\n - ${errors.join('\n - ')}`);
  }
  return manifest;
}

/** Raw GitHub URL of a file in this repo, e.g. rawUrl(manifest, 'sources/ytkace.json'). */
export const rawUrl = (manifest, file) =>
  `https://raw.githubusercontent.com/${manifest.repository}/${manifest.branch}/${file}`;

/** The URL people add to Store: the source's own for external ones, ours for generated ones. */
export const sourceUrl = (manifest, source) =>
  source.type === 'external' ? source.url : rawUrl(manifest, `sources/${source.id}.json`);
