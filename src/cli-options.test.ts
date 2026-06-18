import { assertEquals, assertThrows } from '@std/assert';

import { ConfigFileError } from './cli-errors.ts';
import { type ParsedCommand, parseOptions } from './cli-options.ts';

const configPath = '/repo/.wrapscallion.toml';

Deno.test('command-line arguments parse into a range command', () => {
	const result = parse(['--from', 'origin/main']);

	const expected: ParsedCommand = {
		ignore: [],
		options: {
			dryRun: false,
			from: 'origin/main',
			kind: 'range',
			reword: false,
			to: 'HEAD',
		},
		output: { colour: undefined, format: undefined },
	};

	assertEquals(result, expected);
});

Deno.test('the config file supplies flags the command line omits', () => {
	const result = parse([], {
		colour: true,
		from: 'origin/main',
		'output-format': 'github',
		ignore: ['^chore\\(main\\): release '],
	});

	const expected: ParsedCommand = {
		ignore: ['^chore\\(main\\): release '],
		options: {
			dryRun: false,
			from: 'origin/main',
			kind: 'range',
			reword: false,
			to: 'HEAD',
		},
		output: { colour: true, format: 'github' },
	};

	assertEquals(result, expected);
});

Deno.test('a command-line flag overrides the same setting in the config file', () => {
	const result = parse(['--from', 'origin/main', '--to', 'HEAD~2'], {
		'output-format': 'github',
		to: 'HEAD~5',
	});

	const expected: ParsedCommand = {
		ignore: [],
		options: {
			dryRun: false,
			from: 'origin/main',
			kind: 'range',
			reword: false,
			to: 'HEAD~2',
		},
		output: { colour: undefined, format: 'github' },
	};

	assertEquals(result, expected);
});

Deno.test('a command-line --ignore replaces the config file patterns', () => {
	const result = parse(['--from', 'origin/main', '--ignore', 'b'], {
		ignore: ['a'],
	});

	assertEquals(result.ignore, ['b']);
});

Deno.test('the config file can select edit mode', () => {
	const result = parse([], { edit: 'COMMIT_EDITMSG' });

	const expected: ParsedCommand = {
		ignore: [],
		options: { file: 'COMMIT_EDITMSG', kind: 'edit' },
		output: { colour: undefined, format: undefined },
	};

	assertEquals(result, expected);
});

const rejections = [
	{
		name: 'an unknown setting',
		values: { nope: true },
		message: 'unknown setting: nope',
	},
	{
		name: 'a string flag given a number',
		values: { from: 3 },
		message: 'from must be a string',
	},
	{
		name: 'a boolean flag given a string',
		values: { 'dry-run': 'yes' },
		message: 'dry-run must be a boolean',
	},
	{
		name: 'an unknown output format',
		values: { 'output-format': 'fancy' },
		message: 'output-format must be one of',
	},
	{
		name: 'a non-string ignore entry',
		values: { ignore: ['ok', 3] },
		message: 'ignore must be an array of strings',
	},
];

for (const { name, values, message } of rejections) {
	Deno.test(`the config file rejects ${name}`, () => {
		assertThrows(
			() => parse(['--from', 'origin/main'], values),
			ConfigFileError,
			message,
		);
	});
}

Deno.test('a config value is validated even when the command line overrides it', () => {
	assertThrows(
		() => parse(['--from', 'origin/main'], { from: 3 }),
		ConfigFileError,
		'from must be a string',
	);
});

Deno.test('a config-set dry run still requires rewording', () => {
	assertThrows(
		() => parse([], { from: 'origin/main', 'dry-run': true }),
		Error,
		'--dry-run requires --reword',
	);
});

function parse(
	arguments_: readonly string[],
	values?: Record<string, unknown>,
): ParsedCommand {
	return parseOptions(
		arguments_,
		{ stderr: new MemoryTextStream(), stdout: new MemoryTextStream() },
		values === undefined ? undefined : { path: configPath, values },
	);
}

class MemoryTextStream {
	write(): void {}
}
