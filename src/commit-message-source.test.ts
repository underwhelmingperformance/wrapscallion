import { createCommit, readCommit } from 'just-git/repo';
import { createServer, MemoryStorage } from 'just-git/server';
import { assertEquals } from '@std/assert';

import { readRangeCommitMessages } from './commit-message-source.ts';
import { checkCommitMessages } from './linter.ts';

const author = {
	date: new Date('2026-01-01T00:00:00.000Z'),
	email: 'test@example.test',
	name: 'Test Author',
};

Deno.test(
	'readRangeCommitMessages strips the trailing newline git stores in messages',
	async () => {
		const fixture = await createCleanBodyFixture();

		const messages = await readRangeCommitMessages(
			fixture.repo,
			fixture.base,
			fixture.head,
		);

		assertEquals(messages, [
			{
				hash: fixture.head,
				label: fixture.head.slice(0, 12),
				message: 'feat: tidy the docs\n\nA short body that is already fine.',
				subject: 'feat: tidy the docs',
			},
		]);
	},
);

Deno.test(
	'a clean commit with a body is not reported as changed after reading the range',
	async () => {
		const fixture = await createCleanBodyFixture();

		const messages = await readRangeCommitMessages(
			fixture.repo,
			fixture.base,
			fixture.head,
		);
		const checks = await checkCommitMessages(messages);

		assertEquals(checks.map((check) => check.changed), [false]);
	},
);

async function createCleanBodyFixture(): Promise<{
	readonly base: string;
	readonly head: string;
	readonly repo: Awaited<
		ReturnType<ReturnType<typeof createServer>['requireRepo']>
	>;
}> {
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

	// Real git always terminates the stored message with a newline, which the
	// in-memory `createCommit` preserves verbatim. Append one here to reproduce
	// what the linter sees when walking a real repository.
	const head = await createCommit(repo, {
		author,
		committer: author,
		message: 'feat: tidy the docs\n\nA short body that is already fine.\n',
		parents: [base],
		tree: baseCommit.tree,
	});
	await repo.refStore.writeRef('refs/heads/main', {
		hash: head,
		type: 'direct',
	});

	return { base, head, repo };
}
