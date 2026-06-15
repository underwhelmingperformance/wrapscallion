import { createCommit, readCommit, resolveRef } from 'just-git/repo';
import { createServer, MemoryStorage } from 'just-git/server';
import { assertEquals, assertRejects, assertStrictEquals } from '@std/assert';

import {
	checkCommitMessages,
	CommitMessageCheck,
	type RangeCommitMessage,
	UnfixableCommitMessageCheckError,
} from './linter.ts';
import {
	BackupReferenceExistsError,
	CommitMessageRewriter,
	MergeCommitRewriteError,
	NonLinearHistoryError,
	StaleHeadError,
} from './rewriter.ts';

const author = {
	date: new Date('2026-01-01T00:00:00.000Z'),
	email: 'test@example.test',
	name: 'Test Author',
};

Deno.test(
	'CommitMessageRewriter rewords fixable checks and preserves final tree state',
	async () => {
		const fixture = await createLinearFixture();
		const checks = await checksFor(fixture.repo, [
			fixture.bad,
			fixture.descendant,
		]);
		const originalHead = await readCommit(fixture.repo, fixture.descendant);
		const result = await new CommitMessageRewriter({
			backupRef: 'refs/backup/wrapscallion/test',
			baseHash: fixture.base,
			branchRef: 'refs/heads/main',
			expectedHeadHash: fixture.descendant,
			repo: fixture.repo,
		}).reword(checks);

		const newHeadReference = await resolveRef(fixture.repo, 'refs/heads/main');
		const backupReference = await resolveRef(
			fixture.repo,
			'refs/backup/wrapscallion/test',
		);
		const newBad = await readCommit(
			fixture.repo,
			result.rewritten[0]?.newHash ?? '',
		);
		const newDescendant = await readCommit(fixture.repo, result.newHead);

		assertEquals({
			outcome: result.outcome,
			resultBackupRef: result.outcome === 'applied' ? result.backupRef : null,
			backupRef: backupReference,
			newHead: result.newHead,
			newHeadRef: newHeadReference,
			oldHead: result.oldHead,
			rewritten: result.rewritten.map((commit) => ({
				messageChanged: commit.messageChanged,
				oldHash: commit.oldHash,
				signatureDropped: commit.signatureDropped,
				subject: commit.subject,
			})),
		}, {
			outcome: 'applied',
			resultBackupRef: 'refs/backup/wrapscallion/test',
			backupRef: fixture.descendant,
			newHead: result.rewritten[1]?.newHash,
			newHeadRef: result.newHead,
			oldHead: fixture.descendant,
			rewritten: [
				{
					messageChanged: true,
					oldHash: fixture.bad,
					signatureDropped: false,
					subject: 'fix: explain body wrapping',
				},
				{
					messageChanged: false,
					oldHash: fixture.descendant,
					signatureDropped: false,
					subject: 'docs: add descendant',
				},
			],
		});
		assertStrictEquals(
			newBad.message,
			[
				'fix: explain body wrapping',
				'',
				'This body line is deliberately longer than seventy two columns so the',
				'commit-message checker can wrap it.',
				'',
			].join('\n'),
		);
		assertEquals(newDescendant, {
			...originalHead,
			message: 'docs: add descendant\n',
			parents: [result.rewritten[0]?.newHash ?? ''],
		});
	},
);

Deno.test('CommitMessageRewriter does not move refs in dry-run mode', async () => {
	const fixture = await createLinearFixture();
	const checks = await checksFor(fixture.repo, [
		fixture.bad,
		fixture.descendant,
	]);
	const result = await new CommitMessageRewriter({
		backupRef: 'refs/backup/wrapscallion/test',
		baseHash: fixture.base,
		branchRef: 'refs/heads/main',
		dryRun: true,
		expectedHeadHash: fixture.descendant,
		repo: fixture.repo,
	}).reword(checks);

	await assertStrictEquals(
		await resolveRef(fixture.repo, 'refs/heads/main'),
		fixture.descendant,
	);
	await assertStrictEquals(
		await resolveRef(fixture.repo, 'refs/backup/wrapscallion/test'),
		null,
	);
	assertStrictEquals(result.outcome, 'dry-run');
	assertEquals(result.rewritten.map((commit) => commit.oldHash), [
		fixture.bad,
		fixture.descendant,
	]);
});

Deno.test(
	'CommitMessageRewriter returns a no-op result when no messages need rewording',
	async () => {
		const fixture = await createLinearFixture();
		const checks = await checksFor(fixture.repo, [fixture.descendant]);
		const result = await new CommitMessageRewriter({
			backupRef: 'refs/backup/wrapscallion/test',
			baseHash: fixture.bad,
			branchRef: 'refs/heads/main',
			expectedHeadHash: fixture.descendant,
			repo: fixture.repo,
		}).reword(checks);

		await assertStrictEquals(
			await resolveRef(fixture.repo, 'refs/heads/main'),
			fixture.descendant,
		);
		await assertStrictEquals(
			await resolveRef(fixture.repo, 'refs/backup/wrapscallion/test'),
			null,
		);
		assertEquals(result, {
			outcome: 'unchanged',
			newHead: fixture.descendant,
			oldHead: fixture.descendant,
			rewritten: [],
		});
	},
);

Deno.test('CommitMessageRewriter rejects unfixable checks', async () => {
	const fixture = await createLinearFixture();
	const check = new CommitMessageCheck(
		commitMessage(fixture.bad, 'not conventional'),
		'not conventional',
		'not conventional',
		[
			{
				kind: 'rule',
				fixable: false,
				message: 'type-empty: type may not be empty',
				rule: 'type-empty',
			},
		],
	);

	await assertRejects(() =>
		new CommitMessageRewriter({
			backupRef: 'refs/backup/wrapscallion/test',
			baseHash: fixture.base,
			branchRef: 'refs/heads/main',
			expectedHeadHash: fixture.descendant,
			repo: fixture.repo,
		}).reword([check]), UnfixableCommitMessageCheckError);
});

Deno.test(
	'CommitMessageRewriter rejects rewriting when the backup ref already exists',
	async () => {
		const fixture = await createLinearFixture();
		const checks = await checksFor(fixture.repo, [
			fixture.bad,
			fixture.descendant,
		]);
		await fixture.repo.refStore.writeRef(
			'refs/backup/wrapscallion/test',
			{
				hash: fixture.base,
				type: 'direct',
			},
		);

		const error = await assertRejects(
			() =>
				new CommitMessageRewriter({
					backupRef: 'refs/backup/wrapscallion/test',
					baseHash: fixture.base,
					branchRef: 'refs/heads/main',
					expectedHeadHash: fixture.descendant,
					repo: fixture.repo,
				}).reword(checks),
			BackupReferenceExistsError,
		);

		assertEquals({
			backupReference: error.backupReference,
			name: error.name,
		}, {
			backupReference: 'refs/backup/wrapscallion/test',
			name: 'BackupReferenceExistsError',
		});
		await assertStrictEquals(
			await resolveRef(fixture.repo, 'refs/heads/main'),
			fixture.descendant,
		);
		await assertStrictEquals(
			await resolveRef(fixture.repo, 'refs/backup/wrapscallion/test'),
			fixture.base,
		);
	},
);

Deno.test(
	'CommitMessageRewriter rejects rewriting when the branch moved before final ref update',
	async () => {
		const fixture = await createLinearFixture();
		const checks = await checksFor(fixture.repo, [
			fixture.bad,
			fixture.descendant,
		]);
		const { hash: movedHead } = await fixture.server.commit('test', {
			author,
			branch: 'main',
			files: { 'moved.txt': 'moved\n' },
			message: 'docs: move head',
		});

		const error = await assertRejects(
			() =>
				new CommitMessageRewriter({
					backupRef: 'refs/backup/wrapscallion/test',
					baseHash: fixture.base,
					branchRef: 'refs/heads/main',
					expectedHeadHash: fixture.descendant,
					repo: fixture.repo,
				}).reword(checks),
			StaleHeadError,
		);

		assertEquals({
			expectedHead: error.expectedHead,
			name: error.name,
		}, {
			expectedHead: fixture.descendant,
			name: 'StaleHeadError',
		});
		await assertStrictEquals(
			await resolveRef(fixture.repo, 'refs/heads/main'),
			movedHead,
		);
		await assertStrictEquals(
			await resolveRef(fixture.repo, 'refs/backup/wrapscallion/test'),
			fixture.descendant,
		);
	},
);

Deno.test('CommitMessageRewriter rejects merge commits', async () => {
	const fixture = await createMergeFixture();
	const checks = await checksFor(fixture.repo, [fixture.merge]);

	await assertRejects(() =>
		new CommitMessageRewriter({
			backupRef: 'refs/backup/wrapscallion/test',
			baseHash: fixture.base,
			branchRef: 'refs/heads/main',
			expectedHeadHash: fixture.merge,
			repo: fixture.repo,
		}).reword(checks), MergeCommitRewriteError);
});

Deno.test('CommitMessageRewriter rejects a non-linear check sequence', async () => {
	const fixture = await createLinearFixture();
	const checks = await checksFor(fixture.repo, [fixture.descendant]);

	await assertRejects(() =>
		new CommitMessageRewriter({
			backupRef: 'refs/backup/wrapscallion/test',
			baseHash: fixture.base,
			branchRef: 'refs/heads/main',
			expectedHeadHash: fixture.descendant,
			repo: fixture.repo,
		}).reword(checks), NonLinearHistoryError);
});

Deno.test('CommitMessageRewriter reparents commits after the linted range', async () => {
	const fixture = await createLinearFixture();
	const checks = await checksFor(fixture.repo, [fixture.bad]);

	const result = await new CommitMessageRewriter({
		backupRef: 'refs/backup/wrapscallion/test',
		baseHash: fixture.base,
		branchRef: 'refs/heads/main',
		expectedHeadHash: fixture.descendant,
		repo: fixture.repo,
	}).reword(checks, [
		{ hash: fixture.descendant, subject: 'docs: add descendant' },
	]);

	const branchHead = await resolveRef(fixture.repo, 'refs/heads/main');
	const newDescendant = await readCommit(fixture.repo, result.newHead);

	assertEquals({
		outcome: result.outcome,
		branchAtNewHead: branchHead === result.newHead,
		descendantMessage: newDescendant.message,
		descendantReparented:
			newDescendant.parents[0] === result.rewritten[0]?.newHash,
		rewritten: result.rewritten.map((commit) => ({
			messageChanged: commit.messageChanged,
			oldHash: commit.oldHash,
		})),
	}, {
		outcome: 'applied',
		branchAtNewHead: true,
		descendantMessage: 'docs: add descendant\n',
		descendantReparented: true,
		rewritten: [
			{ messageChanged: true, oldHash: fixture.bad },
			{ messageChanged: false, oldHash: fixture.descendant },
		],
	});
});

Deno.test('CommitMessageRewriter reports a dropped signature', async () => {
	const server = createServer({ storage: new MemoryStorage() });
	await server.createRepo('test');
	const { hash: base } = await server.commit('test', {
		author,
		branch: 'main',
		files: { 'base.txt': 'base\n' },
		message: 'chore: add base',
	});
	const repo = await server.requireRepo('test');
	const baseCommit = await readCommit(repo, base);
	const plain = await createCommit(repo, {
		author,
		committer: author,
		message: [
			'fix: explain body wrapping',
			'',
			'This body line is deliberately longer than seventy two columns so the commit-message checker can wrap it.',
		].join('\n'),
		parents: [base],
		tree: baseCommit.tree,
	});
	const signed = await signCommit(repo, plain);
	await repo.refStore.writeRef('refs/heads/main', {
		hash: signed,
		type: 'direct',
	});
	const checks = await checksFor(repo, [signed]);

	const result = await new CommitMessageRewriter({
		backupRef: 'refs/backup/wrapscallion/test',
		baseHash: base,
		branchRef: 'refs/heads/main',
		expectedHeadHash: signed,
		repo,
	}).reword(checks);

	assertEquals(result.rewritten.map((commit) => commit.signatureDropped), [
		true,
	]);
});

/** Re-emits a commit object with a `gpgsig` header, as a signed commit has. */
async function signCommit(
	repo: Awaited<ReturnType<ReturnType<typeof createServer>['requireRepo']>>,
	hash: string,
): Promise<string> {
	const raw = await repo.objectStore.read(hash);
	const signed = new TextDecoder()
		.decode(raw.content)
		.replace('\n\n', '\ngpgsig fake-signature\n\n');

	return repo.objectStore.write('commit', new TextEncoder().encode(signed));
}

async function createLinearFixture(): Promise<{
	readonly bad: string;
	readonly base: string;
	readonly descendant: string;
	readonly repo: Awaited<
		ReturnType<ReturnType<typeof createServer>['requireRepo']>
	>;
	readonly server: ReturnType<typeof createServer>;
}> {
	const server = createServer({ storage: new MemoryStorage() });
	await server.createRepo('test');
	const { hash: base } = await server.commit('test', {
		author,
		branch: 'main',
		files: { 'base.txt': 'base\n' },
		message: 'chore: add base',
	});
	const { hash: bad } = await server.commit('test', {
		author,
		branch: 'main',
		files: { 'bad.txt': 'bad\n' },
		message: [
			'fix: explain body wrapping',
			'',
			'This body line is deliberately longer than seventy two columns so the commit-message checker can wrap it.',
		].join('\n'),
	});
	const { hash: descendant } = await server.commit('test', {
		author,
		branch: 'main',
		files: { 'descendant.txt': 'descendant\n' },
		message: 'docs: add descendant',
	});

	return {
		bad,
		base,
		descendant,
		repo: await server.requireRepo('test'),
		server,
	};
}

async function createMergeFixture(): Promise<{
	readonly base: string;
	readonly merge: string;
	readonly repo: Awaited<
		ReturnType<ReturnType<typeof createServer>['requireRepo']>
	>;
}> {
	const server = createServer({ storage: new MemoryStorage() });
	const repo = await server.createRepo('test');
	const { hash: base } = await server.commit('test', {
		author,
		branch: 'main',
		files: { 'base.txt': 'base\n' },
		message: 'chore: add base',
	});
	const { hash: left } = await server.commit('test', {
		author,
		branch: 'main',
		files: { 'left.txt': 'left\n' },
		message: 'feat: add left',
	});
	const { hash: right } = await server.commit('test', {
		author,
		branch: 'side',
		files: { 'right.txt': 'right\n' },
		message: 'feat: add right',
	});
	const leftCommit = await readCommit(repo, left);
	const merge = await createCommit(repo, {
		author,
		message: [
			'fix: explain merge message',
			'',
			'This body line is deliberately longer than seventy two columns so the commit-message checker can wrap it.',
		].join('\n'),
		parents: [left, right],
		tree: leftCommit.tree,
	});
	await repo.refStore.writeRef('refs/heads/main', {
		hash: merge,
		type: 'direct',
	});

	return { base, merge, repo };
}

async function checksFor(
	repo: Awaited<ReturnType<ReturnType<typeof createServer>['requireRepo']>>,
	hashes: readonly string[],
): Promise<readonly CommitMessageCheck<RangeCommitMessage>[]> {
	return checkCommitMessages(
		await Promise.all(
			hashes.map(async (hash) => {
				const commit = await readCommit(repo, hash);
				return commitMessage(hash, commit.message);
			}),
		),
	);
}

function commitMessage(hash: string, message: string): RangeCommitMessage {
	return {
		hash,
		label: hash.slice(0, 12),
		message,
		subject: message.split('\n', 1)[0] ?? '',
	};
}
