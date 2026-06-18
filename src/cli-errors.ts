import {
	CommitMessageCheckError,
	UnfixableCommitMessageCheckError,
} from './linter.ts';
import { terminalFailureReport } from './report.ts';
import type { Colours } from './reporter.ts';
import { CommitMessageRewriteError, StaleHeadError } from './rewriter.ts';

export abstract class CommitMessageCliError extends Error {
	protected constructor(message: string) {
		super(message);
	}
}

export class DetachedHeadError extends CommitMessageCliError {
	constructor(public readonly head: string) {
		super('cannot reword commit messages while HEAD is detached');
		this.name = 'DetachedHeadError';
	}
}

export class DirtyWorktreeError extends CommitMessageCliError {
	constructor() {
		super('working tree must be clean before rewording commit messages');
		this.name = 'DirtyWorktreeError';
	}
}

export class MissingRepositoryError extends CommitMessageCliError {
	constructor() {
		super('could not find a Git repository');
		this.name = 'MissingRepositoryError';
	}
}

export class CommitMessageFileError extends CommitMessageCliError {
	constructor(public readonly path: string, reason: unknown) {
		super(
			reason instanceof Deno.errors.NotFound
				? `commit message file not found: ${path}`
				: `could not read commit message file: ${path}`,
		);
		this.name = 'CommitMessageFileError';
	}
}

export class RevisionNotFoundError extends CommitMessageCliError {
	constructor(public readonly revision: string) {
		super(`revision not found: ${revision}`);
		this.name = 'RevisionNotFoundError';
	}
}

export class InvalidIgnorePatternError extends CommitMessageCliError {
	constructor(public readonly pattern: string, reason: unknown) {
		const detail = reason instanceof Error ? reason.message : String(reason);
		super(`invalid ignore pattern ${JSON.stringify(pattern)}: ${detail}`);
		this.name = 'InvalidIgnorePatternError';
	}
}

export class ConfigFileError extends CommitMessageCliError {
	constructor(public readonly path: string, message: string) {
		super(`${path}: ${message}`);
		this.name = 'ConfigFileError';
	}
}

export class UnbornHeadError extends CommitMessageCliError {
	constructor() {
		super('cannot reword commit messages on an unborn HEAD');
		this.name = 'UnbornHeadError';
	}
}

/** Formats an error for terminal output (the unfixable case gets a diff). */
export function errorMessage(error: unknown, colours: Colours): string {
	if (error instanceof UnfixableCommitMessageCheckError) {
		const checks = [error.check];

		return terminalFailureReport(checks, checks.length, colours);
	}

	return plainErrorMessage(error);
}

/** The machine-readable error event emitted in JSON output mode. */
export function errorEvent(
	error: unknown,
): { readonly event: 'error'; readonly message: string } {
	return { event: 'error', message: plainErrorMessage(error) };
}

function plainErrorMessage(error: unknown): string {
	if (error instanceof CommitMessageCliError) {
		return error.message;
	}

	if (error instanceof CommitMessageRewriteError) {
		return rewriteErrorMessage(error);
	}

	if (error instanceof CommitMessageCheckError) {
		return error.message;
	}

	return error instanceof Error ? error.message : String(error);
}

function rewriteErrorMessage(error: CommitMessageRewriteError): string {
	if (error instanceof StaleHeadError) {
		return 'branch moved while rewording commit messages; no ref update was applied';
	}

	return error.message;
}
