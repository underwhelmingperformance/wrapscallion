import type { CommitMessageCheck } from './linter.ts';

/**
 * Builds the GitHub Actions `::error` workflow commands that surface each
 * failing commit as an annotation on the pull request's checks. The annotation
 * is not tied to a file because the findings are about commit messages rather
 * than the worktree, so it appears against the workflow itself; the readable
 * report still carries the detail in the step log.
 */
export function githubAnnotations(
	failures: readonly CommitMessageCheck[],
): readonly string[] {
	return failures.map((check) => {
		const title = `${check.commitMessage.label} ${check.commitMessage.subject}`;
		const message = check.findings
			.map((finding) => finding.message)
			.join('\n');

		return `::error title=${encodeProperty(title)}::${encodeData(message)}`;
	});
}

/**
 * Escapes a workflow-command message so newlines and percent signs survive the
 * single-line command syntax.
 */
function encodeData(value: string): string {
	return value
		.replaceAll('%', '%25')
		.replaceAll('\r', '%0D')
		.replaceAll('\n', '%0A');
}

/**
 * Escapes a workflow-command property, which additionally reserves the comma
 * that separates properties and the colon that ends them.
 */
function encodeProperty(value: string): string {
	return encodeData(value)
		.replaceAll(':', '%3A')
		.replaceAll(',', '%2C');
}
