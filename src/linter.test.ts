import pc from 'picocolors';
import { assertEquals, assertRejects, assertStrictEquals } from '@std/assert';

import {
	checkCommitMessages,
	commitBody,
	type CommitMessage,
	CommitMessageCheck,
	formatBodyPatch,
	UnchangedCommitMessageCheckError,
} from './linter.ts';
import { jsonReport, terminalFailureReport } from './report.ts';

Deno.test('checkCommitMessages accepts a conventional commit with no body', async () => {
	const reports = await checkCommitMessages([
		commitMessage('a1b2c3d4e5f6', 'feat: add upload'),
	]);

	assertEquals(
		reports.map((report) => ({
			changed: report.changed,
			findings: report.findings,
			label: report.commitMessage.label,
			passed: report.passed,
			status: report.status,
		})),
		[
			{
				changed: false,
				findings: [],
				label: 'a1b2c3d4e5f6',
				passed: true,
				status: 'passed',
			},
		],
	);
});

Deno.test(
	'checkCommitMessages throws a concrete error when a passed check is reworded',
	async () => {
		await assertRejects(
			() =>
				checkCommitMessages([
					commitMessage('a1b2c3d4e5f6', 'feat: add upload'),
				]).then((checks) => checks[0]?.rewordMessage()),
			UnchangedCommitMessageCheckError,
		);
	},
);

Deno.test(
	'checkCommitMessages inserts a blank line before a git trailer glued to the body',
	async () => {
		const [check] = await checkCommitMessages([
			commitMessage(
				'a1b2c3d4e5f6',
				[
					'fix: tidy parser',
					'',
					'This line is ordinary prose.',
					'Signed-off-by: Iain Lane <iain@orangesquash.org.uk>',
				].join('\n'),
			),
		]);

		assertEquals({
			changed: check?.changed,
			fixedMessage: check?.fixedMessage,
			status: check?.status,
		}, {
			changed: true,
			fixedMessage: [
				'fix: tidy parser',
				'',
				'This line is ordinary prose.',
				'',
				'Signed-off-by: Iain Lane <iain@orangesquash.org.uk>',
			].join('\n'),
			status: 'fixable',
		});
	},
);

Deno.test(
	'checkCommitMessages separates a glued trailer run that contains a recognised trailer',
	async () => {
		const [check] = await checkCommitMessages([
			commitMessage(
				'a1b2c3d4e5f6',
				[
					'feat: pair on the parser',
					'',
					'Tidy the trailer handling.',
					'Co-authored-by: Alice Example <alice@example.test>',
					'Signed-off-by: Iain Lane <iain@orangesquash.org.uk>',
				].join('\n'),
			),
		]);

		assertEquals({
			changed: check?.changed,
			fixedMessage: check?.fixedMessage,
			status: check?.status,
		}, {
			changed: true,
			fixedMessage: [
				'feat: pair on the parser',
				'',
				'Tidy the trailer handling.',
				'',
				'Co-authored-by: Alice Example <alice@example.test>',
				'Signed-off-by: Iain Lane <iain@orangesquash.org.uk>',
			].join('\n'),
			status: 'fixable',
		});
	},
);

Deno.test(
	'checkCommitMessages leaves a correctly separated trailer block unchanged',
	async () => {
		const message = [
			'fix: tidy parser',
			'',
			'This line is ordinary prose.',
			'',
			'Signed-off-by: Iain Lane <iain@orangesquash.org.uk>',
		].join('\n');

		const [check] = await checkCommitMessages([
			commitMessage('a1b2c3d4e5f6', message),
		]);

		assertEquals({
			changed: check?.changed,
			fixedMessage: check?.fixedMessage,
			status: check?.status,
		}, {
			changed: false,
			fixedMessage: message,
			status: 'passed',
		});
	},
);

Deno.test('checkCommitMessages enforces a 72-column body line limit', async () => {
	const reports = await checkCommitMessages([
		commitMessage(
			'a1b2c3d4e5f6',
			[
				'fix: tighten validation',
				'',
				'This line is deliberately longer than seventy two columns but still under one hundred.',
			].join('\n'),
		),
	]);

	assertEquals(reports[0]?.findings, [
		{
			kind: 'body-format',
			actual:
				'This line is deliberately longer than seventy two columns but still under one hundred.\n',
			expected:
				'This line is deliberately longer than seventy two columns but still\nunder one hundred.\n',
			fixable: true,
			message: 'body is not wrapped to 72 columns',
			patch: formatBodyPatch(
				'This line is deliberately longer than seventy two columns but still under one hundred.\n',
				'This line is deliberately longer than seventy two columns but still\nunder one hundred.\n',
			),
			rule: 'body-format',
		},
	]);
});

Deno.test('checkCommitMessages shows the diff after Markdown-aware wrapping', async () => {
	const reports = await checkCommitMessages([
		commitMessage(
			'a1b2c3d4e5f6',
			[
				'docs: explain commit linting',
				'',
				'Short paragraph with trailing spaces.   ',
				'',
				'An unwrapped paragraph with enough words to exceed the configured seventy two column width so the reflower must wrap it.',
			].join('\n'),
		),
	]);

	const finding = reports[0]?.findings.find((failure) =>
		failure.message.startsWith('body is not wrapped')
	);

	assertEquals(finding, {
		kind: 'body-format',
		actual: [
			'Short paragraph with trailing spaces.   ',
			'',
			'An unwrapped paragraph with enough words to exceed the configured seventy two column width so the reflower must wrap it.',
			'',
		].join('\n'),
		expected: [
			'Short paragraph with trailing spaces.',
			'',
			'An unwrapped paragraph with enough words to exceed the configured',
			'seventy two column width so the reflower must wrap it.',
			'',
		].join('\n'),
		fixable: true,
		message: 'body is not wrapped to 72 columns',
		patch: formatBodyPatch(
			[
				'Short paragraph with trailing spaces.   ',
				'',
				'An unwrapped paragraph with enough words to exceed the configured seventy two column width so the reflower must wrap it.',
				'',
			].join('\n'),
			[
				'Short paragraph with trailing spaces.',
				'',
				'An unwrapped paragraph with enough words to exceed the configured',
				'seventy two column width so the reflower must wrap it.',
				'',
			].join('\n'),
		),
		rule: 'body-format',
	});
});

Deno.test(
	'checkCommitMessages produces a reworded message that passes the same linter',
	async () => {
		const [check] = await checkCommitMessages([
			commitMessage(
				'a1b2c3d4e5f6',
				[
					'docs: explain commit linting',
					'',
					'Short paragraph with trailing spaces. ',
					'',
					'An unwrapped paragraph with enough words to exceed the configured seventy two column width so the reflower must wrap it.',
				].join('\n'),
			),
		]);

		const fixedMessage = check?.rewordMessage();
		const [fixedCheck] = await checkCommitMessages([
			commitMessage('a1b2c3d4e5f6', fixedMessage ?? ''),
		]);

		assertEquals({
			fixedMessage,
			status: fixedCheck?.status,
		}, {
			fixedMessage: [
				'docs: explain commit linting',
				'',
				'Short paragraph with trailing spaces.',
				'',
				'An unwrapped paragraph with enough words to exceed the configured',
				'seventy two column width so the reflower must wrap it.',
			].join('\n'),
			status: 'passed',
		});
	},
);

Deno.test('checkCommitMessages does not reflow git trailers into the body', async () => {
	const reports = await checkCommitMessages([
		commitMessage(
			'a1b2c3d4e5f6',
			[
				'fix: keep trailers intact',
				'',
				'This body needs wrapping because it is longer than the configured seventy two column width for commit message prose.',
				'',
				'Co-authored-by: Alice Example <alice@example.com>',
				'Signed-off-by: Iain Lane <iain@orangesquash.org.uk>',
			].join('\n'),
		),
	]);

	assertEquals(
		reports.map((report) => ({
			failures: report.findings,
			fixedMessage: report.fixedMessage,
			status: report.status,
		})),
		[
			{
				failures: [
					{
						kind: 'body-format',
						actual:
							'This body needs wrapping because it is longer than the configured seventy two column width for commit message prose.\n',
						expected:
							'This body needs wrapping because it is longer than the configured\n' +
							'seventy two column width for commit message prose.\n',
						fixable: true,
						message: 'body is not wrapped to 72 columns',
						patch: formatBodyPatch(
							'This body needs wrapping because it is longer than the configured seventy two column width for commit message prose.\n',
							'This body needs wrapping because it is longer than the configured\n' +
								'seventy two column width for commit message prose.\n',
						),
						rule: 'body-format',
					},
				],
				fixedMessage: [
					'fix: keep trailers intact',
					'',
					'This body needs wrapping because it is longer than the configured',
					'seventy two column width for commit message prose.',
					'',
					'Co-authored-by: Alice Example <alice@example.com>',
					'Signed-off-by: Iain Lane <iain@orangesquash.org.uk>',
				].join('\n'),
				status: 'fixable',
			},
		],
	);
});

Deno.test(
	'checkCommitMessages exempts unknown trailer-like final blocks from body checks',
	async () => {
		const reports = await checkCommitMessages([
			commitMessage(
				'a1b2c3d4e5f6',
				[
					'docs: explain external issue',
					'',
					'Issue: PROJECT-123 with a deliberately long value that should remain trailer text rather than being wrapped.',
					'Reviewed-on: https://example.com/reviews/1234567890',
				].join('\n'),
			),
		]);

		assertEquals(
			reports.map((report) => ({
				failures: report.findings,
				fixedMessage: report.fixedMessage,
				status: report.status,
			})),
			[
				{
					failures: [],
					fixedMessage: [
						'docs: explain external issue',
						'',
						'Issue: PROJECT-123 with a deliberately long value that should remain trailer text rather than being wrapped.',
						'Reviewed-on: https://example.com/reviews/1234567890',
					].join('\n'),
					status: 'passed',
				},
			],
		);
	},
);

Deno.test('checkCommitMessages preserves folded git trailers', async () => {
	const reports = await checkCommitMessages([
		commitMessage(
			'a1b2c3d4e5f6',
			[
				'fix: keep folded trailers intact',
				'',
				'This body needs wrapping because it is longer than the configured seventy two column width for commit message prose.',
				'',
				'Co-authored-by: Alice Example',
				' <alice@example.com>',
				'Signed-off-by: Iain Lane <iain@orangesquash.org.uk>',
			].join('\n'),
		),
	]);

	assertEquals(
		reports.map((report) => ({
			fixedMessage: report.fixedMessage,
			status: report.status,
		})),
		[
			{
				fixedMessage: [
					'fix: keep folded trailers intact',
					'',
					'This body needs wrapping because it is longer than the configured',
					'seventy two column width for commit message prose.',
					'',
					'Co-authored-by: Alice Example',
					' <alice@example.com>',
					'Signed-off-by: Iain Lane <iain@orangesquash.org.uk>',
				].join('\n'),
				status: 'fixable',
			},
		],
	);
});

Deno.test(
	'checkCommitMessages does not mark a changed body as fixable when markdownlint still fails',
	async () => {
		const reports = await checkCommitMessages([
			commitMessage(
				'a1b2c3d4e5f6',
				[
					'docs: explain duplicate headings',
					'',
					'## Details',
					'',
					'This body paragraph is deliberately longer than seventy two columns so the reflower changes it.',
					'',
					'## Details',
				].join('\n'),
			),
		]);

		assertEquals(
			reports.map((report) => ({
				failures: report.findings.map((failure) => ({
					fixable: failure.fixable,
					message: failure.message,
					rule: failure.rule,
				})),
				status: report.status,
			})),
			[
				{
					failures: [
						{
							fixable: false,
							message: 'body is not wrapped to 72 columns',
							rule: 'body-format',
						},
						{
							fixable: false,
							message:
								'body line 6 MD024/no-duplicate-heading: Multiple headings with the same content [Details]',
							rule: 'MD024',
						},
					],
					status: 'failed',
				},
			],
		);
	},
);

Deno.test(
	'checkCommitMessages does not apply markdownlint defaults to commit bodies',
	async () => {
		const reports = await checkCommitMessages([
			commitMessage(
				'a1b2c3d4e5f6',
				[
					'docs: keep common markdown',
					'',
					'See https://example.com/change for details.',
					'',
					'```',
					'plain text',
					'```',
				].join('\n'),
			),
		]);

		assertEquals(
			reports.map((report) => ({
				failures: report.findings,
				status: report.status,
			})),
			[
				{
					failures: [],
					status: 'passed',
				},
			],
		);
	},
);

Deno.test(
	'checkCommitMessages preserves prose punctuation while wrapping the body',
	async () => {
		const reports = await checkCommitMessages([
			commitMessage(
				'a1b2c3d4e5f6',
				[
					'fix: preserve prose characters',
					'',
					'Keep the updated *.ts glob, _private marker, and [draft] label intact while wrapping this prose paragraph.',
				].join('\n'),
			),
		]);

		assertEquals(
			reports.map((report) => ({
				failures: report.findings,
				fixedMessage: report.fixedMessage,
				status: report.status,
			})),
			[
				{
					failures: [
						{
							kind: 'body-format',
							actual:
								'Keep the updated *.ts glob, _private marker, and [draft] label intact while wrapping this prose paragraph.\n',
							expected:
								'Keep the updated *.ts glob, _private marker, and [draft] label intact\n' +
								'while wrapping this prose paragraph.\n',
							fixable: true,
							message: 'body is not wrapped to 72 columns',
							patch: formatBodyPatch(
								'Keep the updated *.ts glob, _private marker, and [draft] label intact while wrapping this prose paragraph.\n',
								'Keep the updated *.ts glob, _private marker, and [draft] label intact\n' +
									'while wrapping this prose paragraph.\n',
							),
							rule: 'body-format',
						},
					],
					fixedMessage: [
						'fix: preserve prose characters',
						'',
						'Keep the updated *.ts glob, _private marker, and [draft] label intact',
						'while wrapping this prose paragraph.',
					].join('\n'),
					status: 'fixable',
				},
			],
		);
	},
);

Deno.test(
	'checkCommitMessages treats numbered Markdown body entries as body prose',
	async () => {
		const [report] = await checkCommitMessages([
			commitMessage('b3d358ec0b65', pm5mCommitMessage()),
		]);

		const ruleFindings = report?.findings
			.filter((finding) => finding.kind === 'rule')
			.map((finding) => ({
				message: finding.message,
				rule: finding.rule,
			}));

		assertEquals(ruleFindings, []);
	},
);

Deno.test(
	'checkCommitMessages returns a separate report for each commit message',
	async () => {
		const reports = await checkCommitMessages([
			commitMessage('111111111111', 'feat: add cache check'),
			commitMessage('222222222222', 'not conventional'),
		]);

		assertEquals(
			reports.map((report) => ({
				failures: report.findings.map((failure) => failure.message),
				label: report.commitMessage.label,
				subject: report.commitMessage.subject,
			})),
			[
				{
					failures: [],
					label: '111111111111',
					subject: 'feat: add cache check',
				},
				{
					failures: [
						'subject-empty: subject may not be empty',
						'type-empty: type may not be empty',
					],
					label: '222222222222',
					subject: 'not conventional',
				},
			],
		);
	},
);

Deno.test('commitBody strips the subject and surrounding blank lines', () => {
	assertStrictEquals(
		commitBody(
			['feat: add cache check', '', '', 'This is the body.', '', ''].join(
				'\n',
			),
		),
		'This is the body.\n',
	);
});

Deno.test('jsonReport emits only failing commits in the machine-readable report', () => {
	assertEquals(
		jsonReport('failed', [
			new CommitMessageCheck(
				commitMessage('111111111111', 'feat: add cache check'),
				'feat: add cache check',
				'feat: add cache check',
				[],
			),
			new CommitMessageCheck(
				commitMessage('222222222222', 'not conventional'),
				'not conventional',
				'not conventional',
				[
					{
						kind: 'rule',
						fixable: false,
						message: 'type-empty: type may not be empty',
						rule: 'type-empty',
					},
				],
			),
		]),
		{
			event: 'wrapscallion',
			failures: [
				{
					commit: '222222222222',
					findings: [
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
			total: 2,
		},
	);
});

Deno.test('terminalFailureReport includes the failing commit and body diff', () => {
	assertStrictEquals(
		terminalFailureReport(
			[
				new CommitMessageCheck(
					commitMessage('222222222222', 'docs: explain commit linting'),
					'docs: explain commit linting',
					'docs: explain commit linting',
					[
						{
							kind: 'body-format',
							actual: 'too long\n',
							expected: 'wrapped\n',
							fixable: true,
							message: 'body is not wrapped to 72 columns',
							patch: formatBodyPatch('too long\n', 'wrapped\n'),
							rule: 'body-format',
						},
					],
				),
			],
			2,
			pc.createColors(false),
		),
		[
			'Wrapscallion failed for 1 commit message out of 2.',
			'',
			'222222222222 docs: explain commit linting',
			'  x body is not wrapped to 72 columns',
			'    Index: commit-body.md',
			'    ===================================================================',
			'    --- commit-body.md\tactual',
			'    +++ commit-body.md\tcheck',
			'    @@ -1,1 +1,1 @@',
			'    -too long',
			'    +wrapped',
		].join('\n'),
	);
});

function commitMessage(label: string, message: string): CommitMessage {
	return {
		label,
		message,
		subject: message.split('\n', 1)[0] ?? '',
	};
}

function pm5mCommitMessage(): string {
	return [
		'feat(tui): picker selection marker, footer priority, and filter affordance',
		'',
		'Five picker/footer/summary improvements that were each individually small',
		'but together lift the UX parity of the Events picker to match the live',
		"view's polish.",
		'',
		'1. Picker selection highlight: the focused event row now carries a ▸ marker',
		'   via Table::highlight_symbol, matching the market-list convention. Focus',
		'   was previously signalled only by the accent foreground colour, which is',
		'   invisible on terminals without true-colour support and easy to miss even',
		'   with it.',
		'',
		'2. Picker Esc description: the binding label is now a single state-dependent',
		'   word -- "clear" while the filter holds text (Esc clears it), "back" when',
		'   the picker is pushed over another screen, and "quit" when it is the root.',
		'   The previous "clear / back" / "clear / quit" compound descriptions',
		'   contained "/" which the footer uses as its key-join separator, corrupting',
		'   the rendered footer cell.',
		'',
		'3. Footer priority: help and quit are now prepended to the composed binding',
		'   list instead of appended. The footer drops groups from the right when the',
		'   terminal is narrow, so leading groups are the last to disappear. Help and',
		'   quit are the two most important global bindings, so they must not be the',
		'   first to go.',
		'',
		'4. Summary strip warning count: parse errors, reconnects, stale drops, and',
		'   disconnects are now counted in DiagnosticsModel and propagated to the',
		'   summary strip. When non-zero, a "warn N" pair appears in the strip styled',
		'   with the warn token, nudging the user to open the diagnostics pane without',
		'   being alarming at zero.',
		'',
		'5. Picker filter affordance: the search box now shows a muted',
		'   "/ filter · #tag · paste a URL" placeholder when the filter is idle and',
		'   empty, so the activation gesture is discoverable. Additionally, whenever',
		'   the filter text parses as a valid EventInput (slug or URL), an',
		'   "enter → open" line appears in the search box regardless of how many list',
		'   matches exist, keeping the direct-open passthrough visible.',
	].join('\n');
}
