import { Writable } from 'node:stream';

import pc from 'picocolors';
import {
	assertEquals,
	assertRejects,
	assertStrictEquals,
	assertStringIncludes,
} from '@std/assert';

import { createReporter } from './reporter.ts';

const colours = pc.createColors(false);

function captureStream(): { stream: Writable; lines: () => string[] } {
	const chunks: string[] = [];

	const stream = new Writable({
		write(chunk: Buffer | string, _encoding, callback) {
			chunks.push(chunk.toString());
			callback();
		},
	});

	return {
		stream,
		lines: () =>
			chunks
				.join('')
				.split('\n')
				.filter((line) => line !== ''),
	};
}

Deno.test(
	'createReporter json mode emits a successful phase with facts and returns the body value',
	async () => {
		const { stream, lines } = captureStream();
		const reporter = createReporter({ mode: 'json', colours, stream });

		const value = await reporter.phase('Checking commit messages', (phase) => {
			phase.fact('messages', 3);

			return 'done';
		});

		const events = lines().map(
			(line) => JSON.parse(line) as Record<string, unknown>,
		);

		assertStrictEquals(value, 'done');
		assertEquals(normaliseEventDurations(events), [
			{
				event: 'phase',
				label: 'Checking commit messages',
				status: 'ok',
				durationMs: 'number',
				facts: { messages: '3' },
			},
		]);
	},
);

Deno.test('createReporter json mode emits a failed phase and rethrows', async () => {
	const { stream, lines } = captureStream();
	const reporter = createReporter({ mode: 'json', colours, stream });
	const failure = new Error('boom');

	const error = await assertRejects(() =>
		reporter.phase('Rewording commit messages', () => {
			throw failure;
		})
	);

	const events = lines().map(
		(line) => JSON.parse(line) as Record<string, unknown>,
	);

	assertStrictEquals(error, failure);
	assertEquals(normaliseEventDurations(events), [
		{
			event: 'phase',
			label: 'Rewording commit messages',
			status: 'failed',
			durationMs: 'number',
			error: 'boom',
		},
	]);
});

function normaliseEventDurations(
	events: readonly Record<string, unknown>[],
): readonly Record<string, unknown>[] {
	return events.map((event) => ({
		...event,
		durationMs: typeof event.durationMs,
	}));
}

Deno.test(
	'createReporter terminal mode writes the phase label and returns the body value',
	async () => {
		const { stream, lines } = captureStream();
		const reporter = createReporter({ mode: 'terminal', colours, stream });

		const value = await reporter.phase('Checking commit messages', (phase) => {
			phase.fact('messages', 1);

			return 42;
		});

		assertStrictEquals(value, 42);
		assertStringIncludes(lines().join('\n'), 'Checking commit messages');
	},
);
