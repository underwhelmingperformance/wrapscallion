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

Deno.test('stripCommitMessageComments truncates the scissors line and the verbose diff below it', () => {
	const input = [
		'chore(gitignore): add .env.* to .gitignore',
		'',
		'This is going to contain an OpenRouter API key.',
		'',
		'# Please enter the commit message for your changes. Lines starting',
		"# with '#' will be ignored, and an empty message aborts the commit.",
		'#',
		'# ------------------------ >8 ------------------------',
		'# Do not modify or remove the line above.',
		'# Everything below it will be ignored.',
		'diff --git a/.gitignore b/.gitignore',
		'index 9e60b52..e0e3ca4 100644',
		'--- a/.gitignore',
		'+++ b/.gitignore',
		'@@ -24,3 +24,6 @@ vite.config.ts.timestamp-*',
		' # Playwright',
		' test-results',
		' .playwright-mcp',
		'+',
		'+# Secrets',
		'+.env.*',
		'',
	].join('\n');

	assertEquals(
		stripCommitMessageComments(input),
		'chore(gitignore): add .env.* to .gitignore\n\nThis is going to contain an OpenRouter API key.',
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
