import { LineWrap } from '@cto.af/linewrap';
import { StringWidth } from '@cto.af/string-width';
import { parse, postprocess, preprocess } from 'micromark';
import { gfm } from 'micromark-extension-gfm';

import { isTrailerBlock, normaliseLineEndings } from './message.ts';

const reflowWidth = 72;
const placeholderStart = 57_344;
const unsafeTokenTypes = new Set([
	'codeFenced',
	'codeIndented',
	'definition',
	'headingAtx',
	'headingSetext',
	'htmlFlow',
	'table',
	'thematicBreak',
]);
const prefixTokenTypes = new Set([
	'blockQuotePrefix',
	'listItemIndent',
	'linePrefix',
]);
// Spans the reflower must keep on one line: Markdown inline constructs whose
// internal whitespace is significant, and word-joining punctuation that UAX #14
// would otherwise treat as a break opportunity. Each is swapped for a
// width-stable placeholder before wrapping and restored afterwards.
const inlineTokenPatterns = [
	// Double-backtick code span, e.g. ``a `b` c``.
	/``[\s\S]*?``/gu,
	// Single-backtick code span, e.g. `value`.
	/`[^`\n]+?`/gu,
	// Inline link or image, e.g. [text](https://example.com) or ![alt](img.png).
	/!?\[[^\]\n]*?\]\([^)\n]*?\)/gu,
	// Full reference link or image, e.g. [text][ref].
	/!?\[[^\]\n]*?\]\[[^\]\n]*?\]/gu,
	// Collapsed reference link or image, e.g. [text][].
	/!?\[[^\]\n]*?\]\[\]/gu,
	// Autolink, e.g. <https://example.com> or <mailto:user@example.com>.
	/<(?:https?:\/\/|mailto:)[^>\s]+>/gu,
	// Bare URL, e.g. https://example.com/path.
	/\b[a-z][a-z0-9+.-]{1,15}:\/\/\S+/giu,
	// Word-joining hyphen or slash, e.g. well-established or read/write.
	/(?<=\w)[-/](?=\w)/gu,
];

/** Result of reflowing a Markdown commit-message body. */
export class MarkdownBodyReflow {
	constructor(
		public readonly original: string,
		public readonly reflowed: string,
	) {}

	get changed(): boolean {
		return this.original !== this.reflowed;
	}
}

/** Reflows only Markdown paragraphs that are safe to rewrite as prose. */
export class MarkdownBodyReflower {
	readonly #stringWidth = new StringWidth();

	reflow(body: string): MarkdownBodyReflow {
		const normalised = normaliseLineEndings(body);
		const paragraphs = paragraphSpans(normalised);

		if (paragraphs.length === 0) {
			return new MarkdownBodyReflow(body, normalised);
		}

		const lines = normalised.split('\n');

		for (const paragraph of paragraphs.toReversed()) {
			const replacement = this.#reflowParagraph(lines, paragraph);

			if (replacement === undefined) {
				continue;
			}

			lines.splice(
				paragraph.startLine - 1,
				paragraph.endLine - paragraph.startLine + 1,
				...replacement,
			);
		}

		return new MarkdownBodyReflow(body, lines.join('\n'));
	}

	#reflowParagraph(
		lines: readonly string[],
		paragraph: ParagraphSpan,
	): readonly string[] | undefined {
		const physicalLines = lines.slice(
			paragraph.startLine - 1,
			paragraph.endLine,
		);

		// A paragraph git would read as a trailer block — for example an inner
		// commit's trailers stranded mid-body by a squash merge — is metadata,
		// not prose, so joining or rewrapping its lines would corrupt it.
		if (isTrailerBlock(physicalLines)) {
			return undefined;
		}

		if (
			physicalLines.slice(0, -1).some((line) => /(?: {2,}|\\)$/u.test(line))
		) {
			return undefined;
		}

		const firstPrefix = physicalLines[0]?.slice(0, paragraph.startColumn - 1);

		if (firstPrefix === undefined) {
			return undefined;
		}

		const contentLines = physicalLines.map((line, index) => {
			const lineNumber = paragraph.startLine + index;
			const contentColumn = index === 0
				? paragraph.startColumn
				: (paragraph.contentColumns.get(lineNumber) ?? 1);

			return line.slice(contentColumn - 1).trimEnd();
		});
		const content = contentLines.join('\n').trim();

		if (content === '') {
			return undefined;
		}

		const protectedContent = this.#protectInlineTokens(content);
		const continuationPrefix =
			continuationPrefixFromExistingLines(physicalLines, paragraph) ??
				deriveContinuationPrefix(firstPrefix, this.#stringWidth);

		try {
			const wrapper = new LineWrap({
				firstCol: this.#stringWidth.width(firstPrefix),
				indent: continuationPrefix,
				indentFirst: false,
				overflow: LineWrap.OVERFLOW_VISIBLE,
				width: reflowWidth,
			});
			const wrappedLines = [...wrapper.lines(protectedContent.text)];

			if (wrappedLines.length === 0) {
				return undefined;
			}

			return wrappedLines.map((line, index) =>
				protectedContent
					.restore(index === 0 ? `${firstPrefix}${line}` : line)
					.trimEnd()
			);
		} catch {
			return undefined;
		}
	}

	#protectInlineTokens(text: string): ProtectedInlineText {
		const replacements: InlineReplacement[] = [];
		let protectedText = text;

		for (const pattern of inlineTokenPatterns) {
			protectedText = protectedText.replace(pattern, (token) => {
				const placeholder = placeholderFor(
					replacements.length,
					this.#stringWidth.width(token),
				);

				replacements.push({ placeholder, token });

				return placeholder;
			});
		}

		return new ProtectedInlineText(protectedText, replacements);
	}
}

class ProtectedInlineText {
	constructor(
		public readonly text: string,
		private readonly replacements: readonly InlineReplacement[],
	) {}

	restore(value: string): string {
		let restored = value;

		for (const { placeholder, token } of this.replacements) {
			restored = restored.replaceAll(placeholder, token);
		}

		return restored;
	}
}

interface InlineReplacement {
	readonly placeholder: string;
	readonly token: string;
}

interface ParagraphSpan {
	readonly contentColumns: ReadonlyMap<number, number>;
	readonly endLine: number;
	readonly startColumn: number;
	readonly startLine: number;
}

interface MicromarkPoint {
	readonly column: number;
	readonly line: number;
	readonly offset: number;
}

interface MicromarkToken {
	readonly end: MicromarkPoint;
	readonly start: MicromarkPoint;
	readonly type: string;
}

type MicromarkEvent = readonly ['enter' | 'exit', MicromarkToken, unknown?];

function paragraphSpans(markdown: string): readonly ParagraphSpan[] {
	const events: readonly MicromarkEvent[] = postprocess(
		parse({ extensions: [gfm()] })
			.document()
			.write(preprocess()(markdown, undefined, true)),
	);
	const paragraphs: ParagraphSpan[] = [];
	const unsafeStack: string[] = [];
	let current: MutableParagraphSpan | undefined;

	for (const [kind, token] of events) {
		if (kind === 'enter') {
			if (unsafeTokenTypes.has(token.type)) {
				unsafeStack.push(token.type);
			}

			if (token.type === 'paragraph' && unsafeStack.length === 0) {
				current = {
					contentColumns: new Map(),
					endLine: token.end.line,
					startColumn: token.start.column,
					startLine: token.start.line,
				};
			}

			if (current !== undefined && prefixTokenTypes.has(token.type)) {
				current.contentColumns.set(token.start.line, token.end.column);
			}
		}

		if (kind === 'exit') {
			if (token.type === 'paragraph' && current !== undefined) {
				paragraphs.push({
					contentColumns: current.contentColumns,
					endLine: current.endLine,
					startColumn: current.startColumn,
					startLine: current.startLine,
				});
				current = undefined;
			}

			if (unsafeTokenTypes.has(token.type)) {
				unsafeStack.pop();
			}
		}
	}

	return paragraphs;
}

interface MutableParagraphSpan {
	readonly contentColumns: Map<number, number>;
	readonly endLine: number;
	readonly startColumn: number;
	readonly startLine: number;
}

function continuationPrefixFromExistingLines(
	lines: readonly string[],
	paragraph: ParagraphSpan,
): string | undefined {
	if (lines.length < 2) {
		return undefined;
	}

	const secondLineNumber = paragraph.startLine + 1;
	const contentColumn = paragraph.contentColumns.get(secondLineNumber);

	if (contentColumn === undefined) {
		return undefined;
	}

	return lines[1]?.slice(0, contentColumn - 1);
}

function deriveContinuationPrefix(
	firstPrefix: string,
	stringWidth: StringWidth,
): string {
	const listPrefix =
		/^(?<quote>(?: {0,3}> ?)*)(?<marker>\s*(?:[-*+]|\d{1,9}[.)])\s+(?:\[[ xX]\]\s+)?)$/u
			.exec(
				firstPrefix,
			);

	if (listPrefix?.groups !== undefined) {
		const quote = listPrefix.groups.quote ?? '';
		const marker = listPrefix.groups.marker ?? '';

		return `${quote}${' '.repeat(stringWidth.width(marker))}`;
	}

	return firstPrefix;
}

function placeholderFor(index: number, width: number): string {
	// Private-use codepoints are unlikely in commit prose and keep placeholders width-stable.
	const marker = String.fromCodePoint(placeholderStart + index);

	return `${marker}${'x'.repeat(Math.max(0, width - 1))}`;
}
