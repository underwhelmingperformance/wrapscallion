import { CommanderError } from 'commander';
import { createGit } from 'just-git';

import { errorEvent, errorMessage } from './cli-errors.ts';
import { parseOptions } from './cli-options.ts';
import { readCommitMessages } from './commit-message-source.ts';
import { checkCommitMessages } from './linter.ts';
import { NodeFileSystem } from './node-file-system.ts';
import { jsonReport, terminalFailureReport } from './report.ts';
import { type OutputSettings, resolveOutput } from './reporter-mode.ts';
import { createReporter, denoTextStream, type TextStream } from './reporter.ts';
import {
	reportRewriteResult,
	rewordCommitMessages,
	rewordedMessageCount,
} from './reword-command.ts';

const root = Deno.cwd();

/** Exit code for an unusable invocation or an unexpected failure. */
const operationalErrorExit = 2;

export interface MainOptions {
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
	const isTerminal = options.stderr === undefined && Deno.stderr.isTerminal();
	let settings: OutputSettings | undefined;

	try {
		const { options: parsedOptions, output } = parseOptions(arguments_, {
			stderr,
			stdout,
		});
		settings = resolveOutput(output, isTerminal);
		const { colours, format } = settings;
		const git = createGit({ cwd: root, fs: new NodeFileSystem() });
		const reporter = createReporter({ mode: format, colours, stream: stderr });
		const checks = await reporter.phase(
			'Checking commit messages',
			async (phase) => {
				const commitMessages = await readCommitMessages(parsedOptions, git);
				phase.fact('messages', commitMessages.length);

				return checkCommitMessages(commitMessages);
			},
		);
		const failures = checks.filter((check) => check.failed);

		if (failures.length === 0) {
			if (format === 'json') {
				emitJsonReport(jsonReport('ok', checks), stderr);
			}

			return 0;
		}

		if (parsedOptions.kind === 'range' && parsedOptions.reword) {
			const rewriteResult = await reporter.phase(
				parsedOptions.dryRun
					? 'Checking reworded commit messages'
					: 'Rewording commit messages',
				async (phase) => {
					const result = await rewordCommitMessages(parsedOptions, checks, git);
					phase.fact(
						parsedOptions.dryRun ? 'would reword' : 'reworded',
						rewordedMessageCount(result),
					);

					return result;
				},
			);

			reportRewriteResult(rewriteResult, format, stderr);
			return 0;
		}

		if (format === 'terminal') {
			stderr.write(
				`${terminalFailureReport(failures, checks.length, colours)}\n`,
			);
		} else {
			emitJsonReport(jsonReport('failed', checks), stderr);
		}

		return 1;
	} catch (error) {
		if (error instanceof CommanderError) {
			// Commander has already written the message and help to the stream.
			return error.code === 'commander.helpDisplayed'
				? 0
				: operationalErrorExit;
		}

		const { colours, format } = settings ?? resolveOutput({}, isTerminal);

		if (format === 'json') {
			stderr.write(`${JSON.stringify(errorEvent(error))}\n`);
		} else {
			stderr.write(`${errorMessage(error, colours)}\n`);
		}

		return operationalErrorExit;
	}
}

function emitJsonReport(
	report: ReturnType<typeof jsonReport>,
	stream: TextStream,
): void {
	stream.write(`${JSON.stringify(report)}\n`);
}
