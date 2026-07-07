import { createGit } from 'just-git';
import { createCommit, readCommit, readHead, resolveRef } from 'just-git/repo';
import { assertEquals, assertRejects } from '@std/assert';

import { UnbornHeadError } from './cli-errors.ts';
import { readRangeCommitMessages } from './commit-message-source.ts';
import { checkCommitMessages } from './linter.ts';
import { NodeFileSystem } from './node-file-system.ts';
import type {
	AppliedRewriteResult,
	DryRunRewriteResult,
	UnchangedRewriteResult,
} from './rewriter.ts';
import {
	reportRewriteResult,
	rewordCommitMessages,
	rewordedMessageCount,
} from './reword-command.ts';

const author = {
	date: new Date('2026-01-01T00:00:00.000Z'),
	email: 'test@example.test',
	name: 'Test Author',
};

const longBody =
	'This body line is deliberately longer than seventy two columns so the commit-message checker can wrap it.';

Deno.test('rewordCommitMessages rewrites a fixable commit and moves the branch', async () => {
	const repository = await createTempRepository();

	try {
		const checks = await checkCommitMessages(
			await readRangeCommitMessages(repository.repo, repository.base, 'HEAD'),
		);

		const result = await rewordCommitMessages(
			{
				dryRun: false,
				from: repository.base,
				kind: 'range',
				reword: true,
				to: 'HEAD',
			},
			checks,
			repository.git,
		);

		const movedHead = await resolveRef(repository.repo, 'refs/heads/main');

		assertEquals({
			branchAtNewHead: result.outcome === 'unchanged'
				? null
				: movedHead === result.newHead,
			outcome: result.outcome,
			signaturesDropped: result.rewritten.map((commit) =>
				commit.signatureDropped
			),
		}, {
			branchAtNewHead: true,
			outcome: 'applied',
			signaturesDropped: [false],
		});
	} finally {
		await Deno.remove(repository.directory, { recursive: true });
	}
});

Deno.test('rewordCommitMessages rewords from a linked worktree', async () => {
	const repository = await createTempRepository();
	const linkedParent = await Deno.makeTempDir({
		prefix: 'wrapscallion-reword-linked-',
	});
	const linkedDirectory = `${linkedParent}/worktree`;

	try {
		const addWorktree = ['worktree add', linkedDirectory, '-b work'].join(' ');
		const added = await repository.git.exec(addWorktree);
		assertEquals(added.exitCode, 0);

		const linkedGit = createGit({
			cwd: linkedDirectory,
			fs: new NodeFileSystem(),
		});
		const linkedRepo = await linkedGit.findRepo();

		if (linkedRepo === null) {
			throw new Error('failed to resolve the linked worktree');
		}

		const checks = await checkCommitMessages(
			await readRangeCommitMessages(linkedRepo, repository.base, 'HEAD'),
		);

		const result = await rewordCommitMessages(
			{
				dryRun: false,
				from: repository.base,
				kind: 'range',
				reword: true,
				to: 'HEAD',
			},
			checks,
			linkedGit,
		);

		const movedHead = await resolveRef(linkedRepo, 'refs/heads/work');

		assertEquals({
			branchAtNewHead: result.outcome === 'unchanged'
				? null
				: movedHead === result.newHead,
			outcome: result.outcome,
			signaturesDropped: result.rewritten.map((commit) =>
				commit.signatureDropped
			),
		}, {
			branchAtNewHead: true,
			outcome: 'applied',
			signaturesDropped: [false],
		});
	} finally {
		await Deno.remove(repository.directory, { recursive: true });
		await Deno.remove(linkedParent, { recursive: true });
	}
});

Deno.test('rewordCommitMessages rejects an unborn HEAD', async () => {
	const directory = await Deno.makeTempDir({ prefix: 'wrapscallion-reword-' });
	const git = createGit({ cwd: directory, fs: new NodeFileSystem() });

	try {
		await git.exec('init');

		await assertRejects(
			() =>
				rewordCommitMessages(
					{
						dryRun: false,
						from: 'HEAD',
						kind: 'range',
						reword: true,
						to: 'HEAD',
					},
					[],
					git,
				),
			UnbornHeadError,
		);
	} finally {
		await Deno.remove(directory, { recursive: true });
	}
});

Deno.test('reportRewriteResult renders each outcome in terminal mode', () => {
	const stream = new MemoryTextStream();

	reportRewriteResult(appliedResult(), 'terminal', stream);
	reportRewriteResult(dryRunResult(), 'terminal', stream);
	reportRewriteResult(unchangedResult(), 'terminal', stream);

	assertEquals(stream.lines(), [
		'Reworded 1 commit message(s).',
		'Backup ref: refs/backup/wrapscallion/test',
		'warning: 1 commit(s) lost their signature; the originals remain at refs/backup/wrapscallion/test.',
		'Would reword 1 commit message(s).',
		'warning: 1 commit(s) would lose their signature.',
		'No commit messages needed rewording.',
	]);
});

Deno.test('reportRewriteResult emits a single JSON event in JSON mode', () => {
	const stream = new MemoryTextStream();

	reportRewriteResult(appliedResult(), 'json', stream);

	assertEquals(JSON.parse(stream.lines()[0] ?? ''), {
		event: 'commit-message-rewrite',
		outcome: 'applied',
		backupRef: 'refs/backup/wrapscallion/test',
		newHead: 'new-head',
		oldHead: 'old-head',
		rewritten: [
			{
				oldHash: 'old',
				newHash: 'new',
				subject: 'fix: wrap the body',
				messageChanged: true,
				signatureDropped: true,
			},
		],
		signaturesDropped: 1,
	});
});

Deno.test('rewordedMessageCount counts only commits whose message changed', () => {
	assertEquals(rewordedMessageCount(appliedResult()), 1);
	assertEquals(
		rewordedMessageCount({
			...appliedResult(),
			rewritten: [
				{
					oldHash: 'a',
					newHash: 'b',
					subject: 'fix: a',
					messageChanged: true,
					signatureDropped: false,
				},
				{
					oldHash: 'c',
					newHash: 'd',
					subject: 'docs: reparented',
					messageChanged: false,
					signatureDropped: false,
				},
			],
		}),
		1,
	);
});

function appliedResult(): AppliedRewriteResult {
	return {
		outcome: 'applied',
		backupRef: 'refs/backup/wrapscallion/test',
		newHead: 'new-head',
		oldHead: 'old-head',
		rewritten: [
			{
				oldHash: 'old',
				newHash: 'new',
				subject: 'fix: wrap the body',
				messageChanged: true,
				signatureDropped: true,
			},
		],
	};
}

function dryRunResult(): DryRunRewriteResult {
	return {
		outcome: 'dry-run',
		newHead: 'new-head',
		oldHead: 'old-head',
		rewritten: [
			{
				oldHash: 'old',
				newHash: 'new',
				subject: 'fix: wrap the body',
				messageChanged: true,
				signatureDropped: true,
			},
		],
	};
}

function unchangedResult(): UnchangedRewriteResult {
	return {
		outcome: 'unchanged',
		newHead: 'head',
		oldHead: 'head',
		rewritten: [],
	};
}

async function createTempRepository(): Promise<{
	readonly base: string;
	readonly directory: string;
	readonly git: ReturnType<typeof createGit>;
	readonly repo: NonNullable<
		Awaited<ReturnType<ReturnType<typeof createGit>['findRepo']>>
	>;
}> {
	const directory = await Deno.makeTempDir({ prefix: 'wrapscallion-reword-' });
	const git = createGit({ cwd: directory, fs: new NodeFileSystem() });
	await git.exec('init');
	await git.exec('config user.email test@example.test');
	await git.exec('config user.name Test');
	await git.exec('commit --allow-empty -m "chore: base"');

	const repo = await git.findRepo();

	if (repo === null) {
		throw new Error('failed to create test repository');
	}

	const head = await readHead(repo);
	const base = head.hash ?? '';
	const branch = head.ref ?? 'refs/heads/main';
	const baseCommit = await readCommit(repo, base);
	const bad = await createCommit(repo, {
		author,
		committer: author,
		message: ['fix: wrap the body', '', longBody].join('\n'),
		parents: [base],
		tree: baseCommit.tree,
	});
	await repo.refStore.writeRef(branch, { hash: bad, type: 'direct' });

	return { base, directory, git, repo };
}

class MemoryTextStream {
	readonly #chunks: string[] = [];

	write(chunk: string): void {
		this.#chunks.push(chunk);
	}

	lines(): string[] {
		return this.#chunks
			.join('')
			.split('\n')
			.filter((line) => line !== '');
	}
}
