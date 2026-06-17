import { assertEquals } from '@std/assert';

import { githubAnnotations } from './github.ts';
import { CommitMessageCheck, type Finding } from './linter.ts';

function check(
	label: string,
	subject: string,
	findings: readonly Finding[],
): CommitMessageCheck {
	const message = `${subject}\n`;

	return new CommitMessageCheck(
		{ label, message, subject },
		message,
		message,
		findings,
	);
}

const ruleFinding: Finding = {
	kind: 'rule',
	fixable: false,
	message: 'subject-empty: subject may not be empty',
	rule: 'subject-empty',
};

const bodyFinding: Finding = {
	kind: 'rule',
	fixable: true,
	message: 'body is not wrapped to 72 columns',
	rule: 'body-format',
};

Deno.test('githubAnnotations emits one error command per failing commit', () => {
	const annotations = githubAnnotations([
		check('abc123', 'feat: do a thing', [ruleFinding, bodyFinding]),
		check('def456', 'fix: another thing', [bodyFinding]),
	]);

	assertEquals(annotations, [
		'::error title=abc123 feat%3A do a thing::subject-empty: subject may not be empty%0Abody is not wrapped to 72 columns',
		'::error title=def456 fix%3A another thing::body is not wrapped to 72 columns',
	]);
});

Deno.test('githubAnnotations escapes reserved characters in the title and message', () => {
	const annotations = githubAnnotations([
		check('abc123', 'feat: 100% done, maybe', [{
			kind: 'rule',
			fixable: false,
			message: 'line one\nline two with 50%',
			rule: 'demo',
		}]),
	]);

	assertEquals(annotations, [
		'::error title=abc123 feat%3A 100%25 done%2C maybe::line one%0Aline two with 50%25',
	]);
});
