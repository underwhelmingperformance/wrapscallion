import { assertEquals, assertThrows } from '@std/assert';

import { InvalidIgnorePatternError } from './cli-errors.ts';
import { IgnoreMatcher } from './ignore-matcher.ts';

Deno.test('an empty matcher ignores nothing', () => {
	const matcher = IgnoreMatcher.compile([]);

	assertEquals(matcher.matches('chore(main): release 1.2.3'), false);
});

Deno.test('a matcher ignores subjects matching any pattern', () => {
	const matcher = IgnoreMatcher.compile([
		'^chore\\(main\\): release ',
		'^Release ',
	]);

	const subjects = [
		'chore(main): release 1.2.3',
		'Release 1.2.3',
		'feat: add a feature',
	];

	assertEquals(
		subjects.map((subject) => matcher.matches(subject)),
		[true, true, false],
	);
});

Deno.test('patterns are unanchored regular expressions', () => {
	const matcher = IgnoreMatcher.compile(['release']);

	assertEquals(matcher.matches('chore: cut a release'), true);
});

// RE2 rejects the catastrophic-backtracking constructs (backreferences and
// lookaround) that a backtracking engine would accept, so these are reported
// as invalid patterns.
const invalidPatterns = [
	'(unterminated',
	'(a)\\1',
	'(?=lookahead)',
];

for (const pattern of invalidPatterns) {
	Deno.test(`the pattern ${pattern} is reported with its source`, () => {
		const error = assertThrows(
			() => IgnoreMatcher.compile([pattern]),
			InvalidIgnorePatternError,
		);

		assertEquals(error.pattern, pattern);
	});
}
