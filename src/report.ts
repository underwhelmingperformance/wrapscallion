import type { CommitMessageCheck, Finding } from './linter.ts';
import { type Colours, formatCount as formatInteger } from './reporter.ts';

export type CommitMessageLintStatus = 'failed' | 'ok';

/** The machine-readable JSONL event emitted by the non-terminal CLI mode. */
export interface CommitMessageLintJsonReport {
	readonly event: 'wrapscallion';
	readonly failures: readonly CommitMessageJsonFailure[];
	readonly skipped: readonly CommitMessageJsonSkip[];
	readonly status: CommitMessageLintStatus;
	readonly total: number;
}

/** One failing commit in the machine-readable report. */
export interface CommitMessageJsonFailure {
	readonly commit: string;
	readonly findings: readonly CommitMessageJsonFinding[];
	readonly subject: string;
}

/** One skipped commit in the machine-readable report. */
export interface CommitMessageJsonSkip {
	readonly commit: string;
	readonly subject: string;
}

/** One finding in the machine-readable report. */
export interface CommitMessageJsonFinding {
	readonly actual?: string;
	readonly expected?: string;
	readonly fixable: boolean;
	readonly message: string;
	readonly rule?: string;
}

/**
 * Builds the JSONL payload used when stdout/stderr is not a terminal. Skipped
 * commits are listed separately and excluded from `total`, which counts the
 * commits that were actually checked.
 */
export function jsonReport(
	status: CommitMessageLintStatus,
	checks: readonly CommitMessageCheck[],
): CommitMessageLintJsonReport {
	const skipped = checks.filter((check) => check.skipped);

	return {
		event: 'wrapscallion',
		failures: checks
			.filter((check) => check.failed)
			.map((check) => ({
				commit: check.commitMessage.label,
				findings: check.findings.map((finding) => jsonFinding(finding)),
				subject: check.commitMessage.subject,
			})),
		skipped: skipped.map((check) => ({
			commit: check.commitMessage.label,
			subject: check.commitMessage.subject,
		})),
		status,
		total: checks.length - skipped.length,
	};
}

/** Formats the human-readable terminal failure report. */
export function terminalFailureReport(
	checks: readonly CommitMessageCheck[],
	totalCount: number,
	colours: Colours,
	skippedCount = 0,
): string {
	const skippedNote = skippedCount === 0
		? ''
		: ` (${formatNamedCount(skippedCount, 'commit message')} skipped)`;

	const lines = [
		`${colours.red('Wrapscallion failed')} for ${
			formatNamedCount(
				checks.length,
				'commit message',
			)
		} out of ${formatInteger(totalCount)}${skippedNote}.`,
	];

	for (const check of checks) {
		lines.push(
			'',
			`${
				colours.bold(check.commitMessage.label)
			} ${check.commitMessage.subject}`,
		);

		for (const finding of check.findings) {
			lines.push(`  ${colours.red('x')} ${finding.message}`);

			if (finding.kind === 'body-format') {
				lines.push(formatPatchForTerminal(finding.patch, colours));
			}
		}
	}

	return lines.join('\n');
}

/** Formats a unified diff for terminal output. */
export function formatPatchForTerminal(
	patch: string,
	colours: Colours,
): string {
	return patch
		.trimEnd()
		.split('\n')
		.map((line) => `    ${colourPatchLine(line, colours)}`)
		.join('\n');
}

function colourPatchLine(line: string, colours: Colours): string {
	if (line.startsWith('+')) {
		return colours.green(line);
	}

	if (line.startsWith('-')) {
		return colours.red(line);
	}

	if (line.startsWith('@')) {
		return colours.cyan(line);
	}

	return colours.dim(line);
}

function jsonFinding(finding: Finding): CommitMessageJsonFinding {
	switch (finding.kind) {
		case 'body-format': {
			return {
				actual: finding.actual,
				expected: finding.expected,
				fixable: finding.fixable,
				message: finding.message,
				rule: finding.rule,
			};
		}
		case 'rule': {
			return {
				fixable: finding.fixable,
				message: finding.message,
				rule: finding.rule,
			};
		}
	}
}

function formatNamedCount(count: number, name: string): string {
	return `${formatInteger(count)} ${name}${count === 1 ? '' : 's'}`;
}
