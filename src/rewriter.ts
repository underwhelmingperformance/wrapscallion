import type { GitRepo } from 'just-git';
import { createCommit, readCommit } from 'just-git/repo';

import {
	type CommitMessageCheck,
	type RangeCommitMessage,
	UnfixableCommitMessageCheckError,
} from './linter.ts';

/** Base class for expected commit-message rewrite failures. */
export abstract class CommitMessageRewriteError extends Error {
	protected constructor(message: string) {
		super(message);
	}
}

export class BackupReferenceExistsError extends CommitMessageRewriteError {
	constructor(public readonly backupReference: string) {
		super(`backup ref already exists: ${backupReference}`);
		this.name = 'BackupReferenceExistsError';
	}
}

export class MergeCommitRewriteError extends CommitMessageRewriteError {
	constructor(public readonly commit: string) {
		super(`cannot reword through merge commit ${commit}`);
		this.name = 'MergeCommitRewriteError';
	}
}

export class MissingCommitHashError extends CommitMessageRewriteError {
	constructor(public readonly commit: string) {
		super(`commit ${commit} has no hash`);
		this.name = 'MissingCommitHashError';
	}
}

export class NonLinearHistoryError extends CommitMessageRewriteError {
	constructor(
		public readonly commit: string,
		public readonly expectedParent: string,
		public readonly actualParent: string | undefined,
	) {
		super(`selected range is not a linear history at ${commit}`);
		this.name = 'NonLinearHistoryError';
	}
}

export class StaleHeadError extends CommitMessageRewriteError {
	constructor(public readonly expectedHead: string) {
		super('branch moved while rewording commit messages');
		this.name = 'StaleHeadError';
	}
}

export interface CommitMessageRewriteOptions {
	readonly backupRef: string;
	readonly baseHash: string;
	readonly branchRef: string;
	readonly dryRun?: boolean;
	readonly expectedHeadHash: string;
	readonly repo: GitRepo;
}

export interface RewrittenCommit {
	readonly oldHash: string;
	readonly newHash: string;
	readonly subject: string;
	/**
	 * Whether this commit's own message changed. A descendant of a reworded
	 * commit is recreated to reattach its new parent even when its message is
	 * untouched, so this is `false` for those.
	 */
	readonly messageChanged: boolean;
	/**
	 * Whether the original commit carried a signature that the rewrite drops.
	 * just-git cannot re-sign, so a signed commit becomes unsigned; the original
	 * is still reachable through the backup ref.
	 */
	readonly signatureDropped: boolean;
}

/** A commit after the linted range, reparented onto the rewritten history. */
export interface TrailingCommit {
	readonly hash: string;
	readonly subject: string;
}

interface RewriteItem {
	readonly changed: boolean;
	readonly hash: string;
	readonly message: string | undefined;
	readonly subject: string;
}

interface RewriteResultBase {
	readonly newHead: string;
	readonly oldHead: string;
	readonly rewritten: readonly RewrittenCommit[];
}

/** No commit needed rewording; the branch was left where it was. */
export interface UnchangedRewriteResult extends RewriteResultBase {
	readonly outcome: 'unchanged';
	readonly rewritten: readonly [];
}

/** A dry run computed the new head without moving any ref. */
export interface DryRunRewriteResult extends RewriteResultBase {
	readonly outcome: 'dry-run';
}

/** The branch was advanced; `backupRef` points at the previous head. */
export interface AppliedRewriteResult extends RewriteResultBase {
	readonly outcome: 'applied';
	readonly backupRef: string;
}

export type CommitMessageRewriteResult =
	| AppliedRewriteResult
	| DryRunRewriteResult
	| UnchangedRewriteResult;

/** Rewrites Git commit objects using precomputed commit-message checks. */
export class CommitMessageRewriter {
	constructor(private readonly options: CommitMessageRewriteOptions) {}

	/**
	 * Rewrites the linted commits, then reparents any `trailing` commits (those
	 * between the linted range's end and HEAD) onto the new history so a `--to`
	 * below HEAD does not drop them. Trailing commits keep their messages.
	 */
	async reword(
		checks: readonly CommitMessageCheck<RangeCommitMessage>[],
		trailing: readonly TrailingCommit[] = [],
	): Promise<CommitMessageRewriteResult> {
		this.assertChecksCanBeReworded(checks);

		const items: readonly RewriteItem[] = [
			...checks.map((check) => ({
				changed: check.changed,
				hash: check.commitMessage.hash,
				message: check.changed ? check.rewordMessage() : check.originalMessage,
				subject: check.commitMessage.subject,
			})),
			...trailing.map((commit) => ({
				changed: false,
				hash: commit.hash,
				message: undefined,
				subject: commit.subject,
			})),
		];

		let currentOriginalParent = this.options.baseHash;
		let currentRewrittenParent = this.options.baseHash;
		let rewriting = false;
		const rewritten: RewrittenCommit[] = [];

		for (const item of items) {
			const oldHash = item.hash;
			const commit = await readCommit(this.options.repo, oldHash);

			if (commit.parents.length > 1) {
				throw new MergeCommitRewriteError(oldHash);
			}

			const actualParent = commit.parents[0];

			if (actualParent !== currentOriginalParent) {
				throw new NonLinearHistoryError(
					oldHash,
					currentOriginalParent,
					actualParent,
				);
			}

			if (!rewriting && !item.changed) {
				currentOriginalParent = oldHash;
				currentRewrittenParent = oldHash;
				continue;
			}

			rewriting = true;
			const signatureDropped = await isCommitSigned(this.options.repo, oldHash);
			const newHash = await createCommit(this.options.repo, {
				author: commit.author,
				committer: commit.committer,
				message: gitCanonicalMessage(item.message ?? commit.message),
				parents: [currentRewrittenParent],
				tree: commit.tree,
			});

			rewritten.push({
				messageChanged: item.changed,
				newHash,
				oldHash,
				signatureDropped,
				subject: item.subject,
			});
			currentOriginalParent = oldHash;
			currentRewrittenParent = newHash;
		}

		const newHead = currentRewrittenParent;

		if (newHead === this.options.expectedHeadHash) {
			return {
				outcome: 'unchanged',
				newHead,
				oldHead: this.options.expectedHeadHash,
				rewritten: [],
			};
		}

		if (this.options.dryRun === true) {
			return {
				outcome: 'dry-run',
				newHead,
				oldHead: this.options.expectedHeadHash,
				rewritten,
			};
		}

		await this.createBackupRef();
		await this.advanceBranch(newHead);

		return {
			outcome: 'applied',
			backupRef: this.options.backupRef,
			newHead,
			oldHead: this.options.expectedHeadHash,
			rewritten,
		};
	}

	private assertChecksCanBeReworded(
		checks: readonly CommitMessageCheck<RangeCommitMessage>[],
	): void {
		for (const check of checks) {
			if (check.failed && !check.fixable) {
				throw new UnfixableCommitMessageCheckError(check);
			}
		}
	}

	private async createBackupRef(): Promise<void> {
		const created = await this.options.repo.refStore.compareAndSwapRef(
			this.options.backupRef,
			// just-git uses null for create-only compare-and-swap refs.
			null,
			{
				hash: this.options.expectedHeadHash,
				type: 'direct',
			},
		);

		if (!created) {
			throw new BackupReferenceExistsError(this.options.backupRef);
		}
	}

	private async advanceBranch(newHead: string): Promise<void> {
		const advanced = await this.options.repo.refStore.compareAndSwapRef(
			this.options.branchRef,
			this.options.expectedHeadHash,
			{
				hash: newHead,
				type: 'direct',
			},
		);

		if (!advanced) {
			throw new StaleHeadError(this.options.expectedHeadHash);
		}
	}
}

/**
 * Git stores commit messages with a single trailing newline. Match that so the
 * objects we write are byte-identical to ones git would create itself.
 */
function gitCanonicalMessage(message: string): string {
	return `${message.trimEnd()}\n`;
}

/**
 * Reads the raw commit object to see whether it carries a signature. just-git's
 * parsed commit drops unknown headers, so the raw bytes are the only place the
 * `gpgsig` header (GPG or SSH) survives. Works for loose and packed objects.
 */
async function isCommitSigned(repo: GitRepo, hash: string): Promise<boolean> {
	const raw = await repo.objectStore.read(hash);
	const headers = new TextDecoder().decode(raw.content).split('\n\n', 1)[0] ??
		'';

	return /^gpgsig(?:-sha256)? /mu.test(headers);
}
