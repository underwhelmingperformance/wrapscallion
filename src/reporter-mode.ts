import pc from 'picocolors';

import type { Colours, ReporterMode } from './reporter.ts';

export interface OutputPreferences {
	readonly format?: ReporterMode;
	readonly colour?: boolean;
}

/** The environment signals that steer format selection. */
export interface OutputEnvironment {
	readonly isTerminal: boolean;
	readonly githubActions: boolean;
}

export interface OutputSettings {
	readonly format: ReporterMode;
	readonly colours: Colours;
}

/**
 * Resolves the output format and colouring from the CLI flags and environment.
 * The format follows `--output-format`, then `GITHUB_ACTIONS`, then whether the
 * stream is a terminal. Colour follows `--colour`/`--no-colour` as an override
 * of picocolors' own `FORCE_COLOR`/`NO_COLOR` detection, and is never applied to
 * JSON output.
 */
export function resolveOutput(
	preferences: OutputPreferences,
	environment: OutputEnvironment,
): OutputSettings {
	const format = resolveFormat(preferences.format, environment);

	return {
		format,
		colours: pc.createColors(resolveColour(preferences.colour, format)),
	};
}

function resolveFormat(
	explicit: ReporterMode | undefined,
	environment: OutputEnvironment,
): ReporterMode {
	if (explicit !== undefined) {
		return explicit;
	}

	if (environment.githubActions) {
		return 'github';
	}

	return environment.isTerminal ? 'terminal' : 'json';
}

function resolveColour(
	explicit: boolean | undefined,
	format: ReporterMode,
): boolean {
	if (format === 'json') {
		return false;
	}

	return explicit ?? pc.isColorSupported;
}
