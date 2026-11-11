// A tiny GitHub REST client: just the two calls the generator needs. Takes `fetch`
// as a parameter so tests never touch the network.

const API = 'https://api.github.com';

export function createGitHub({ token, fetchImpl = fetch, apiBase = API } = {}) {
  async function request(route) {
    const response = await fetchImpl(`${apiBase}${route}`, {
      headers: {
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'aio-altstore',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
    });

    if (!response.ok) {
      const hint =
        response.status === 403 || response.status === 429
          ? ' (rate limited? set GITHUB_TOKEN)'
          : response.status === 404
            ? ' (does the repo exist, and is it public?)'
            : '';
      throw new Error(`GitHub ${response.status} for ${route}${hint}`);
    }
    return response.json();
  }

  return {
    getRepo: (repo) => request(`/repos/${repo}`),
    // One page is plenty: the generator keeps at most 50 releases.
    getReleases: (repo) => request(`/repos/${repo}/releases?per_page=100`),
  };
}
