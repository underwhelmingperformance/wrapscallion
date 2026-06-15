import { assertEquals } from '@std/assert';

import { main } from './cli.ts';
import { hasTrackedChanges } from './worktree-status.ts';

Deno.test(
	'wrapscallion prints useful help',
	async () => {
		const result = await runCli(['--help']);

		assertEquals(result, {
			code: 0,
			stderr: '',
			stdout: [
				'Usage: wrapscallion [options]',
				'',
				'Lint Conventional Commit messages and 72-column bodies.',
				'',
				'Options:',
				'  --output-format <format>  output format (choices: "terminal", "json")',
				'  --colour                  force ANSI colour (overrides NO_COLOR)',
				'  --no-colour               disable ANSI colour (overrides FORCE_COLOR)',
				'  --dry-run                 show what --reword would change without moving refs',
				'  --edit <file>             lint a commit message file, for commit-msg hooks',
				'  --from <revision>         lint commits after this revision',
				'  --reword                  rewrite fixable commit messages in the selected',
				'                            range',
				'  --to <revision>           lint commits up to this revision (default: "HEAD")',
				'  -h, --help                display help for command',
				'',
			].join('\n'),
		});
	},
);

Deno.test(
	'wrapscallion emits JSONL reports for commit-msg checks',
	async () => {
		const directory = await Deno.makeTempDir({
			prefix: 'wrapscallion-commit-message-',
		});

		try {
			const messageFile = `${directory}/COMMIT_EDITMSG`;
			await Deno.writeTextFile(messageFile, 'not conventional\n');
			const result = await runCli(['--edit', messageFile]);

			assertEquals({
				code: result.code,
				events: normaliseEventDurations(parseJsonLines(result.stderr)),
				stdout: result.stdout,
			}, {
				code: 1,
				events: [
					{
						durationMs: 'number',
						event: 'phase',
						facts: {
							messages: '1',
						},
						label: 'Checking commit messages',
						status: 'ok',
					},
					{
						event: 'wrapscallion',
						failures: [
							{
								commit: messageFile,
								findings: [
									{
										fixable: false,
										message: 'subject-empty: subject may not be empty',
										rule: 'subject-empty',
									},
									{
										fixable: false,
										message: 'type-empty: type may not be empty',
										rule: 'type-empty',
									},
								],
								subject: 'not conventional',
							},
						],
						status: 'failed',
						total: 1,
					},
				],
				stdout: '',
			});
		} finally {
			await Deno.remove(directory, { recursive: true });
		}
	},
);

Deno.test('hasTrackedChanges ignores untracked-only and empty status', () => {
	const statuses = [
		'',
		['?? scratch.txt', '?? notes/idea.md', ''].join('\n'),
	];

	assertEquals(
		statuses.map((status) => hasTrackedChanges(status)),
		[false, false],
	);
});

Deno.test('hasTrackedChanges detects tracked worktree changes', () => {
	const statuses = [
		' M src/cli.ts',
		'M  src/cli.ts',
		'D  src/cli.ts',
		'R  old.ts -> new.ts',
		'UU src/cli.ts',
		' M src/cli.ts\n?? scratch.txt',
	];

	assertEquals(
		statuses.map((status) => hasTrackedChanges(status)),
		[true, true, true, true, true, true],
	);
});

interface CliResult {
	readonly code: number;
	readonly stderr: string;
	readonly stdout: string;
}

async function runCli(arguments_: readonly string[]): Promise<CliResult> {
	const stderr = new MemoryTextStream();
	const stdout = new MemoryTextStream();
	const code = await main(arguments_, { stderr, stdout });

	return {
		code,
		stderr: stderr.toString(),
		stdout: stdout.toString(),
	};
}

class MemoryTextStream {
	readonly #chunks: string[] = [];

	write(chunk: string): void {
		this.#chunks.push(chunk);
	}

	toString(): string {
		return this.#chunks.join('');
	}
}

function parseJsonLines(value: string): readonly unknown[] {
	return value
		.trimEnd()
		.split('\n')
		.map((line) => JSON.parse(line) as unknown);
}

function normaliseEventDurations(
	events: readonly unknown[],
): readonly unknown[] {
	return events.map((event) => {
		if (!isRecord(event) || event.event !== 'phase') {
			return event;
		}

		return {
			...event,
			durationMs: typeof event.durationMs,
		};
	});
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}
