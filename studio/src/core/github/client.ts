/**
 * Pushing a Zory project to GitHub.
 *
 * Authentication is a fine-grained personal access token the user creates and
 * pastes in. That is a deliberate choice over OAuth, and the reason is
 * structural rather than lazy: a browser-only OAuth flow needs a client secret
 * held on a server, and the moment Zory holds that secret it is in the path of
 * everybody's repositories. A token the user minted, scoped to the repositories
 * they chose, stored on their own device and sent only to api.github.com, is a
 * smaller thing to trust. The same interface takes an OAuth token later if the
 * calculation changes.
 *
 * The push itself uses the Git data API rather than the contents API: blobs,
 * one tree, one commit, one ref update. That matters because it is *one*
 * commit containing every file, rather than one commit per file, and because
 * it can be inspected before it happens.
 *
 * Nothing here force-pushes, deletes a branch, or writes outside the ref it
 * was given. A push that would not fast-forward fails and says so.
 */

const API = 'https://api.github.com';
const ACCEPT = 'application/vnd.github+json';
const API_VERSION = '2022-11-28';

export interface GitHubUser {
  login: string;
  name: string | null;
  avatarUrl: string | null;
}

export interface GitHubRepo {
  id: number;
  name: string;
  fullName: string;
  owner: string;
  private: boolean;
  defaultBranch: string;
  htmlUrl: string;
  /** False when the token cannot write here — shown rather than discovered. */
  canPush: boolean;
  updatedAt: string;
}

export class GitHubError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'GitHubError';
  }
}

function headers(token: string): Record<string, string> {
  return {
    accept: ACCEPT,
    authorization: `Bearer ${token}`,
    'x-github-api-version': API_VERSION,
    'content-type': 'application/json',
  };
}

/**
 * Turns a failed response into something a person can act on.
 *
 * GitHub's own messages are good but assume you know the API. These translate
 * the three that actually happen — bad token, missing scope, rate limit — and
 * pass anything else through.
 */
async function fail(response: Response): Promise<never> {
  const body = (await response.json().catch(() => ({}))) as { message?: string };
  const detail = body.message ?? `GitHub returned ${response.status}.`;

  if (response.status === 401) {
    throw new GitHubError('That token is not valid, or it has expired.', 401);
  }
  if (response.status === 403) {
    if (response.headers.get('x-ratelimit-remaining') === '0') {
      throw new GitHubError('GitHub is rate limiting this token. Try again shortly.', 403);
    }
    throw new GitHubError(
      'That token does not have permission to write here. It needs Contents: read and write on this repository.',
      403,
    );
  }
  if (response.status === 404) {
    throw new GitHubError(
      'GitHub could not find that repository, which usually means the token cannot see it.',
      404,
    );
  }
  throw new GitHubError(detail, response.status);
}

async function call<T>(token: string, path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${API}${path}`, { ...init, headers: headers(token) });
  if (!response.ok) await fail(response);
  return (await response.json()) as T;
}

export async function getUser(token: string): Promise<GitHubUser> {
  const data = await call<{ login: string; name: string | null; avatar_url: string | null }>(
    token,
    '/user',
  );
  return { login: data.login, name: data.name, avatarUrl: data.avatar_url };
}

/** Repositories the token can see, most recently touched first. */
export async function listRepos(token: string): Promise<GitHubRepo[]> {
  const data = await call<
    {
      id: number;
      name: string;
      full_name: string;
      owner: { login: string };
      private: boolean;
      default_branch: string;
      html_url: string;
      permissions?: { push?: boolean };
      updated_at: string;
    }[]
  >(token, '/user/repos?per_page=100&sort=updated&affiliation=owner,collaborator');

  return data.map((repo) => ({
    id: repo.id,
    name: repo.name,
    fullName: repo.full_name,
    owner: repo.owner.login,
    private: repo.private,
    defaultBranch: repo.default_branch,
    htmlUrl: repo.html_url,
    canPush: repo.permissions?.push !== false,
    updatedAt: repo.updated_at,
  }));
}

export async function createRepo(
  token: string,
  name: string,
  options: { private: boolean; description?: string },
): Promise<GitHubRepo> {
  const data = await call<{
    id: number;
    name: string;
    full_name: string;
    owner: { login: string };
    private: boolean;
    default_branch: string;
    html_url: string;
    updated_at: string;
  }>(token, '/user/repos', {
    method: 'POST',
    body: JSON.stringify({
      name,
      private: options.private,
      description: options.description ?? '',
      // A repository with no commit has no default branch, and the push below
      // has to be able to create the first one.
      auto_init: true,
    }),
  });

  return {
    id: data.id,
    name: data.name,
    fullName: data.full_name,
    owner: data.owner.login,
    private: data.private,
    defaultBranch: data.default_branch || 'main',
    htmlUrl: data.html_url,
    canPush: true,
    updatedAt: data.updated_at,
  };
}

// ------------------------------------------------------------------ push ----

export interface PushFile {
  path: string;
  content: string | Uint8Array;
}

export interface PushInput {
  token: string;
  owner: string;
  repo: string;
  branch: string;
  message: string;
  files: PushFile[];
  /** Called with 0..1 so a long push can show progress rather than a spinner. */
  onProgress?: (fraction: number, label: string) => void;
}

export interface PushResult {
  commitSha: string;
  commitUrl: string;
  branch: string;
  fileCount: number;
}

/** Base64 for the blob API. Text goes through UTF-8 first. */
function toBase64(content: string | Uint8Array): string {
  const bytes = typeof content === 'string' ? new TextEncoder().encode(content) : content;
  let binary = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

/**
 * Writes every file as one commit on one branch.
 *
 * The tree is built from the base commit's tree, so files already in the
 * repository and not in this export are left alone rather than deleted. That
 * is the conservative choice: a Zory project is usually part of a repository,
 * not the whole of one.
 */
export async function pushFiles({
  token,
  owner,
  repo,
  branch,
  message,
  files,
  onProgress,
}: PushInput): Promise<PushResult> {
  const base = `/repos/${owner}/${repo}`;
  onProgress?.(0.02, 'Reading the branch');

  const ref = await call<{ object: { sha: string } }>(token, `${base}/git/ref/heads/${branch}`);
  const headSha = ref.object.sha;

  const headCommit = await call<{ tree: { sha: string } }>(token, `${base}/git/commits/${headSha}`);

  // Blobs, one request each. Sequential rather than parallel on purpose:
  // GitHub secondary-rate-limits bursts, and a push that fails halfway is
  // worse than a push that takes a few seconds longer.
  const entries: { path: string; mode: '100644'; type: 'blob'; sha: string }[] = [];
  for (const [index, file] of files.entries()) {
    onProgress?.(0.05 + (index / files.length) * 0.75, `Uploading ${file.path}`);
    const blob = await call<{ sha: string }>(token, `${base}/git/blobs`, {
      method: 'POST',
      body: JSON.stringify({ content: toBase64(file.content), encoding: 'base64' }),
    });
    entries.push({ path: file.path, mode: '100644', type: 'blob', sha: blob.sha });
  }

  onProgress?.(0.85, 'Building the tree');
  const tree = await call<{ sha: string }>(token, `${base}/git/trees`, {
    method: 'POST',
    body: JSON.stringify({ base_tree: headCommit.tree.sha, tree: entries }),
  });

  onProgress?.(0.92, 'Writing the commit');
  const commit = await call<{ sha: string; html_url: string }>(token, `${base}/git/commits`, {
    method: 'POST',
    body: JSON.stringify({ message, tree: tree.sha, parents: [headSha] }),
  });

  onProgress?.(0.97, 'Moving the branch');
  await call(token, `${base}/git/refs/heads/${branch}`, {
    method: 'PATCH',
    // Never force. A branch that has moved under us is a conflict to report,
    // not history to overwrite.
    body: JSON.stringify({ sha: commit.sha, force: false }),
  });

  onProgress?.(1, 'Done');
  return {
    commitSha: commit.sha,
    commitUrl: commit.html_url,
    branch,
    fileCount: files.length,
  };
}

/** GitHub's own rules, checked before the request so the error is immediate. */
export function isValidRepoName(name: string): boolean {
  return /^[A-Za-z0-9._-]{1,100}$/.test(name) && name !== '.' && name !== '..';
}
