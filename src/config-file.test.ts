import { assertEquals, assertRejects } from '@std/assert';

import { ConfigFileError } from './cli-errors.ts';
import {
	configFileName,
	type ConfigFileReader,
	loadConfigFile,
	type RawConfig,
} from './config-file.ts';

const root = '/repo';

Deno.test('a missing config file yields no configuration', async () => {
	const config = await loadConfigFile(root, new StubReader(undefined));

	assertEquals(config, undefined);
});

Deno.test('the config file is read from the repository root', async () => {
	const reader = new StubReader('from = "origin/main"');

	await loadConfigFile(root, reader);

	assertEquals(reader.requestedPaths, [`${root}/${configFileName}`]);
});

Deno.test('the parsed values are returned with their source path', async () => {
	const config = await loadConfigFile(
		root,
		new StubReader(
			[
				'colour = true',
				'from = "origin/main"',
				"ignore = ['^chore\\(main\\): release ']",
			].join('\n'),
		),
	);

	const expected: RawConfig = {
		path: `${root}/${configFileName}`,
		values: {
			colour: true,
			from: 'origin/main',
			ignore: ['^chore\\(main\\): release '],
		},
	};

	assertEquals(config, expected);
});

Deno.test('malformed TOML is reported as a config error', async () => {
	await assertRejects(
		() => loadConfigFile(root, new StubReader('from = =')),
		ConfigFileError,
	);
});

class StubReader implements ConfigFileReader {
	readonly requestedPaths: string[] = [];

	constructor(private readonly contents: string | undefined) {}

	read(path: string): Promise<string | undefined> {
		this.requestedPaths.push(path);
		return Promise.resolve(this.contents);
	}
}
