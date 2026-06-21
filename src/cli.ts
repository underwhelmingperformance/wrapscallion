import { CommanderError } from 'commander';
import { createGit, type Git } from 'just-git';

import { errorEvent, errorMessage } from './cli-errors.ts';
import {
	type Options,
	parseOptions,
	type RangeOptions,
} from './cli-options.ts';
import { readCommitMessages } from './commit-message-source.ts';
import {
	type ConfigFileReader,
	DenoConfigFileReader,
	loadConfigFile,
} from './config-file.ts';
import { githubAnnotations } from './github.ts';
import { IgnoreMatcher } from './ignore-matcher.ts';
import { checkCommitMessages, type CommitMessageCheck } from './linter.ts';
import { NodeFileSystem } from './node-file-system.ts';
import { jsonReport, terminalFailureReport } from './report.ts';
import {
	type OutputEnvironment,
	type OutputSettings,
	resolveOutput,
} from './reporter-mode.ts';
import {
	type Colours,
	createReporter,
	denoTextStream,
	type Reporter,
	type ReporterMode,
	type TextStream,
} from './reporter.ts';
import {
	reportRewriteResult,
	rewordCommitMessages,
	rewordedMessageCount,
} from './reword-command.ts';

const root = Deno.cwd();

/** Exit code for an unusable invocation or an unexpected failure. */
const operationalErrorExit = 2;

export interface MainOptions {
	readonly configReader?: ConfigFileReader;
	readonly stderr?: TextStream;
	readonly stdout?: TextStream;
}

/** Runs the commit-message lint CLI. */
export async function main(
	arguments_: readonly string[],
	options: MainOptions = {},
): Promise<number> {
	const stderr = options.stderr ?? denoTextStream(Deno.stderr);
	const stdout = options.stdout ?? denoTextStream(Deno.stdout);
	const environment: OutputEnvironment = {
		isTerminal: options.stderr === undefined && Deno.stderr.isTerminal(),
		githubActions: Deno.env.get('GITHUB_ACTIONS') === 'true',
	};
	let settings: OutputSettings | undefined;

	try {
		const config = await loadConfigFile(
			root,
			options.configReader ?? new DenoConfigFileReader(),
		);
		const { ignore, options: parsedOptions, output } = parseOptions(
			arguments_,
			{ stderr, stdout },
			config,
		);
		settings = resolveOutput(output, environment);
		const { colours, format } = settings;
		const git = createGit({ cwd: root, fs: new NodeFileSystem() });
		const reporter = createReporter({
			mode: format,
			colours,
			stream: stderr,
			animate: environment.isTerminal,
		});

		const checks = await checkPhase(
			reporter,
			parsedOptions,
			git,
			IgnoreMatcher.compile(ignore),
		);
		const failures = checks.filter((check) => check.failed);

		if (failures.length === 0) {
			reportSuccess(format, checks, stderr);
			return 0;
		}

		if (parsedOptions.kind === 'range' && parsedOptions.reword) {
			await rewordPhase(reporter, parsedOptions, checks, git, format, stderr);
			return 0;
		}

		reportFailures({ checks, colours, failures, format, stderr, stdout });
		return 1;
	} catch (error) {
		return handleError(error, settings, environment, stderr);
	}
}

/** Lints the selected commit messages, reporting progress as a single phase. */
function checkPhase(
	reporter: Reporter,
	options: Options,
	git: Git,
	ignore: IgnoreMatcher,
): Promise<readonly CommitMessageCheck[]> {
	return reporter.phase('Checking commit messages', async (phase) => {
		const commitMessages = await readCommitMessages(options, git);
		phase.fact('messages', commitMessages.length);

		const checks = await checkCommitMessages(commitMessages, ignore);
		const skipped = checks.filter((check) => check.skipped).length;

		if (skipped > 0) {
			phase.fact('skipped', skipped);
		}

		return checks;
	});
}

/** Rewords the fixable commits in the range and reports what changed. */
async function rewordPhase(
	reporter: Reporter,
	options: RangeOptions,
	checks: readonly CommitMessageCheck[],
	git: Git,
	format: ReporterMode,
	stderr: TextStream,
): Promise<void> {
	const result = await reporter.phase(
		options.dryRun
			? 'Checking reworded commit messages'
			: 'Rewording commit messages',
		async (phase) => {
			const result = await rewordCommitMessages(options, checks, git);
			phase.fact(
				options.dryRun ? 'would reword' : 'reworded',
				rewordedMessageCount(result),
			);

			return result;
		},
	);

	reportRewriteResult(result, format, stderr);
}

/** The commits and streams needed to report a failing lint run. */
interface FailureReport {
	readonly checks: readonly CommitMessageCheck[];
	readonly colours: Colours;
	readonly failures: readonly CommitMessageCheck[];
	readonly format: ReporterMode;
	readonly stderr: TextStream;
	readonly stdout: TextStream;
}

/** A clean run only reports anything in JSON mode; the others rely on the phase. */
function reportSuccess(
	format: ReporterMode,
	checks: readonly CommitMessageCheck[],
	stderr: TextStream,
): void {
	switch (format) {
		case 'json':
			emitJsonReport(jsonReport('ok', checks), stderr);
			return;
		case 'terminal':
		case 'github':
			return;
	}
}

function reportFailures(report: FailureReport): void {
	const { checks, colours, failures, format, stderr, stdout } = report;
	const skipped = checks.filter((check) => check.skipped).length;
	const considered = checks.length - skipped;

	switch (format) {
		case 'json':
			emitJsonReport(jsonReport('failed', checks), stderr);
			return;
		case 'terminal':
			writeFailureReport(failures, considered, colours, stderr, skipped);
			return;
		case 'github':
			writeFailureReport(failures, considered, colours, stderr, skipped);

			for (const annotation of githubAnnotations(failures)) {
				stdout.write(`${annotation}\n`);
			}

			return;
	}
}

function handleError(
	error: unknown,
	settings: OutputSettings | undefined,
	environment: OutputEnvironment,
	stderr: TextStream,
): number {
	if (error instanceof CommanderError) {
		// Commander has already written the message and help to the stream.
		return error.code === 'commander.helpDisplayed' ? 0 : operationalErrorExit;
	}

	const { colours, format } = settings ?? resolveOutput({}, environment);

	switch (format) {
		case 'json':
			stderr.write(`${JSON.stringify(errorEvent(error))}\n`);
			break;
		case 'terminal':
		case 'github':
			stderr.write(`${errorMessage(error, colours)}\n`);
			break;
	}

	return operationalErrorExit;
}

function writeFailureReport(
	failures: readonly CommitMessageCheck[],
	total: number,
	colours: Colours,
	stderr: TextStream,
	skipped: number,
): void {
	stderr.write(
		`${terminalFailureReport(failures, total, colours, skipped)}\n`,
	);
}

function emitJsonReport(
	report: ReturnType<typeof jsonReport>,
	stream: TextStream,
): void {
	stream.write(`${JSON.stringify(report)}\n`);
}
