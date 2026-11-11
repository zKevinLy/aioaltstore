import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createGitHub } from '../scripts/lib/github.mjs';

const reply = (status, body = {}) => async () =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('createGitHub', () => {
  it('calls the right routes with the right headers', async () => {
    const seen = [];
    const fetchImpl = async (url, init) => {
      seen.push({ url, headers: init.headers });
      return new Response('[]');
    };
    const github = createGitHub({ fetchImpl });

    await github.getRepo('itzzace/ytkace');
    await github.getReleases('itzzace/ytkace');

    assert.equal(seen[0].url, 'https://api.github.com/repos/itzzace/ytkace');
    assert.equal(seen[1].url, 'https://api.github.com/repos/itzzace/ytkace/releases?per_page=100');
    assert.equal(seen[0].headers.Accept, 'application/vnd.github+json');
    assert.equal(seen[0].headers['User-Agent'], 'aiostore');
  });

  it('sends the token only when there is one', async () => {
    const headers = [];
    const fetchImpl = async (_url, init) => {
      headers.push(init.headers);
      return new Response('{}');
    };

    await createGitHub({ fetchImpl }).getRepo('a/b');
    await createGitHub({ fetchImpl, token: 'secret' }).getRepo('a/b');

    assert.equal('Authorization' in headers[0], false);
    assert.equal(headers[1].Authorization, 'Bearer secret');
  });

  it('turns errors into helpful messages', async () => {
    const make = (status) => createGitHub({ fetchImpl: reply(status) });
    await assert.rejects(make(404).getRepo('a/b'), /404 for \/repos\/a\/b \(does the repo exist/);
    await assert.rejects(make(403).getRepo('a/b'), /rate limited\? set GITHUB_TOKEN/);
    await assert.rejects(make(500).getRepo('a/b'), /GitHub 500 for \/repos\/a\/b$/);
  });
});
