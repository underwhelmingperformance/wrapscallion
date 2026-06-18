import { parse } from '@std/toml';

import { ConfigFileError } from './cli-errors.ts';

/** The config file wrapscallion looks for in the repository root. */
export const configFileName = '.wrapscallion.toml';

/**
 * A config file's parsed contents. The keys are validated against the CLI
 * options when they are applied, so this stage only parses the TOML; it does
 * not know which settings exist.
 */
export interface RawConfig {
	readonly path: string;
	readonly values: Record<string, unknown>;
}

/**
 * Reads the config file's contents, returning `undefined` when it is absent.
 * Injected so the loader can be tested without touching the filesystem.
 */
export interface ConfigFileReader {
	read(path: string): Promise<string | undefined>;
}

/** Reads the config file from disk with Deno. */
export class DenoConfigFileReader implements ConfigFileReader {
	async read(path: string): Promise<string | undefined> {
		try {
			return await Deno.readTextFile(path);
		} catch (error) {
			if (error instanceof Deno.errors.NotFound) {
				return undefined;
			}

			throw new ConfigFileError(path, errorMessage(error));
		}
	}
}

/** Loads the repository-root config file, if it exists. */
export async function loadConfigFile(
	root: string,
	reader: ConfigFileReader,
): Promise<RawConfig | undefined> {
	const path = `${root}/${configFileName}`;
	const contents = await reader.read(path);

	if (contents === undefined) {
		return undefined;
	}

	return { path, values: parseToml(path, contents) };
}

function parseToml(path: string, contents: string): Record<string, unknown> {
	try {
		return parse(contents);
	} catch (error) {
		throw new ConfigFileError(path, errorMessage(error));
	}
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
