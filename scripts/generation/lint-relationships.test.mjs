// End-to-end test of the lint-relationships CLI: file reading, `file:line`
// output, and the exit status CI relies on.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const CLI = path.join(import.meta.dirname, 'lint-relationships.mjs');

function run(files) {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lint-relationships-'));
	try {
		const paths = Object.entries(files).map(([name, content]) => {
			const file = path.join(dir, name);
			fs.writeFileSync(file, content);
			return file;
		});
		const result = spawnSync(process.execPath, [CLI, ...paths], { encoding: 'utf-8' });
		return { ...result, dir };
	} finally {
		fs.rmSync(dir, { recursive: true, force: true });
	}
}

const schema = (from) =>
	[
		'```graphql',
		'type Product @table {',
		'\tid: ID @primaryKey',
		'\tresellerIds: [ID] @indexed',
		`\tresellers: [Reseller] @relationship(from: "${from}")`,
		'}',
		'```',
	].join('\n');

test('exits 1 and names file, line, and rule on a mismatch', () => {
	const { status, stderr, dir } = run({ 'bad.md': schema('resellerId') });
	assert.equal(status, 1);
	assert.match(stderr, new RegExp(`${path.join(dir, 'bad.md')}:5: \\[relationship-attribute\\]`));
});

test('exits 0 on consistent examples and reports how many it checked', () => {
	const { status, stdout } = run({ 'good.md': schema('resellerIds') });
	assert.equal(status, 0);
	assert.match(stdout, /1 @relationship example in 1 file consistent/);
});

test('an unreadable path is a reported problem, not a crash', () => {
	const result = spawnSync(process.execPath, [CLI, path.join(os.tmpdir(), 'no-such-file.md')], {
		encoding: 'utf-8',
	});
	assert.equal(result.status, 1);
	assert.match(result.stderr, /no-such-file\.md: cannot read/);
});
