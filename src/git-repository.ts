import type { Git, GitContext } from 'just-git';

import { DirtyWorktreeError, MissingRepositoryError } from './cli-errors.ts';
import { hasTrackedChanges } from './worktree-status.ts';

export async function ensureNoTrackedChanges(git: Git): Promise<void> {
	const status = await git.exec('status --porcelain');

	if (status.exitCode !== 0) {
		throw new Error(status.stderr || status.stdout);
	}

	if (hasTrackedChanges(status.stdout)) {
		throw new DirtyWorktreeError();
	}
}

export async function findCurrentRepo(git: Git): Promise<GitContext> {
	const repo = await git.findRepo();

	if (repo === null) {
		throw new MissingRepositoryError();
	}

	return repo;
}
