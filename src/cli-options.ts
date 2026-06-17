import { Command, Option } from 'commander';

import type { OutputPreferences } from './reporter-mode.ts';
import {
	type ReporterMode,
	reporterModes,
	type TextStream,
} from './reporter.ts';

export interface RangeOptions {
	readonly dryRun: boolean;
	readonly kind: 'range';
	readonly from: string;
	readonly reword: boolean;
	readonly to: string;
}

export interface EditOptions {
	readonly kind: 'edit';
	readonly file: string;
}

export type Options = EditOptions | RangeOptions;

/** The parsed invocation: what to do, and how to report it. */
export interface ParsedCommand {
	readonly options: Options;
	readonly output: OutputPreferences;
}

interface CliOptions {
	readonly colour?: boolean;
	readonly dryRun?: boolean;
	readonly edit?: string;
	readonly from?: string;
	readonly outputFormat?: ReporterMode;
	readonly reword?: boolean;
	readonly to: string;
}

export function parseOptions(
	arguments_: readonly string[],
	streams: { readonly stderr: TextStream; readonly stdout: TextStream },
): ParsedCommand {
	const program = new Command()
		.name('wrapscallion')
		.description('Lint Conventional Commit messages and 72-column bodies.')
		.addOption(
			new Option('--output-format <format>', 'output format')
				.choices(reporterModes),
		)
		.option('--colour', 'force ANSI colour (overrides NO_COLOR)')
		.option('--no-colour', 'disable ANSI colour (overrides FORCE_COLOR)')
		.option('--dry-run', 'show what --reword would change without moving refs')
		.addOption(
			new Option(
				'--edit <file>',
				'lint a commit message file, for commit-msg hooks',
			).conflicts(['from', 'to']),
		)
		.addOption(
			new Option('--from <revision>', 'lint commits after this revision'),
		)
		.addOption(
			new Option(
				'--reword',
				'rewrite fixable commit messages in the selected range',
			).conflicts('edit'),
		)
		.option('--to <revision>', 'lint commits up to this revision', 'HEAD')
		.showHelpAfterError();

	program
		.configureOutput({
			writeErr: (chunk) => streams.stderr.write(chunk),
			writeOut: (chunk) => streams.stdout.write(chunk),
		})
		.exitOverride();

	program.parse([...arguments_], { from: 'user' });

	const parsed = program.opts<CliOptions>();
	const output: OutputPreferences = {
		colour: parsed.colour,
		format: parsed.outputFormat,
	};

	if (parsed.edit !== undefined) {
		if (parsed.dryRun === true) {
			program.error('error: --dry-run requires --reword');
		}

		return { options: { file: parsed.edit, kind: 'edit' }, output };
	}

	if (parsed.from !== undefined) {
		if (parsed.dryRun === true && parsed.reword !== true) {
			program.error('error: --dry-run requires --reword');
		}

		return {
			options: {
				dryRun: parsed.dryRun ?? false,
				from: parsed.from,
				kind: 'range',
				reword: parsed.reword ?? false,
				to: parsed.to,
			},
			output,
		};
	}

	return program.error('error: one of --edit or --from is required');
}
