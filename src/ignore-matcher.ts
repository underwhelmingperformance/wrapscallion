import { RE2JS } from 're2js';

import { InvalidIgnorePatternError } from './cli-errors.ts';

/**
 * Decides whether a commit should be skipped based on its subject. Patterns are
 * unanchored regular expressions; a subject matching any of them is ignored.
 *
 * The patterns come from the user (CLI flags or the config file), so they are
 * compiled with RE2, whose matching is linear in the input length. That rules
 * out the catastrophic backtracking a hand-written pattern could otherwise
 * cause, at the cost of RE2's narrower syntax (no backreferences or
 * lookaround).
 */
export class IgnoreMatcher {
	private constructor(private readonly patterns: readonly RE2JS[]) {}

	/** Compiles the patterns, throwing for the first one that is not valid. */
	static compile(patterns: readonly string[]): IgnoreMatcher {
		return new IgnoreMatcher(patterns.map(compilePattern));
	}

	matches(subject: string): boolean {
		return this.patterns.some((pattern) => pattern.matcher(subject).find());
	}
}

function compilePattern(pattern: string): RE2JS {
	try {
		return RE2JS.compile(pattern);
	} catch (error) {
		throw new InvalidIgnorePatternError(pattern, error);
	}
}
