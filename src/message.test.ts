import { assertEquals } from '@std/assert';

import {
	CommitMessageDocument,
	commitSubject,
	normaliseLineEndings,
	stripCommitMessageComments,
} from './message.ts';

Deno.test('normaliseLineEndings converts CRLF and lone CR to LF', () => {
	assertEquals(
		['a\r\nb\rc', 'plain\n'].map((value) => normaliseLineEndings(value)),
		['a\nb\nc', 'plain\n'],
	);
});

Deno.test('commitSubject returns the first line regardless of line endings', () => {
	assertEquals(
		['feat: add upload\n\nbody', 'fix: tidy\r\nbody'].map((value) =>
			commitSubject(value)
		),
		['feat: add upload', 'fix: tidy'],
	);
});

Deno.test('stripCommitMessageComments drops comment lines and trailing blanks', () => {
	const cases = [
		{
			input: 'feat: x\n\nBody line.\n# please enter the message\n#another\n',
			expected: 'feat: x\n\nBody line.',
		},
		{
			input: 'feat: x\r\n\r\n# comment\r\nBody.\r\n',
			expected: 'feat: x\n\nBody.',
		},
	];

	assertEquals(
		cases.map((testCase) => stripCommitMessageComments(testCase.input)),
		cases.map((testCase) => testCase.expected),
	);
});

Deno.test('CommitMessageDocument keeps a BREAKING CHANGE footer out of the body', () => {
	const footers = ['BREAKING CHANGE', 'BREAKING-CHANGE'];

	const documents = footers.map((key) =>
		CommitMessageDocument.parse(
			`feat: x\n\nA short body.\n\n${key}: the public API was removed entirely.`,
		)
	);

	assertEquals(
		documents.map((document) => ({
			body: document.body,
			separatorMissing: document.separatorMissing,
			trailers: document.trailers,
		})),
		footers.map((key) => ({
			body: 'A short body.\n',
			separatorMissing: false,
			trailers: [`${key}: the public API was removed entirely.`],
		})),
	);
});
