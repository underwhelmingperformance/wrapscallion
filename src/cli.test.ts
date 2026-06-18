import { assertEquals, assertStringIncludes } from '@std/assert';

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
				'  --output-format <format>  output format (choices: "terminal", "json",',
				'                            "github")',
				'  --colour                  force ANSI colour (overrides NO_COLOR)',
				'  --no-colour               disable ANSI colour (overrides FORCE_COLOR)',
				'  --dry-run                 show what --reword would change without moving refs',
				'  --edit <file>             lint a commit message file, for commit-msg hooks',
				'  --from <revision>         lint commits after this revision',
				'  --ignore <pattern>        skip commits whose subject matches this regular',
				'                            expression (repeatable)',
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
						skipped: [],
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

Deno.test(
	'wrapscallion emits GitHub annotations and a readable report in github mode',
	async () => {
		const directory = await Deno.makeTempDir({
			prefix: 'wrapscallion-github-',
		});

		try {
			const messageFile = `${directory}/COMMIT_EDITMSG`;
			await Deno.writeTextFile(messageFile, 'not conventional\n');
			const result = await runCli([
				'--edit',
				messageFile,
				'--output-format',
				'github',
				'--no-colour',
			]);

			assertEquals({
				code: result.code,
				stderr: normaliseDurations(result.stderr),
				stdout: result.stdout,
			}, {
				code: 1,
				stderr: [
					'ok Checking commit messages · messages 1 (TIME)',
					'Wrapscallion failed for 1 commit message out of 1.',
					'',
					`${messageFile} not conventional`,
					'  x subject-empty: subject may not be empty',
					'  x type-empty: type may not be empty',
					'',
				].join('\n'),
				stdout: [
					`::error title=${messageFile} not conventional::` +
					'subject-empty: subject may not be empty%0A' +
					'type-empty: type may not be empty',
					'',
				].join('\n'),
			});
		} finally {
			await Deno.remove(directory, { recursive: true });
		}
	},
);

Deno.test(
	'a commit whose subject matches --ignore is skipped, not failed',
	async () => {
		await withCommitMessage('chore(main): release 1.2.3\n', async (file) => {
			const result = await runCli([
				'--edit',
				file,
				'--ignore',
				'^chore\\(main\\): release ',
			]);

			assertEquals({
				code: result.code,
				events: normaliseEventDurations(parseJsonLines(result.stderr)),
				stdout: result.stdout,
			}, {
				code: 0,
				events: [
					{
						durationMs: 'number',
						event: 'phase',
						facts: { messages: '1', skipped: '1' },
						label: 'Checking commit messages',
						status: 'ok',
					},
					{
						event: 'wrapscallion',
						failures: [],
						skipped: [{ commit: file, subject: 'chore(main): release 1.2.3' }],
						status: 'ok',
						total: 0,
					},
				],
				stdout: '',
			});
		});
	},
);

Deno.test('ignore patterns are read from the config file', async () => {
	await withCommitMessage('chore(main): release 1.2.3\n', async (file) => {
		const result = await runCli(
			['--edit', file],
			"ignore = ['^chore\\(main\\): release ']",
		);

		assertEquals({
			code: result.code,
			events: normaliseEventDurations(parseJsonLines(result.stderr)),
		}, {
			code: 0,
			events: [
				{
					durationMs: 'number',
					event: 'phase',
					facts: { messages: '1', skipped: '1' },
					label: 'Checking commit messages',
					status: 'ok',
				},
				{
					event: 'wrapscallion',
					failures: [],
					skipped: [{ commit: file, subject: 'chore(main): release 1.2.3' }],
					status: 'ok',
					total: 0,
				},
			],
		});
	});
});

Deno.test('the config file supplies a flag the command line omits', async () => {
	await withCommitMessage('not conventional\n', async (file) => {
		const result = await runCli(
			['--edit', file, '--no-colour'],
			'output-format = "github"',
		);

		assertEquals({ code: result.code, stdout: result.stdout }, {
			code: 1,
			stdout: [
				`::error title=${file} not conventional::` +
				'subject-empty: subject may not be empty%0A' +
				'type-empty: type may not be empty',
				'',
			].join('\n'),
		});
	});
});

Deno.test('a command-line flag overrides the config file', async () => {
	await withCommitMessage('not conventional\n', async (file) => {
		const result = await runCli(
			['--edit', file, '--output-format', 'json'],
			'output-format = "github"',
		);

		const events = parseJsonLines(result.stderr).filter(
			(event) => isRecord(event) && event.event === 'wrapscallion',
		);

		assertEquals({ code: result.code, events, stdout: result.stdout }, {
			code: 1,
			events: [
				{
					event: 'wrapscallion',
					failures: [
						{
							commit: file,
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
					skipped: [],
					status: 'failed',
					total: 1,
				},
			],
			stdout: '',
		});
	});
});

Deno.test('an invalid --ignore pattern is an operational error', async () => {
	await withCommitMessage('feat: add upload\n', async (file) => {
		const result = await runCli(['--edit', file, '--ignore', '(']);
		const [event] = parseJsonLines(result.stderr);

		assertEquals(result.code, 2);
		assertEquals(isRecord(event) && event.event, 'error');
		assertStringIncludes(
			isRecord(event) ? String(event.message) : '',
			'invalid ignore pattern "("',
		);
	});
});

Deno.test('a malformed config file is an operational error', async () => {
	await withCommitMessage('feat: add upload\n', async (file) => {
		const result = await runCli(['--edit', file], 'from = =');
		const [event] = parseJsonLines(result.stderr);

		assertEquals(result.code, 2);
		assertEquals(isRecord(event) && event.event, 'error');
	});
});

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

/** Runs `body` with a temporary commit message file, cleaning up afterwards. */
async function withCommitMessage(
	message: string,
	body: (file: string) => Promise<void>,
): Promise<void> {
	const directory = await Deno.makeTempDir({ prefix: 'wrapscallion-' });
	const file = `${directory}/COMMIT_EDITMSG`;
	await Deno.writeTextFile(file, message);

	try {
		await body(file);
	} finally {
		await Deno.remove(directory, { recursive: true });
	}
}

async function runCli(
	arguments_: readonly string[],
	configContents?: string,
): Promise<CliResult> {
	const stderr = new MemoryTextStream();
	const stdout = new MemoryTextStream();
	const code = await main(arguments_, {
		configReader: { read: () => Promise.resolve(configContents) },
		stderr,
		stdout,
	});

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

function normaliseDurations(value: string): string {
	return value.replaceAll(/\(\d[\d.]*m?s\)/g, '(TIME)');
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
