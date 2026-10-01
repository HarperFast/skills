#!/usr/bin/env node
// Start `harper dev .` for this checkout on its own loopback address with its own data root, so
// several git worktrees (or agent sessions) can each run a Harper dev instance at the same time.
//
// Copy into a Harper app (e.g. scripts/harper-dev.mjs) and point the dev script at it:
//   "dev": "node scripts/harper-dev.mjs"
// Extra arguments are passed through to Harper:  npm run dev -- --LOGGING_LEVEL=debug
//
// Environment:
//   HARPER_BIN                       Harper executable (default: `harper` on PATH)
//   HARPER_DEV_HOME                  parent directory of the per-checkout data roots (default: ~/.harper-dev)
//   HARPER_DEV_LOOPBACK_START/COUNT  loopback addresses to use (default: 127.0.0.2 through 127.0.0.33)
//   HDB_ADMIN_USERNAME/PASSWORD      admin user created with a new data root (default: admin / random)
//
// Background: https://github.com/HarperFast/skills/blob/main/harper-local-dev/rules/running-dev-instances-in-worktrees.md

import { spawn } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';

// Every listener gets the same default port on this instance's own address.
const PORTS = {
	HTTP_PORT: 9926,
	OPERATIONSAPI_NETWORK_PORT: 9925,
	MQTT_NETWORK_PORT: 1883,
	MQTT_NETWORK_SECUREPORT: 8883,
	REPLICATION_SECUREPORT: 9933, // Harper Pro only; core ignores it
};
const DEBUGGER_PORT = 9229;
// Env vars set to this instance's URL. Add your app's own base-URL variables (e.g. 'APP_BASE_URL'): values set
// here win over .env, because Harper's loadEnv never overrides a variable that is already set.
const URL_ENV_VARS = ['HARPER_DEV_URL'];
const LOOPBACK_START = Number(process.env.HARPER_DEV_LOOPBACK_START ?? 2);
const LOOPBACK_COUNT = Number(process.env.HARPER_DEV_LOOPBACK_COUNT ?? 32);
const CLAIM_DIR = path.join(os.tmpdir(), 'harper-dev-loopback');
const INSTANCE_FILE = '.harper-instance';

const appDir = fs.realpathSync(process.cwd());
const id = createHash('sha256').update(appDir).digest('hex').slice(0, 12);
const devHome = path.resolve(process.env.HARPER_DEV_HOME ?? path.join(os.homedir(), '.harper-dev'));
// Kept short: the operations API's Unix socket lives in the data root, and macOS limits socket paths to 103 bytes.
const rootPath = path.join(devHome, `${path.basename(appDir).slice(0, 24)}-${id}`);
const instanceFile = path.join(appDir, INSTANCE_FILE);

function fail(message) {
	console.error(`harper-dev: ${message}`);
	process.exit(1);
}

function isAlive(pid) {
	try {
		process.kill(pid, 0);
		return true;
	} catch (error) {
		return error.code === 'EPERM';
	}
}

function readPid(file) {
	try {
		return Number(fs.readFileSync(file, 'utf8').trim()) || 0;
	} catch {
		return 0;
	}
}

// Atomically claim an address for this process. A claim left by a process that has died is taken over.
function tryClaim(claimFile) {
	for (let attempt = 0; attempt < 2; attempt++) {
		try {
			fs.writeFileSync(claimFile, String(process.pid), { flag: 'wx' });
			return true;
		} catch (error) {
			if (error.code !== 'EEXIST') throw error;
			const owner = readPid(claimFile);
			// An empty file is a claim being written right now.
			if (!owner || isAlive(owner)) return false;
			fs.rmSync(claimFile, { force: true });
		}
	}
	return false;
}

// Resolves to 'free', 'EADDRINUSE' (something already listens there), or 'EADDRNOTAVAIL' (address not configured).
function probe(host, port) {
	return new Promise((resolve) => {
		const server = net.createServer();
		server.once('error', (error) => resolve(error.code));
		server.listen({ host, port }, () => server.close(() => resolve('free')));
	});
}

async function allocateAddress() {
	fs.mkdirSync(CLAIM_DIR, { recursive: true });
	// Start from a slot derived from the checkout path, so a worktree usually gets the same address every time.
	const preferred = parseInt(id.slice(0, 8), 16) % LOOPBACK_COUNT;
	let unavailable = 0;
	for (let i = 0; i < LOOPBACK_COUNT; i++) {
		const host = `127.0.0.${LOOPBACK_START + ((preferred + i) % LOOPBACK_COUNT)}`;
		const claimFile = path.join(CLAIM_DIR, host);
		if (!tryClaim(claimFile)) continue;
		const results = await Promise.all(
			[...Object.values(PORTS), DEBUGGER_PORT].map((port) => probe(host, port)),
		);
		if (results.every((result) => result === 'free')) return { host, claimFile };
		fs.rmSync(claimFile, { force: true });
		if (results.includes('EADDRNOTAVAIL')) unavailable++;
	}
	const last = LOOPBACK_START + LOOPBACK_COUNT - 1;
	if (unavailable === LOOPBACK_COUNT) {
		fail(
			`loopback addresses 127.0.0.${LOOPBACK_START}-127.0.0.${last} are not configured. ` +
				'On macOS, alias them once per boot:\n' +
				`  for i in $(seq ${LOOPBACK_START} ${last}); do sudo ifconfig lo0 alias 127.0.0.$i up; done`,
		);
	}
	fail(
		`no free loopback address in 127.0.0.${LOOPBACK_START}-127.0.0.${last}. Stop some Harper instances, ` +
			'or check for one bound to all interfaces (a plain `harper dev .`).',
	);
}

// Harper's loadEnv never overrides a variable that is already set, even to an empty string, so an empty
// value inherited from the shell would silently mask the value in .env. Drop those before starting Harper.
function unmaskDotEnv() {
	let text;
	try {
		text = fs.readFileSync(path.join(appDir, '.env'), 'utf8');
	} catch {
		return;
	}
	for (const [, key] of text.matchAll(/^\s*(?:export\s+)?([\w.-]+)\s*=/gm)) {
		if (process.env[key] === '') delete process.env[key];
	}
}

const relative = path.relative(appDir, rootPath);
if (!relative.startsWith('..') && !path.isAbsolute(relative)) {
	fail(
		`data root ${rootPath} is inside the app directory; set HARPER_DEV_HOME to a directory outside it.`,
	);
}

let running;
try {
	running = JSON.parse(fs.readFileSync(instanceFile, 'utf8'));
} catch {}
if (running && isAlive(running.pid))
	fail(`Harper is already running for this checkout at ${running.url} (pid ${running.pid}).`);
const harperPid = readPid(path.join(rootPath, 'hdb.pid'));
if (harperPid && isAlive(harperPid)) {
	fail(
		`a Harper process from an earlier run is still using ${rootPath}; stop it with \`kill ${harperPid}\`.`,
	);
}

unmaskDotEnv();
const { host, claimFile } = await allocateAddress();
const url = `http://${host}:${PORTS.HTTP_PORT}`;
const operationsUrl = `http://${host}:${PORTS.OPERATIONSAPI_NETWORK_PORT}`;
const env = { ...process.env };
for (const name of URL_ENV_VARS) env[name] = url;

const firstRun = !fs.existsSync(path.join(rootPath, 'harper-config.yaml'));
let generatedPassword;
if (firstRun) {
	// `harper dev` installs a new data root on first start when these are set; no prompts.
	env.DEFAULTS_MODE ??= 'dev';
	env.HDB_ADMIN_USERNAME ??= 'admin';
	if (!env.HDB_ADMIN_PASSWORD)
		env.HDB_ADMIN_PASSWORD = generatedPassword = randomBytes(12).toString('base64url');
}

const args = [
	'dev',
	'.',
	`--ROOTPATH=${rootPath}`,
	...Object.entries(PORTS).map(([key, port]) => `--${key}=${host}:${port}`),
	`--THREADS_DEBUG_HOST=${host}`,
	...process.argv.slice(2),
];

fs.writeFileSync(
	instanceFile,
	JSON.stringify({ url, operationsUrl, host, rootPath, pid: process.pid }, null, '\t') + '\n',
);

let cleanedUp = false;
function cleanUp() {
	if (cleanedUp) return;
	cleanedUp = true;
	try {
		if (JSON.parse(fs.readFileSync(instanceFile, 'utf8')).pid === process.pid)
			fs.rmSync(instanceFile);
	} catch {}
	if (readPid(claimFile) === process.pid) fs.rmSync(claimFile, { force: true });
}
process.on('exit', cleanUp);

console.log(`Harper dev instance for ${appDir}`);
console.log(`  URL:        ${url}`);
console.log(`  Operations: ${operationsUrl}`);
console.log(`  Data root:  ${rootPath}${firstRun ? ' (new; installing)' : ''}`);
if (generatedPassword)
	console.log(`  Admin:      ${env.HDB_ADMIN_USERNAME} / ${generatedPassword}`);

const child = spawn(process.env.HARPER_BIN ?? 'harper', args, { stdio: 'inherit', env });
for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
	process.on(signal, () => child.kill(signal));
}
child.on('error', (error) => {
	cleanUp();
	fail(
		error.code === 'ENOENT'
			? 'could not find the `harper` executable; install Harper (npm install -g harper) or set HARPER_BIN.'
			: error.message,
	);
});
child.on('exit', (code, signal) => {
	cleanUp();
	process.exit(code ?? (signal ? 1 : 0));
});
