import pc from 'picocolors';

import type { Colours, ReporterMode } from './reporter.ts';

export interface OutputPreferences {
	readonly format?: ReporterMode;
	readonly colour?: boolean;
}

export interface OutputSettings {
	readonly format: ReporterMode;
	readonly colours: Colours;
}

/**
 * Resolves the output format and colouring from the CLI flags and environment.
 * The format follows `--output-format`, then `PRE_COMMIT`, then
 * `GITHUB_ACTIONS`, then whether the stream is a terminal. Colour follows
 * `--colour`/`--no-colour` as an override of picocolors' own
 * `FORCE_COLOR`/`NO_COLOR` detection, and is never applied to JSON output.
 */
export function resolveOutput(
	preferences: OutputPreferences,
	isTerminal: boolean,
): OutputSettings {
	const format = resolveFormat(preferences.format, isTerminal);

	return {
		format,
		colours: pc.createColors(resolveColour(preferences.colour, format)),
	};
}

function resolveFormat(
	explicit: ReporterMode | undefined,
	isTerminal: boolean,
): ReporterMode {
	if (explicit !== undefined) {
		return explicit;
	}

	if (Deno.env.get('PRE_COMMIT') === '1') {
		return 'json';
	}

	if (Deno.env.get('GITHUB_ACTIONS') === 'true') {
		return 'github';
	}

	return isTerminal ? 'terminal' : 'json';
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
