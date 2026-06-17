import { Spinner } from '@std/cli/unstable-spinner';
import pc from 'picocolors';

/**
 * The output formats wrapscallion can produce: a terminal report (with a
 * spinner when animated), line-delimited JSON, or the GitHub Actions format,
 * which pairs the terminal report with `::error` annotations.
 */
export const reporterModes = ['terminal', 'json', 'github'] as const;

/** One of the {@link reporterModes}. */
export type ReporterMode = (typeof reporterModes)[number];

/** A picocolors instance whose colouring has already been resolved. */
export type Colours = ReturnType<typeof pc.createColors>;

export interface PhaseContext {
	fact(label: string, value: string | number): void;
}

/**
 * The slice of a progress reporter the commit-message linter needs: a single
 * `phase` that wraps a unit of work, shown as a spinner with live facts in
 * terminal mode and one `{event:'phase'}` line in JSON mode. The linter never
 * renders result tables, so there is no `result`/`data` surface here.
 */
export interface Reporter {
	phase<T>(
		label: string,
		body: (context: PhaseContext) => Promise<T> | T,
	): Promise<T>;
}

export interface ReporterOptions {
	readonly mode: ReporterMode;
	readonly colours: Colours;
	readonly stream?: TextStream;
}

export interface TextStream {
	write(chunk: string): void;
}

const textEncoder = new TextEncoder();

export function createReporter(options: ReporterOptions): Reporter {
	const stream = options.stream ?? denoTextStream(Deno.stderr);

	return options.mode === 'json'
		? createJsonReporter(stream)
		: createTerminalReporter(
			stream,
			options.stream === undefined,
			options.colours,
		);
}

function createTerminalReporter(
	stream: TextStream,
	animated: boolean,
	colours: Colours,
): Reporter {
	return {
		async phase(label, body) {
			const facts: { label: string; value: string }[] = [];
			const spinner = animated
				? new Spinner({ message: label, output: Deno.stderr })
				: undefined;
			spinner?.start();

			const render = (): void => {
				if (spinner === undefined) {
					return;
				}

				spinner.message = facts.length === 0
					? label
					: `${label} · ${formatFacts(facts, colours)}`;
			};

			const startedAt = Date.now();

			try {
				const value = await body({
					fact(factLabel, factValue) {
						facts.push({ label: factLabel, value: String(factValue) });
						render();
					},
				});

				const elapsed = formatDuration(Date.now() - startedAt);
				const summary = facts.length === 0
					? ''
					: ` · ${formatFacts(facts, colours)}`;
				spinner?.stop();
				stream.write(`ok ${label}${summary} ${colours.dim(`(${elapsed})`)}\n`);

				return value;
			} catch (error) {
				const elapsed = formatDuration(Date.now() - startedAt);
				spinner?.stop();
				stream.write(
					`${colours.red('failed')} ${label} ${colours.dim(`(${elapsed})`)}\n`,
				);

				throw error;
			}
		},
	};
}

function createJsonReporter(stream: TextStream): Reporter {
	return {
		async phase(label, body) {
			const facts: Record<string, string> = {};
			const startedAt = Date.now();

			try {
				const value = await body({
					fact(factLabel, factValue) {
						facts[factLabel] = String(factValue);
					},
				});

				stream.write(
					`${
						JSON.stringify({
							event: 'phase',
							label,
							status: 'ok',
							durationMs: Date.now() - startedAt,
							facts,
						})
					}\n`,
				);

				return value;
			} catch (error) {
				stream.write(
					`${
						JSON.stringify({
							event: 'phase',
							label,
							status: 'failed',
							durationMs: Date.now() - startedAt,
							error: error instanceof Error ? error.message : String(error),
						})
					}\n`,
				);

				throw error;
			}
		},
	};
}

function formatFacts(
	facts: readonly { label: string; value: string }[],
	colours: Colours,
): string {
	return facts
		.map(({ label, value }) => `${label} ${colours.cyan(value)}`)
		.join(', ');
}

function formatDuration(milliseconds: number): string {
	if (milliseconds < 1000) {
		return `${String(milliseconds)}ms`;
	}

	const seconds = milliseconds / 1000;

	if (seconds < 60) {
		return `${seconds.toFixed(1)}s`;
	}

	const minutes = Math.floor(seconds / 60);
	const remainder = (seconds - minutes * 60).toFixed(1);

	return `${String(minutes)}m ${remainder}s`;
}

export function formatCount(count: number): string {
	return count.toLocaleString('en-GB');
}

export function denoTextStream(
	stream: typeof Deno.stderr | typeof Deno.stdout,
): TextStream {
	return {
		write(chunk) {
			stream.writeSync(textEncoder.encode(chunk));
		},
	};
}
