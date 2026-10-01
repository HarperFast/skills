#!/usr/bin/env node
// Start `harper dev .` for this checkout on its own loopback address with its own data root, so
// several git worktrees (or agent sessions) can each run a Harper dev instance at the same time.
//
// Copy into a Harper app (e.g. scripts/harper-dev.mjs) and point the dev script at it:
//   "dev": "node scripts/harper-dev.mjs"
// Extra arguments are passed through to Harper:  npm run dev -- --LOGGING_LEVEL=debug
// Print this checkout's running instance's URL, or fail if there is none:  node scripts/harper-dev.mjs url
//
// Environment:
//   HARPER_BIN                       Harper executable (default: `harper` on PATH)
//   HARPER_DEV_HOME                  where data roots and address claims live (default: ~/.harper-dev)
//   HARPER_DEV_LOOPBACK_START/COUNT  loopback addresses to use (default: 127.0.0.2 through 127.0.0.33)
//   HDB_ADMIN_USERNAME/PASSWORD      admin user created with a new data root (default: admin / random)
//
// Background: https://github.com/HarperFast/skills/blob/main/harper-local-dev/rules/running-dev-instances-in-worktrees.md

import { execFileSync, spawn, spawnSync } from 'node:child_process';
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
const INSTANCE_FILE = '.harper-instance';
const harperBin = process.env.HARPER_BIN ?? 'harper';

const appDir = fs.realpathSync(process.cwd());
const id = createHash('sha256').update(appDir).digest('hex').slice(0, 12);
const devHome = path.resolve(process.env.HARPER_DEV_HOME ?? path.join(os.homedir(), '.harper-dev'));
const { project, checkout } = checkoutNames();
// Data roots are grouped by project so an agent sandbox can allow writes to one project's directory only.
const projectDir = path.join(devHome, project);
const rootPath = path.join(projectDir, `${checkout}-${id}`);
// Held while the wrapper runs, so two starts from one checkout can't race each other through install or startup.
const lockFile = `${rootPath}.lock`;
// Address claims are machine-wide and must not depend on $TMPDIR, which agent sandboxes redirect.
const claimDir = path.join(devHome, '.loopback');
const instanceFile = path.join(appDir, INSTANCE_FILE);

function fail(message) {
	console.error(`harper-dev: ${message}`);
	process.exit(1);
}

// The project is the repository the checkout belongs to, shared by all of its worktrees; the checkout is the
// worktree's own directory. Outside git, both are the app directory's name. Names are kept short because the
// operations API's Unix socket lives in the data root, and macOS limits socket paths to 103 bytes.
function checkoutNames() {
	let top = appDir;
	let common = appDir;
	try {
		const args = ['rev-parse', '--path-format=absolute', '--show-toplevel', '--git-common-dir'];
		const output = execFileSync('git', args, { cwd: appDir, encoding: 'utf8', stdio: 'pipe' });
		[top, common] = output.trim().split('\n');
		// <repo>/.git, or <repo>/.bare or <repo>.git for a bare repository with worktrees
		if (path.basename(common).startsWith('.')) common = path.dirname(common);
	} catch {}
	const clean = (name, length) =>
		name
			.replace(/\.git$/, '')
			.replace(/[^\w.-]+/g, '-')
			.slice(0, length) || 'app';
	return { project: clean(path.basename(common), 20), checkout: clean(path.basename(top), 16) };
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

// Atomically create a lock file holding this process's PID. A lock left by a process that has died is taken over.
function tryLock(file) {
	for (let attempt = 0; attempt < 2; attempt++) {
		try {
			fs.writeFileSync(file, String(process.pid), { flag: 'wx' });
			return true;
		} catch (error) {
			if (error.code !== 'EEXIST') throw error;
			const owner = readPid(file);
			// An empty file is a lock being written right now.
			if (!owner || isAlive(owner)) return false;
			fs.rmSync(file, { force: true });
		}
	}
	return false;
}

// The instance recorded in .harper-instance, if it is still running. The file outlives a wrapper that crashed, and
// its address may since have gone to another checkout, so the recorded wrapper must be alive and still hold both
// this checkout's lock and the address claim.
function liveInstance() {
	try {
		const instance = JSON.parse(fs.readFileSync(instanceFile, 'utf8'));
		const holds = (file) => readPid(file) === instance.pid;
		if (isAlive(instance.pid) && holds(lockFile) && holds(path.join(claimDir, instance.host))) {
			return instance;
		}
	} catch {}
}

// Resolves to 'free' or the error code: EADDRINUSE (something already listens there), EADDRNOTAVAIL (address not
// configured), or EPERM/EACCES (binding is blocked, typically by an agent sandbox).
function probe(host, port) {
	return new Promise((resolve) => {
		const server = net.createServer();
		server.once('error', (error) => resolve(error.code));
		server.listen({ host, port }, () => server.close(() => resolve('free')));
	});
}

async function allocateAddress() {
	// Start from a slot derived from the checkout path, so a worktree usually gets the same address every time.
	const preferred = parseInt(id.slice(0, 8), 16) % LOOPBACK_COUNT;
	let unavailable = 0;
	for (let i = 0; i < LOOPBACK_COUNT; i++) {
		const host = `127.0.0.${LOOPBACK_START + ((preferred + i) % LOOPBACK_COUNT)}`;
		const claimFile = path.join(claimDir, host);
		if (!tryLock(claimFile)) continue;
		const results = await Promise.all(
			[...Object.values(PORTS), DEBUGGER_PORT].map((port) => probe(host, port)),
		);
		if (results.every((result) => result === 'free')) return { host, claimFile };
		fs.rmSync(claimFile, { force: true });
		if (results.some((result) => result === 'EPERM' || result === 'EACCES')) {
			fail(
				`not permitted to listen on ${host}. In an agent sandbox, allow binding local ports ` +
					'(Claude Code on macOS: sandbox.network.allowLocalBinding).',
			);
		}
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

// Installs a new data root with `harper install` under a throwaway HOME. When ~/.harperdb has no boot file, an
// install writes one pointing at its data root; that would repoint the machine's bare `harper` commands at this
// instance, and agent sandboxes usually forbid the write.
function install() {
	const installHome = path.join(projectDir, `.install-${id}`);
	fs.mkdirSync(installHome, { recursive: true });
	const result = spawnSync(harperBin, ['install'], {
		stdio: 'inherit',
		env: {
			...process.env,
			HOME: installHome,
			ROOTPATH: rootPath,
			DEFAULTS_MODE: process.env.DEFAULTS_MODE ?? 'dev',
			HDB_ADMIN_USERNAME: adminUsername,
			HDB_ADMIN_PASSWORD: adminPassword,
		},
	});
	fs.rmSync(installHome, { recursive: true, force: true });
	if (result.status !== 0 || !fs.existsSync(path.join(rootPath, 'harper-config.yaml'))) {
		fs.rmSync(rootPath, { recursive: true, force: true });
		fail(
			result.error?.code === 'ENOENT'
				? 'could not find the `harper` executable; install Harper (npm install -g harper) or set HARPER_BIN.'
				: 'installing a new data root failed; see the output above.',
		);
	}
}

// Harper's operations API listens on a Unix socket in the data root and fails to start if it may not bind one, which
// agent sandboxes usually forbid. Probe for that, and turn the socket off when it would fail.
function canBindUnixSocket() {
	const socketPath = path.join(projectDir, `.socket-check-${process.pid}`);
	return new Promise((resolve) => {
		const server = net.createServer();
		server.once('error', (error) => resolve(error.code !== 'EPERM' && error.code !== 'EACCES'));
		server.listen(socketPath, () => server.close(() => resolve(true)));
	}).finally(() => fs.rmSync(socketPath, { force: true }));
}

if (process.argv[2] === 'url') {
	const instance = liveInstance();
	if (!instance)
		fail('no Harper dev instance is running for this checkout; start one with `npm run dev`.');
	console.log(instance.url);
	process.exit(0);
}

const relative = path.relative(appDir, rootPath);
if (!relative.startsWith('..') && !path.isAbsolute(relative)) {
	fail(
		`data root ${rootPath} is inside the app directory; set HARPER_DEV_HOME to a directory outside it.`,
	);
}

for (const dir of [projectDir, claimDir]) {
	try {
		fs.mkdirSync(dir, { recursive: true });
		// Write a file rather than trusting access(): sandboxes deny writes that permission bits allow.
		const probeFile = path.join(dir, `.write-check-${process.pid}`);
		fs.writeFileSync(probeFile, '');
		fs.rmSync(probeFile);
	} catch {
		fail(
			`cannot write to ${dir}. In an agent sandbox, allow writes to ${devHome} ` +
				`(or to just ${projectDir} and ${claimDir}).`,
		);
	}
}

let cleanedUp = false;
let claimFile;
function cleanUp() {
	if (cleanedUp) return;
	cleanedUp = true;
	try {
		if (JSON.parse(fs.readFileSync(instanceFile, 'utf8')).pid === process.pid)
			fs.rmSync(instanceFile);
	} catch {}
	for (const file of [claimFile, lockFile]) {
		if (file && readPid(file) === process.pid) fs.rmSync(file, { force: true });
	}
}

if (!tryLock(lockFile)) {
	const running = liveInstance();
	const owner = readPid(lockFile);
	fail(
		`Harper is already running for this checkout${running ? ` at ${running.url}` : ''}` +
			`${owner ? ` (pid ${owner})` : ''}.`,
	);
}
process.on('exit', cleanUp);

const harperPid = readPid(path.join(rootPath, 'hdb.pid'));
if (harperPid && isAlive(harperPid)) {
	fail(
		`a Harper process from an earlier run is still using ${rootPath}; stop it with \`kill ${harperPid}\`.`,
	);
}

unmaskDotEnv();
let host;
({ host, claimFile } = await allocateAddress());

const firstRun = !fs.existsSync(path.join(rootPath, 'harper-config.yaml'));
const adminUsername = process.env.HDB_ADMIN_USERNAME || 'admin';
const adminPassword = process.env.HDB_ADMIN_PASSWORD || randomBytes(12).toString('base64url');
if (firstRun) {
	console.log(`Installing a new Harper data root for ${appDir}`);
	install();
}

const url = `http://${host}:${PORTS.HTTP_PORT}`;
const operationsUrl = `http://${host}:${PORTS.OPERATIONSAPI_NETWORK_PORT}`;
const unixSocket = (await canBindUnixSocket()) && path.join(rootPath, 'operations-server');
const env = { ...process.env };
for (const name of URL_ENV_VARS) env[name] = url;

const args = [
	'dev',
	'.',
	`--ROOTPATH=${rootPath}`,
	...Object.entries(PORTS).map(([key, port]) => `--${key}=${host}:${port}`),
	`--OPERATIONSAPI_NETWORK_DOMAINSOCKET=${unixSocket}`,
	`--THREADS_DEBUG_HOST=${host}`,
	...process.argv.slice(2),
];

fs.writeFileSync(
	instanceFile,
	JSON.stringify({ url, operationsUrl, host, rootPath, pid: process.pid }, null, '\t') + '\n',
);

console.log(`Harper dev instance for ${appDir}`);
console.log(`  URL:        ${url}`);
console.log(
	`  Operations: ${operationsUrl}${unixSocket ? '' : ' (Unix socket off: not permitted here)'}`,
);
console.log(`  Data root:  ${rootPath}`);
if (firstRun && !process.env.HDB_ADMIN_PASSWORD) {
	console.log(`  Admin:      ${adminUsername} / ${adminPassword}`);
}

const child = spawn(harperBin, args, { stdio: 'inherit', env });
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
