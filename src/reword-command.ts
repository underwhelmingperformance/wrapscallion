import type { Git, GitContext } from 'just-git';
import { readHead, revParse } from 'just-git/repo';

import {
	DetachedHeadError,
	RevisionNotFoundError,
	UnbornHeadError,
} from './cli-errors.ts';
import type { RangeOptions } from './cli-options.ts';
import { readRangeCommitMessages } from './commit-message-source.ts';
import { ensureNoTrackedChanges, findCurrentRepo } from './git-repository.ts';
import type {
	checkCommitMessages,
	CommitMessageCheck,
	RangeCommitMessage,
} from './linter.ts';
import type { ReporterMode, TextStream } from './reporter.ts';
import {
	CommitMessageRewriter,
	type CommitMessageRewriteResult,
	MissingCommitHashError,
	type TrailingCommit,
} from './rewriter.ts';

export async function rewordCommitMessages(
	options: RangeOptions,
	checks: Awaited<ReturnType<typeof checkCommitMessages>>,
	git: Git,
): Promise<CommitMessageRewriteResult> {
	await ensureNoTrackedChanges(git);

	const repo = await findCurrentRepo(git);
	const head = await readHead(repo);

	if (head.hash === null) {
		throw new UnbornHeadError();
	}

	if (head.ref === null) {
		throw new DetachedHeadError(head.hash);
	}

	const baseHash = await revParse(repo, options.from);

	if (baseHash === null) {
		throw new RevisionNotFoundError(options.from);
	}

	assertRangeChecks(checks);

	const trailing = await trailingCommits(repo, options.to, head.hash);

	return new CommitMessageRewriter({
		backupRef: backupReferenceName(),
		baseHash,
		branchRef: head.ref,
		dryRun: options.dryRun,
		expectedHeadHash: head.hash,
		repo,
	}).reword(checks, trailing);
}

/**
 * The commits between the linted range's end and HEAD. When `--to` is below
 * HEAD these are reparented onto the rewritten history rather than dropped.
 */
async function trailingCommits(
	repo: GitContext,
	to: string,
	head: string,
): Promise<readonly TrailingCommit[]> {
	const messages = await readRangeCommitMessages(repo, to, head);

	return messages.map((message) => ({
		hash: message.hash,
		subject: message.subject,
	}));
}

/**
 * Rewording only runs on commits walked from history, which always carry a
 * hash. This is the single point that enforces that invariant before the
 * rewriter relies on it.
 */
function assertRangeChecks(
	checks: readonly CommitMessageCheck[],
): asserts checks is readonly CommitMessageCheck<RangeCommitMessage>[] {
	for (const check of checks) {
		if (check.commitMessage.hash === undefined) {
			throw new MissingCommitHashError(check.commitMessage.label);
		}
	}
}

export function reportRewriteResult(
	result: CommitMessageRewriteResult,
	format: ReporterMode,
	stream: TextStream,
): void {
	if (format === 'json') {
		stream.write(
			`${
				JSON.stringify({
					event: 'commit-message-rewrite',
					outcome: result.outcome,
					...(result.outcome === 'applied'
						? { backupRef: result.backupRef }
						: {}),
					newHead: result.newHead,
					oldHead: result.oldHead,
					rewritten: result.rewritten,
					signaturesDropped: signatureDroppedCount(result),
				})
			}\n`,
		);
		return;
	}

	if (result.rewritten.length === 0) {
		stream.write('No commit messages needed rewording.\n');
		return;
	}

	const action = result.outcome === 'dry-run' ? 'Would reword' : 'Reworded';
	stream.write(
		`${action} ${String(rewordedMessageCount(result))} commit message(s).\n`,
	);

	if (result.outcome === 'applied') {
		stream.write(`Backup ref: ${result.backupRef}\n`);
	}

	reportDroppedSignatures(result, stream);
}

function reportDroppedSignatures(
	result: CommitMessageRewriteResult,
	stream: TextStream,
): void {
	const dropped = signatureDroppedCount(result);

	if (dropped === 0) {
		return;
	}

	if (result.outcome === 'dry-run') {
		stream.write(
			`warning: ${String(dropped)} commit(s) would lose their signature.\n`,
		);
		return;
	}

	if (result.outcome === 'applied') {
		stream.write(
			`warning: ${
				String(dropped)
			} commit(s) lost their signature; the originals remain at ${result.backupRef}.\n`,
		);
	}
}

export function rewordedMessageCount(
	result: CommitMessageRewriteResult,
): number {
	return result.rewritten.filter((commit) => commit.messageChanged).length;
}

function signatureDroppedCount(result: CommitMessageRewriteResult): number {
	return result.rewritten.filter((commit) => commit.signatureDropped).length;
}

function backupReferenceName(): string {
	return `refs/backup/wrapscallion/${
		new Date()
			.toISOString()
			.replaceAll(/[:.]/g, '-')
	}`;
}
