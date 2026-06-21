import { assertEquals } from '@std/assert';

import {
	type OutputEnvironment,
	type OutputPreferences,
	resolveOutput,
} from './reporter-mode.ts';

interface ResolveCase {
	readonly name: string;
	readonly preferences: OutputPreferences;
	readonly environment: OutputEnvironment;
	readonly expected: { readonly format: string; readonly colour: boolean };
}

const cases: readonly ResolveCase[] = [
	{
		name: 'an explicit format wins over the environment',
		preferences: { format: 'json', colour: true },
		environment: { isTerminal: true, githubActions: true },
		expected: { format: 'json', colour: false },
	},
	{
		name: 'JSON output is never coloured, even when colour is forced',
		preferences: { format: 'json', colour: true },
		environment: { isTerminal: false, githubActions: false },
		expected: { format: 'json', colour: false },
	},
	{
		name: 'a terminal stream selects the terminal format',
		preferences: { colour: true },
		environment: { isTerminal: true, githubActions: false },
		expected: { format: 'terminal', colour: true },
	},
	{
		name: 'a non-terminal stream falls back to JSON',
		preferences: { colour: false },
		environment: { isTerminal: false, githubActions: false },
		expected: { format: 'json', colour: false },
	},
	{
		name: 'GitHub Actions selects the github format',
		preferences: { colour: false },
		environment: { isTerminal: false, githubActions: true },
		expected: { format: 'github', colour: false },
	},
	{
		name: 'GitHub Actions takes precedence over a terminal stream',
		preferences: { colour: true },
		environment: { isTerminal: true, githubActions: true },
		expected: { format: 'github', colour: true },
	},
];

for (const { name, preferences, environment, expected } of cases) {
	Deno.test(`resolveOutput: ${name}`, () => {
		const { format, colours } = resolveOutput(preferences, environment);

		assertEquals(
			{ format, colour: colours.isColorSupported },
			expected,
		);
	});
}
