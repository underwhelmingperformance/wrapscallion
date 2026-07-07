import conventionalCommitlintConfiguration from '@commitlint/config-conventional';
import commitlint from '@commitlint/lint';
import conventionalCommitsPreset from 'conventional-changelog-conventionalcommits';
import { createPatch } from 'diff';
import type { Configuration, LintError } from 'markdownlint';
import { lint as lintMarkdown } from 'markdownlint/promise';

import { MarkdownBodyReflower } from './markdown-body-reflow.ts';
import { CommitMessageDocument } from './message.ts';

/**
 * The preset still returns `{ parser, writer, ... }` at runtime, but its v10
 * type declaration annotates the return value as `{}`, dropping the `parser`
 * property from the type. Augment the default export to restore it.
 */
declare module 'conventional-changelog-conventionalcommits' {
	export default function createPreset(): { parser: CommitlintParserOptions };
}

/**
 * A commit message with the display metadata needed to report failures for one
 * commit without mixing the result with other commits in the same range. An
 * edit-mode message read from a file has no hash; a range-mode message walked
 * from history always does (see {@link RangeCommitMessage}).
 */
export interface CommitMessage {
	readonly hash?: string;
	readonly label: string;
	readonly message: string;
	readonly subject: string;
}

/** A commit message read from history, which always carries its commit hash. */
export interface RangeCommitMessage extends CommitMessage {
	readonly hash: string;
}

/** A finding that names a violated rule with no further detail. */
export interface RuleFinding {
	readonly kind: 'rule';
	readonly fixable: boolean;
	readonly message: string;
	readonly rule: string;
}

/** The body-wrapping finding, which carries the before/after diff. */
export interface BodyFormatFinding {
	readonly kind: 'body-format';
	readonly actual: string;
	readonly expected: string;
	readonly fixable: boolean;
	readonly message: string;
	readonly patch: string;
	readonly rule: 'body-format';
}

/** A single lint finding for a commit message. */
export type Finding = BodyFormatFinding | RuleFinding;

/** The mutually exclusive outcomes of checking one commit message. */
export const commitMessageCheckStatuses = [
	'passed',
	'skipped',
	'fixable',
	'failed',
] as const;

/** One of the {@link commitMessageCheckStatuses}. */
export type CommitMessageCheckStatus =
	(typeof commitMessageCheckStatuses)[number];

/** Base class for expected commit-message check errors. */
export abstract class CommitMessageCheckError extends Error {
	protected constructor(message: string) {
		super(message);
	}
}

/** A passed or unchanged check has no replacement message to apply. */
export class UnchangedCommitMessageCheckError extends CommitMessageCheckError {
	constructor(public readonly check: CommitMessageCheck) {
		super(
			`commit ${check.commitMessage.label} does not need a replacement message`,
		);
		this.name = 'UnchangedCommitMessageCheckError';
	}
}

/** The check contains findings which cannot be fixed automatically. */
export class UnfixableCommitMessageCheckError extends CommitMessageCheckError {
	constructor(public readonly check: CommitMessageCheck) {
		super(
			`commit ${check.commitMessage.label} has findings that cannot be fixed automatically`,
		);
		this.name = 'UnfixableCommitMessageCheckError';
	}
}

/** The complete lint result for one commit message. */
export class CommitMessageCheck<M extends CommitMessage = CommitMessage> {
	constructor(
		public readonly commitMessage: M,
		public readonly originalMessage: string,
		public readonly fixedMessage: string,
		public readonly findings: readonly Finding[],
		public readonly skipped: boolean = false,
	) {}

	/**
	 * Builds the result for a commit the caller chose to skip. It carries no
	 * findings and leaves the message untouched, so it neither fails the run nor
	 * is reworded, but it stays in the sequence to keep history linear.
	 */
	static skip<M extends CommitMessage>(
		commitMessage: M,
	): CommitMessageCheck<M> {
		return new CommitMessageCheck(
			commitMessage,
			commitMessage.message,
			commitMessage.message,
			[],
			true,
		);
	}

	get changed(): boolean {
		return this.fixedMessage !== this.originalMessage;
	}

	get failed(): boolean {
		return this.findings.length > 0;
	}

	get fixable(): boolean {
		return (
			this.failed &&
			this.changed &&
			this.findings.every((finding) => finding.fixable)
		);
	}

	get passed(): boolean {
		return !this.skipped && !this.failed;
	}

	get status(): CommitMessageCheckStatus {
		if (this.skipped) {
			return 'skipped';
		}

		if (this.passed) {
			return 'passed';
		}

		return this.fixable ? 'fixable' : 'failed';
	}

	/** Returns the corrected message or throws a typed error. */
	rewordMessage(): string {
		if (!this.changed) {
			throw new UnchangedCommitMessageCheckError(this);
		}

		if (!this.fixable) {
			throw new UnfixableCommitMessageCheckError(this);
		}

		return this.fixedMessage;
	}
}

const commitBodyMarkdownlintConfiguration: Configuration = {
	default: false,
	MD013: {
		code_blocks: false,
		line_length: 72,
		tables: false,
	},
	MD024: {
		siblings_only: true,
	},
};

type CommitlintRules = NonNullable<Parameters<typeof commitlint>[1]>;
type CommitlintParserOptions = NonNullable<
	NonNullable<Parameters<typeof commitlint>[2]>['parserOpts']
>;

/**
 * Conventional Commits rules, with body and footer line-length limits disabled
 * because body wrapping is checked separately with markdownlint.
 */
const conventionalCommitRules: CommitlintRules = {
	...conventionalCommitlintConfiguration.rules,
	'body-max-line-length': [0],
	'footer-max-line-length': [0],
};

/**
 * The Conventional Commits header grammar (for example the `!` breaking-change
 * marker), taken straight from the preset that `@commitlint/config-conventional`
 * names in its `parserPreset`.
 */
const conventionalCommitParserOptions: CommitlintParserOptions =
	conventionalCommitsPreset().parser;

/** Decides which commits to skip, based on their subject. */
export interface CommitSubjectFilter {
	matches(subject: string): boolean;
}

const ignoreNothing: CommitSubjectFilter = { matches: () => false };

/**
 * Lints each commit message independently, preserving a separate report per
 * commit so multi-commit pull requests show each failing commit clearly.
 * Commits whose subject matches {@link ignore} are skipped.
 */
export function checkCommitMessages<M extends CommitMessage>(
	commitMessages: readonly M[],
	ignore: CommitSubjectFilter = ignoreNothing,
): Promise<readonly CommitMessageCheck<M>[]> {
	const reflower = new MarkdownBodyReflower();

	return Promise.all(
		commitMessages.map(async (commitMessage) => {
			if (ignore.matches(commitMessage.subject)) {
				return CommitMessageCheck.skip(commitMessage);
			}

			const bodyCheck = await checkMarkdownBody(commitMessage, reflower);

			return new CommitMessageCheck(
				commitMessage,
				commitMessage.message,
				bodyCheck.fixedMessage,
				[
					...(await lintConventionalCommit(bodyCheck.fixedMessage)),
					...bodyCheck.findings,
				],
			);
		}),
	);
}

/**
 * Extracts the commit body as Markdown, excluding the Conventional Commit
 * subject and surrounding blank lines.
 */
export function commitBody(message: string): string {
	return CommitMessageDocument.parse(message).body;
}

/** Creates the unified diff shown for body wrapping failures. */
export function formatBodyPatch(actual: string, expected: string): string {
	return createPatch('commit-body.md', actual, expected, 'actual', 'check', {
		context: 2,
	});
}

/** Builds the body-wrapping finding, deriving the patch from the diff. */
function bodyFormatFinding(
	actual: string,
	expected: string,
	fixable: boolean,
): BodyFormatFinding {
	return {
		kind: 'body-format',
		actual,
		expected,
		fixable,
		message: 'body is not wrapped to 72 columns',
		patch: formatBodyPatch(actual, expected),
		rule: 'body-format',
	};
}

async function lintConventionalCommit(
	message: string,
): Promise<readonly Finding[]> {
	const document = CommitMessageDocument.parse(message);
	const report = await commitlint(
		conventionalCommitMessage(document),
		conventionalCommitRules,
		{ parserOpts: conventionalCommitParserOptions },
	);

	return [...report.errors, ...report.warnings].map((finding): RuleFinding => {
		const rule = finding.name;

		return {
			kind: 'rule',
			fixable: false,
			message: `${rule}: ${finding.message}`,
			rule,
		};
	});
}

function conventionalCommitMessage(document: CommitMessageDocument): string {
	if (document.trailers.length === 0) {
		return document.subject;
	}

	return [
		document.subject,
		'',
		...document.trailers,
	].join('\n');
}

async function checkMarkdownBody(
	commitMessage: CommitMessage,
	reflower: MarkdownBodyReflower,
): Promise<{
	readonly findings: readonly Finding[];
	readonly fixedMessage: string;
}> {
	const document = CommitMessageDocument.parse(commitMessage.message);
	const body = document.body;

	if (body === '') {
		return { findings: [], fixedMessage: commitMessage.message };
	}

	const findings: Finding[] = [];

	if (document.separatorMissing) {
		findings.push({
			kind: 'rule',
			fixable: true,
			message: 'trailer is not separated from the body by a blank line',
			rule: 'trailer-format',
		});
	}

	const reflow = reflower.reflow(body);
	const fixedMessage = document.withBody(reflow.reflowed);
	const finalLintResults = await lintMarkdown({
		config: commitBodyMarkdownlintConfiguration,
		strings: {
			body: reflow.reflowed,
		},
	});
	const markdownlintFindings = finalLintResults.body ?? [];

	if (reflow.changed) {
		findings.push(
			bodyFormatFinding(
				body,
				reflow.reflowed,
				markdownlintFindings.length === 0,
			),
		);
	}

	return {
		findings: [
			...findings,
			...markdownlintFindings.map(
				(finding): RuleFinding => ({
					kind: 'rule',
					fixable: false,
					message: markdownlintFailure(finding),
					rule: finding.ruleNames[0] ?? finding.ruleNames.join('/'),
				}),
			),
		],
		fixedMessage,
	};
}

function markdownlintFailure(finding: LintError): string {
	const ruleNames = finding.ruleNames.join('/');
	const details = finding.errorDetail === null
		? ''
		: `: ${finding.errorDetail}`;
	const context = finding.errorContext === null
		? ''
		: ` [${finding.errorContext}]`;

	return `body line ${
		String(finding.lineNumber)
	} ${ruleNames}: ${finding.ruleDescription}${details}${context}`;
}
