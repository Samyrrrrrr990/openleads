/**
 * Push to GitHub, from the export dialog.
 *
 * The dialog already shows exactly which files will be written. This adds
 * where they go, and says it in full before anything happens: the repository,
 * the branch, the commit message, the file count. No silent pushes, no force,
 * no hidden commits — every one of those is a way to lose somebody's work, and
 * none of them is worth the two seconds it saves.
 */

import { useCallback, useEffect, useState } from 'react';
import type { PlanId } from '@zory/core';
import { PLANS } from '@zory/core';
import type { ExportedFile } from '../../core/export/generate';
import {
  GitHubError,
  createRepo,
  getUser,
  isValidRepoName,
  listRepos,
  pushFiles,
  type GitHubRepo,
  type GitHubUser,
} from '../../core/github/client';
import { getField } from '../../core/integrations/store';
import { useBillingStore } from '../../core/billing/store';
import { checkFeature } from '@zory/core';
import { Button, Field, Select, TextInput } from '../../ui/controls';
import styles from './ExportDialog.module.css';

type Phase = 'idle' | 'loading' | 'ready' | 'pushing' | 'done';

export function GitHubPush({
  files,
  projectName,
  slug,
}: {
  files: ExportedFile[];
  projectName: string;
  slug: string;
}): React.ReactElement {
  const entitlements = useBillingStore((s) => s.entitlements);
  const gate = checkFeature(entitlements, 'github-push');

  const [token, setToken] = useState(() => getField('github', 'GITHUB_TOKEN'));
  const [phase, setPhase] = useState<Phase>('idle');
  const [user, setUser] = useState<GitHubUser | null>(null);
  const [repos, setRepos] = useState<GitHubRepo[]>([]);
  const [repoId, setRepoId] = useState<string>('');
  const [newRepoName, setNewRepoName] = useState(slug);
  const [message, setMessage] = useState(`Update ${projectName} from Zory`);
  const [progress, setProgress] = useState<{ fraction: number; label: string } | null>(null);
  const [result, setResult] = useState<{ url: string; sha: string; branch: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setToken(getField('github', 'GITHUB_TOKEN'));
  }, []);

  const connect = useCallback(async () => {
    setPhase('loading');
    setError(null);
    try {
      const [account, repositories] = await Promise.all([getUser(token), listRepos(token)]);
      setUser(account);
      setRepos(repositories.filter((repo) => repo.canPush));
      setPhase('ready');
    } catch (caught) {
      setError(caught instanceof GitHubError ? caught.message : 'Could not reach GitHub.');
      setPhase('idle');
    }
  }, [token]);

  const push = useCallback(async () => {
    setPhase('pushing');
    setError(null);
    setProgress({ fraction: 0, label: 'Starting' });

    try {
      let target = repos.find((repo) => String(repo.id) === repoId) ?? null;

      if (!target) {
        if (!isValidRepoName(newRepoName)) {
          throw new GitHubError('A repository name can hold letters, numbers, dots, dashes and underscores.', 400);
        }
        setProgress({ fraction: 0.01, label: `Creating ${newRepoName}` });
        target = await createRepo(token, newRepoName, {
          private: true,
          description: `${projectName}, built with Zory.`,
        });
      }

      const pushed = await pushFiles({
        token,
        owner: target.owner,
        repo: target.name,
        branch: target.defaultBranch,
        message,
        files,
        onProgress: (fraction, label) => setProgress({ fraction, label }),
      });

      setResult({ url: pushed.commitUrl, sha: pushed.commitSha, branch: pushed.branch });
      setPhase('done');
    } catch (caught) {
      setError(caught instanceof GitHubError ? caught.message : 'The push did not complete.');
      setPhase('ready');
    } finally {
      setProgress(null);
    }
  }, [files, message, newRepoName, projectName, repoId, repos, token]);

  if (gate) {
    return (
      <div className={styles.github}>
        <p className={styles.githubTitle}>Push to GitHub</p>
        <p className={styles.githubBody}>
          Committing a project straight into a repository is on {PLANS[gate.upgradeTo as PlanId].name} and
          above. Downloading the .zip is on every plan and produces exactly the same files.
        </p>
        <a className={styles.githubLink} href="/pricing">
          See what changes
        </a>
      </div>
    );
  }

  if (phase === 'done' && result) {
    return (
      <div className={styles.github}>
        <p className={styles.githubTitle}>Pushed to {result.branch}</p>
        <p className={styles.githubBody}>
          {files.length} files in one commit, <code>{result.sha.slice(0, 7)}</code>.
        </p>
        <a className={styles.githubLink} href={result.url} target="_blank" rel="noreferrer noopener">
          Review the commit on GitHub
        </a>
      </div>
    );
  }

  if (!token) {
    return (
      <div className={styles.github}>
        <p className={styles.githubTitle}>Push to GitHub</p>
        <p className={styles.githubBody}>
          Add a fine-grained token in Settings, with Contents: read and write on the repositories you
          want Zory to push to. It stays in this browser and is never sent to us.
        </p>
        <a className={styles.githubLink} href="/app/settings">
          Open settings
        </a>
      </div>
    );
  }

  return (
    <div className={styles.github}>
      <p className={styles.githubTitle}>
        Push to GitHub
        {user ? <span className={styles.githubUser}>as {user.login}</span> : null}
      </p>

      {phase === 'idle' || phase === 'loading' ? (
        <>
          <p className={styles.githubBody}>
            Zory will read the repositories your token can write to. Nothing is pushed until you say
            so.
          </p>
          <Button variant="outline" disabled={phase === 'loading'} onClick={() => void connect()}>
            {phase === 'loading' ? 'Checking the token…' : 'Connect GitHub'}
          </Button>
        </>
      ) : (
        <>
          <Field label="Repository" htmlFor="gh-repo" wide>
            <Select
              id="gh-repo"
              value={repoId}
              onChange={(event) => setRepoId(event.target.value)}
              options={[
                { value: '', label: 'Create a new private repository' },
                ...repos.map((repo) => ({
                  value: String(repo.id),
                  label: `${repo.fullName} · ${repo.defaultBranch}`,
                })),
              ]}
            />
          </Field>

          {repoId === '' ? (
            <Field label="Name" htmlFor="gh-name" wide>
              <TextInput
                id="gh-name"
                value={newRepoName}
                spellCheck={false}
                onChange={(event) => setNewRepoName(event.target.value)}
              />
            </Field>
          ) : null}

          <Field label="Commit message" htmlFor="gh-message" wide>
            <TextInput
              id="gh-message"
              value={message}
              onChange={(event) => setMessage(event.target.value)}
            />
          </Field>

          <p className={styles.githubBody}>
            {repoId === ''
              ? `Creates ${newRepoName} as a private repository, then writes ${files.length} files as one commit on its default branch.`
              : `Writes ${files.length} files as one commit on ${
                  repos.find((repo) => String(repo.id) === repoId)?.defaultBranch ?? 'the default branch'
                }. Files already there and not in this export are left alone.`}
          </p>

          {progress ? (
            <div className={styles.githubProgress}>
              <div
                className={styles.githubProgressBar}
                style={{ width: `${Math.round(progress.fraction * 100)}%` }}
              />
              <span className={styles.githubProgressLabel}>{progress.label}</span>
            </div>
          ) : null}

          <Button variant="primary" disabled={phase === 'pushing'} onClick={() => void push()}>
            {phase === 'pushing' ? 'Pushing…' : 'Push'}
          </Button>
        </>
      )}

      {error ? (
        <p className={styles.githubError} role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
