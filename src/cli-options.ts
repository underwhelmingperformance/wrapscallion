import { Command, Option } from 'commander';

import { ConfigFileError } from './cli-errors.ts';
import type { RawConfig } from './config-file.ts';
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

/** The parsed invocation: what to do, which commits to skip, and how to report it. */
export interface ParsedCommand {
	readonly ignore: readonly string[];
	readonly options: Options;
	readonly output: OutputPreferences;
}

interface CliOptions {
	readonly colour?: boolean;
	readonly dryRun?: boolean;
	readonly edit?: string;
	readonly from?: string;
	readonly ignore?: readonly string[];
	readonly outputFormat?: ReporterMode;
	readonly reword?: boolean;
	readonly to: string;
}

/**
 * Parses the CLI arguments, falling back to the config file for any flag not
 * given on the command line. A flag passed on the command line always wins.
 */
export function parseOptions(
	arguments_: readonly string[],
	streams: { readonly stderr: TextStream; readonly stdout: TextStream },
	config?: RawConfig,
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
		.option(
			'--ignore <pattern>',
			'skip commits whose subject matches this regular expression (repeatable)',
			collectPattern,
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

	if (config !== undefined) {
		applyConfig(program, config);
	}

	const parsed = program.opts<CliOptions>();
	const output: OutputPreferences = {
		colour: parsed.colour,
		format: parsed.outputFormat,
	};
	const ignore = parsed.ignore ?? [];

	if (parsed.edit !== undefined) {
		if (parsed.from !== undefined) {
			program.error('error: --edit cannot be combined with --from');
		}

		if (parsed.dryRun === true) {
			program.error('error: --dry-run requires --reword');
		}

		return { ignore, options: { file: parsed.edit, kind: 'edit' }, output };
	}

	if (parsed.from !== undefined) {
		if (parsed.dryRun === true && parsed.reword !== true) {
			program.error('error: --dry-run requires --reword');
		}

		return {
			ignore,
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

/**
 * Options whose config value is a list of strings. Commander's metadata cannot
 * distinguish these from single-valued options, so they are named explicitly;
 * everything else is derived from each option's own definition.
 */
const arrayValuedOptions = new Set(['ignore']);

/**
 * Folds the config file into the parsed command. Every option is taken straight
 * from the commander definition, so a new flag becomes config-settable with no
 * change here. Each value is validated against its option, and applied only
 * when the flag was not given on the command line.
 */
function applyConfig(program: Command, config: RawConfig): void {
	const optionsByKey = configurableOptions(program);

	for (const [key, value] of Object.entries(config.values)) {
		const option = optionsByKey.get(key);

		if (option === undefined) {
			throw new ConfigFileError(config.path, `unknown setting: ${key}`);
		}

		const coerced = coerceConfigValue(config.path, key, option, value);
		const attribute = option.attributeName();

		if (isSetOnCommandLine(program, attribute)) {
			continue;
		}

		program.setOptionValueWithSource(attribute, coerced, 'config');
	}
}

/** Maps each settable option to the key it takes in the config file. */
function configurableOptions(program: Command): Map<string, Option> {
	const optionsByKey = new Map<string, Option>();

	for (const option of program.options) {
		if (option.negate) {
			continue;
		}

		optionsByKey.set(configKey(option), option);
	}

	return optionsByKey;
}

function configKey(option: Option): string {
	return option.long?.replace(/^--/, '') ?? option.attributeName();
}

function isSetOnCommandLine(program: Command, attribute: string): boolean {
	const source = program.getOptionValueSource(attribute);

	return source !== undefined && source !== 'default';
}

function coerceConfigValue(
	path: string,
	key: string,
	option: Option,
	value: unknown,
): unknown {
	if (arrayValuedOptions.has(option.attributeName())) {
		if (
			!Array.isArray(value) ||
			!value.every((entry) => typeof entry === 'string')
		) {
			throw new ConfigFileError(path, `${key} must be an array of strings`);
		}

		return value;
	}

	if (takesNoValue(option)) {
		if (typeof value !== 'boolean') {
			throw new ConfigFileError(path, `${key} must be a boolean`);
		}

		return value;
	}

	if (typeof value !== 'string') {
		throw new ConfigFileError(path, `${key} must be a string`);
	}

	if (option.argChoices !== undefined && !option.argChoices.includes(value)) {
		throw new ConfigFileError(
			path,
			`${key} must be one of: ${option.argChoices.join(', ')}`,
		);
	}

	return value;
}

function takesNoValue(option: Option): boolean {
	return !option.required && !option.optional;
}

function collectPattern(
	value: string,
	previous: readonly string[] = [],
): readonly string[] {
	return [...previous, value];
}
