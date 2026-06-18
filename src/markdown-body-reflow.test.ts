import { assertEquals, assertStrictEquals } from '@std/assert';

import {
	MarkdownBodyReflow,
	MarkdownBodyReflower,
} from './markdown-body-reflow.ts';
import { CommitMessageDocument } from './message.ts';

Deno.test('CommitMessageDocument splits prose from git trailers', () => {
	const document = CommitMessageDocument.parse(
		[
			'feat: add collaboration',
			'',
			'Explain the change.',
			'',
			'Co-authored-by: Alice Example <alice@example.com>',
			'Signed-off-by: Iain Lane <iain@orangesquash.org.uk>',
		].join('\n'),
	);

	assertEquals(documentFields(document), {
		body: 'Explain the change.\n',
		separatorMissing: false,
		subject: 'feat: add collaboration',
		trailers: [
			'Co-authored-by: Alice Example <alice@example.com>',
			'Signed-off-by: Iain Lane <iain@orangesquash.org.uk>',
		],
	});
});

Deno.test(
	'CommitMessageDocument treats unknown trailer-like final blocks as git trailers',
	() => {
		const document = CommitMessageDocument.parse(
			[
				'docs: explain external issue',
				'',
				'Explain the change.',
				'',
				'Issue: PROJECT-123',
				'Reviewed-on: https://example.com/review/123',
			].join('\n'),
		);

		assertEquals(documentFields(document), {
			body: 'Explain the change.\n',
			separatorMissing: false,
			subject: 'docs: explain external issue',
			trailers: [
				'Issue: PROJECT-123',
				'Reviewed-on: https://example.com/review/123',
			],
		});
	},
);

Deno.test(
	'CommitMessageDocument recognises a cherry-pick line as part of a trailer block',
	() => {
		const document = CommitMessageDocument.parse(
			[
				'fix: thing',
				'',
				'Explain the change.',
				'',
				'Signed-off-by: Iain Lane <iain@orangesquash.org.uk>',
				'(cherry picked from commit abc1234567)',
			].join('\n'),
		);

		assertEquals(documentFields(document), {
			body: 'Explain the change.\n',
			separatorMissing: false,
			subject: 'fix: thing',
			trailers: [
				'Signed-off-by: Iain Lane <iain@orangesquash.org.uk>',
				'(cherry picked from commit abc1234567)',
			],
		});
	},
);

Deno.test('CommitMessageDocument keeps mixed final blocks in the prose body', () => {
	const document = CommitMessageDocument.parse(
		[
			'docs: explain warning',
			'',
			'Warning: this paragraph starts like a trailer.',
			'This line makes the final block ordinary prose.',
		].join('\n'),
	);

	assertEquals(documentFields(document), {
		body: [
			'Warning: this paragraph starts like a trailer.',
			'This line makes the final block ordinary prose.',
			'',
		].join('\n'),
		separatorMissing: false,
		subject: 'docs: explain warning',
		trailers: [],
	});
});

Deno.test(
	'CommitMessageDocument keeps folded git trailers out of the prose body',
	() => {
		const document = CommitMessageDocument.parse(
			[
				'feat: add collaboration',
				'',
				'Explain the change.',
				'',
				'Co-authored-by: Alice Example',
				' <alice@example.com>',
				'Signed-off-by: Iain Lane <iain@orangesquash.org.uk>',
			].join('\n'),
		);

		assertEquals(documentFields(document), {
			body: 'Explain the change.\n',
			separatorMissing: false,
			subject: 'feat: add collaboration',
			trailers: [
				'Co-authored-by: Alice Example',
				' <alice@example.com>',
				'Signed-off-by: Iain Lane <iain@orangesquash.org.uk>',
			],
		});
	},
);

Deno.test(
	'CommitMessageDocument rebuilds messages without reflowing trailers into prose',
	() => {
		const document = CommitMessageDocument.parse(
			[
				'feat: add collaboration',
				'',
				'Explain the change.',
				'',
				'Co-authored-by: Alice Example <alice@example.com>',
				'Signed-off-by: Iain Lane <iain@orangesquash.org.uk>',
			].join('\n'),
		);

		assertStrictEquals(
			document.withBody('Explain the change in more detail.\n'),
			[
				'feat: add collaboration',
				'',
				'Explain the change in more detail.',
				'',
				'Co-authored-by: Alice Example <alice@example.com>',
				'Signed-off-by: Iain Lane <iain@orangesquash.org.uk>',
			].join('\n'),
		);
	},
);

const reflower = new MarkdownBodyReflower();

Deno.test('MarkdownBodyReflower wraps plain prose to 72 columns', () => {
	assertEquals(
		reflowSummary(
			reflower.reflow(
				[
					'An unwrapped paragraph with enough words to exceed the configured seventy two column width so the reflower must wrap it.',
					'',
				].join('\n'),
			),
		),
		{
			changed: true,
			original: [
				'An unwrapped paragraph with enough words to exceed the configured seventy two column width so the reflower must wrap it.',
				'',
			].join('\n'),
			reflowed: [
				'An unwrapped paragraph with enough words to exceed the configured',
				'seventy two column width so the reflower must wrap it.',
				'',
			].join('\n'),
		},
	);
});

Deno.test('MarkdownBodyReflower does not rewrite Markdown tables or code fences', () => {
	const body = [
		'| Column | Description |',
		'| --- | --- |',
		'| path | This deliberately stays as a table row even when it is far longer than the prose width. |',
		'',
		'```text',
		'This deliberately stays as code even when it is far longer than the prose width.',
		'```',
		'',
	].join('\n');

	assertEquals(reflowSummary(reflower.reflow(body)), {
		changed: false,
		original: body,
		reflowed: body,
	});
});

Deno.test(
	'MarkdownBodyReflower preserves inline Markdown syntax while wrapping around it',
	() => {
		const body = [
			'See [the release notes](https://example.com/releases/2026/06/09) before changing `*.ts` files because those details explain the compatibility rules.',
			'',
		].join('\n');

		assertEquals(reflowSummary(reflower.reflow(body)), {
			changed: true,
			original: body,
			reflowed: [
				'See [the release notes](https://example.com/releases/2026/06/09) before',
				'changing `*.ts` files because those details explain the compatibility',
				'rules.',
				'',
			].join('\n'),
		});
	},
);

Deno.test('MarkdownBodyReflower keeps bare URLs intact', () => {
	const body = [
		'Read https://example.com/releases/2026/06/09/with/a/very/long/path before changing the compatibility rules for clients.',
		'',
	].join('\n');

	assertEquals(reflowSummary(reflower.reflow(body)), {
		changed: true,
		original: body,
		reflowed: [
			'Read https://example.com/releases/2026/06/09/with/a/very/long/path',
			'before changing the compatibility rules for clients.',
			'',
		].join('\n'),
	});
});

Deno.test('MarkdownBodyReflower wraps list items using hanging indentation', () => {
	const body = [
		'- This list item has enough prose to exceed the configured seventy two column width and should keep a hanging indent.',
		'',
	].join('\n');

	assertEquals(reflowSummary(reflower.reflow(body)), {
		changed: true,
		original: body,
		reflowed: [
			'- This list item has enough prose to exceed the configured seventy two',
			'  column width and should keep a hanging indent.',
			'',
		].join('\n'),
	});
});

Deno.test(
	'MarkdownBodyReflower removes trailing prose spaces while wrapping paragraphs',
	() => {
		const body = [
			'This paragraph has a trailing space that should be removed before the ',
			'reflowed text is linted again.',
			'',
		].join('\n');

		assertEquals(reflowSummary(reflower.reflow(body)), {
			changed: true,
			original: body,
			reflowed: [
				'This paragraph has a trailing space that should be removed before the',
				'reflowed text is linted again.',
				'',
			].join('\n'),
		});
	},
);

Deno.test(
	'MarkdownBodyReflower removes trailing spaces introduced at wrapped soft line breaks',
	() => {
		const body = [
			"The R2 step consults the tenant Worker's secret names (values are",
			'write-only and cannot be read back): when the pair is present and the',
			'bucket name unchanged, it is kept without prompting or probing, and',
			"the plan's Secrets row shows it as already set. When the bucket was",
			'renamed during the review, the kept key may be scoped to the old name,',
			'so the settle menu reappears with the fix in it: create a key scoped',
			'to the new bucket (recommended), enter a pair, or keep the current key',
			'as an explicit choice. The settle outcome is a sum type (settled, keep,',
			'cancelled) rather than an optional pair.',
			'',
		].join('\n');

		assertEquals(reflowSummary(reflower.reflow(body)), {
			changed: true,
			original: body,
			reflowed: [
				"The R2 step consults the tenant Worker's secret names (values are",
				'write-only and cannot be read back): when the pair is present and the',
				'bucket name unchanged, it is kept without prompting or probing, and the',
				"plan's Secrets row shows it as already set. When the bucket was renamed",
				'during the review, the kept key may be scoped to the old name, so the',
				'settle menu reappears with the fix in it: create a key scoped to the new',
				'bucket (recommended), enter a pair, or keep the current key as an',
				'explicit choice. The settle outcome is a sum type (settled, keep,',
				'cancelled) rather than an optional pair.',
				'',
			].join('\n'),
		});
	},
);

for (
	const { word, reflowed } of [
		{
			word: 'well-established',
			reflowed: [
				'Prefix word word word word word word word word word word the',
				'well-established naming convention stays whole across the wrap boundary',
				'here today.',
				'',
			],
		},
		{
			word: 'production/staging',
			reflowed: [
				'Prefix word word word word word word word word word word the',
				'production/staging naming convention stays whole across the wrap',
				'boundary here today.',
				'',
			],
		},
	]
) {
	Deno.test(
		`MarkdownBodyReflower keeps the compound word "${word}" on one line`,
		() => {
			const body = [
				`Prefix word word word word word word word word word word the ${word} naming convention stays whole across the wrap boundary here today.`,
				'',
			].join('\n');

			assertEquals(reflowSummary(reflower.reflow(body)), {
				changed: true,
				original: body,
				reflowed: reflowed.join('\n'),
			});
		},
	);
}

Deno.test('MarkdownBodyReflower uses display width for wide characters', () => {
	const body = [
		'これはとても長い日本語の文章ですこれはとても長い日本語の文章ですこれはとても長い日本語の文章ですこれはとても長い日本語の文章です',
		'',
	].join('\n');

	assertEquals(reflowSummary(reflower.reflow(body)), {
		changed: true,
		original: body,
		reflowed: [
			'これはとても長い日本語の文章ですこれはとても長い日本語の文章ですこれはと',
			'ても長い日本語の文章ですこれはとても長い日本語の文章です',
			'',
		].join('\n'),
	});
});

Deno.test('MarkdownBodyReflower leaves hard-break paragraphs unchanged', () => {
	const body = [
		'First line with a Markdown hard break  ',
		'second line',
		'',
	].join('\n');

	assertEquals(reflowSummary(reflower.reflow(body)), {
		changed: false,
		original: body,
		reflowed: body,
	});
});

for (
	const [index, body] of [
		'An unwrapped paragraph with enough words to exceed the configured seventy two column width so the reflower must wrap it.\n',
		'See [the release notes](https://example.com/releases/2026/06/09) before changing `*.ts` files because those details explain the compatibility rules.\n',
		'- This list item has enough prose to exceed the configured seventy two column width and should keep a hanging indent.\n',
		'This paragraph has a trailing space that should be removed before the \nreflowed text is linted again.\n',
		[
			"The R2 step consults the tenant Worker's secret names (values are",
			'write-only and cannot be read back): when the pair is present and the',
			'bucket name unchanged, it is kept without prompting or probing, and',
			"the plan's Secrets row shows it as already set. When the bucket was",
			'renamed during the review, the kept key may be scoped to the old name,',
			'so the settle menu reappears with the fix in it: create a key scoped',
			'to the new bucket (recommended), enter a pair, or keep the current key',
			'as an explicit choice. The settle outcome is a sum type (settled, keep,',
			'cancelled) rather than an optional pair.',
			'',
		].join('\n'),
		'Read https://example.com/releases/2026/06/09/with/a/very/long/path before changing the compatibility rules for clients.\n',
		'これはとても長い日本語の文章ですこれはとても長い日本語の文章ですこれはとても長い日本語の文章ですこれはとても長い日本語の文章です\n',
	].entries()
) {
	Deno.test(`is idempotent: reflowing the result changes nothing (${index})`, () => {
		const once = reflower.reflow(body).reflowed;

		assertStrictEquals(reflower.reflow(once).reflowed, once);
	});
}

function documentFields(document: CommitMessageDocument): {
	readonly body: string;
	readonly separatorMissing: boolean;
	readonly subject: string;
	readonly trailers: readonly string[];
} {
	return {
		body: document.body,
		separatorMissing: document.separatorMissing,
		subject: document.subject,
		trailers: document.trailers,
	};
}

function reflowSummary(reflow: MarkdownBodyReflow): {
	readonly changed: boolean;
	readonly original: string;
	readonly reflowed: string;
} {
	return {
		changed: reflow.changed,
		original: reflow.original,
		reflowed: reflow.reflowed,
	};
}
