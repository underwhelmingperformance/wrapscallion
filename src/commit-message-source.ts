import type { Git, GitRepo } from 'just-git';
import { revParse, walkCommitHistory } from 'just-git/repo';

import { CommitMessageFileError, RevisionNotFoundError } from './cli-errors.ts';
import type { EditOptions, RangeOptions } from './cli-options.ts';
import { findCurrentRepo } from './git-repository.ts';
import type { CommitMessage, RangeCommitMessage } from './linter.ts';
import {
	commitSubject,
	normaliseLineEndings,
	stripCommitMessageComments,
} from './message.ts';

export async function readCommitMessages(
	options: EditOptions | RangeOptions,
	git: Git,
): Promise<readonly CommitMessage[]> {
	if (options.kind === 'edit') {
		const message = stripCommitMessageComments(
			await readEditFile(options.file),
		);

		return [
			{
				label: options.file,
				message,
				subject: commitSubject(message),
			},
		];
	}

	const repo = await findCurrentRepo(git);

	return readRangeCommitMessages(repo, options.from, options.to);
}

/**
 * Reads the commit messages in the `from..to` range, oldest first. Git stores
 * each commit message with a trailing newline, so the message is normalised to
 * match the canonical form produced when a body is rewrapped; otherwise an
 * already-clean commit would look changed and rewording would reject it.
 */
export async function readRangeCommitMessages(
	repo: GitRepo,
	from: string,
	to: string,
): Promise<readonly RangeCommitMessage[]> {
	const fromHash = await revParse(repo, from);

	if (fromHash === null) {
		throw new RevisionNotFoundError(from);
	}

	const toHash = await revParse(repo, to);

	if (toHash === null) {
		throw new RevisionNotFoundError(to);
	}

	const commits: RangeCommitMessage[] = [];

	for await (
		const commit of walkCommitHistory(repo, toHash, {
			exclude: [fromHash],
		})
	) {
		const message = normaliseLineEndings(commit.message).trimEnd();

		commits.push({
			hash: commit.hash,
			label: commit.hash.slice(0, 12),
			message,
			subject: commitSubject(message),
		});
	}

	return commits.reverse();
}

async function readEditFile(path: string): Promise<string> {
	try {
		return await Deno.readTextFile(path);
	} catch (error) {
		throw new CommitMessageFileError(path, error);
	}
}
